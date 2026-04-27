/**
 * NIP-65 — Relay List Metadata.
 *
 * Manifesto §14 (Bootstrap Distribuído) + §30 (Compatibilidade Nostr).
 *
 * NIP-65 define kind 10002 (Replaceable Event) onde cada user publica
 * sua lista de relays preferidos. Tag `r` com URL + opcional marcador
 * 'read' / 'write'. Sem marcador = ambos.
 *
 * Drift usa NIP-65 pra:
 *   1. Publicar a lista do user atual (descobrível por outros clientes
 *      Nostr — Damus, Snort, etc.)
 *   2. Importar lista de relays de outro npub que o user queira seguir
 *      como "fonte de relays" (não os mesmos posts — só os relays).
 *
 * NÃO inventamos nada — kind 10002 é padrão Nostr; usamos as mesmas tags
 * que Damus/Snort/Coracle usam. Drift é cidadão do ecossistema.
 *
 * Edição vs criação: kind 10002 é **replaceable** (faixa 10000-19999),
 * então cada `publishRelayList` substitui a lista anterior do mesmo npub.
 */

import { signDriftEvent, publishToRelays } from './nostr'
import { pool } from './transport/wss'
import { activeReadRelays, type RelayRecord } from './relays'
import type { SignedEvent } from '../types/nostr'

const NIP_65_KIND = 10002

export interface RelayListEntry {
  url: string
  read: boolean
  write: boolean
}

// ─── Publicar (kind 10002 do user atual) ─────────────────────────────

/**
 * Publica a lista de relays do user atual como evento NIP-65.
 *
 * @param entries - Relays a anunciar. Apenas os com `read || write`
 *   entram no evento. Cliente oficial publica todos os ativos por
 *   default; user pode escolher subset.
 */
export async function publishRelayList(entries: RelayListEntry[]): Promise<SignedEvent> {
  const tags: string[][] = []
  for (const e of entries) {
    if (!e.read && !e.write) continue
    if (e.read && e.write) {
      tags.push(['r', e.url])
    } else if (e.read) {
      tags.push(['r', e.url, 'read'])
    } else {
      tags.push(['r', e.url, 'write'])
    }
  }

  const event = await signDriftEvent({
    kind: NIP_65_KIND,
    tags,
    content: '',
  })
  await publishToRelays(event)
  return event
}

/**
 * Constrói entries a partir do `RelayRecord[]` da store. Helper de
 * conveniência — só inclui relays habilitados.
 */
export function entriesFromRecords(records: RelayRecord[]): RelayListEntry[] {
  return records
    .filter((r) => r.enabled)
    .map((r) => ({ url: r.url, read: r.read, write: r.write }))
}

// ─── Parsear (kind 10002 de qualquer user) ───────────────────────────

/**
 * Extrai `RelayListEntry[]` de um evento kind 10002.
 *
 * Tolerante: ignora tags malformadas, normaliza URLs, descarta
 * entries sem URL válida. Não valida assinatura — chamador faz.
 */
export function parseRelayList(event: SignedEvent): RelayListEntry[] {
  if (event.kind !== NIP_65_KIND) return []
  const entries: RelayListEntry[] = []
  const seen = new Set<string>()
  for (const tag of event.tags) {
    if (tag[0] !== 'r') continue
    const url = (tag[1] ?? '').trim().toLowerCase()
    if (!url || !/^wss?:\/\//.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    const marker = tag[2]
    const read = marker !== 'write'
    const write = marker !== 'read'
    entries.push({ url, read, write })
  }
  return entries
}

// ─── Fetch da lista de outro user ────────────────────────────────────

/**
 * Busca a lista de relays mais recente de um npub via subscribe.
 *
 * Usa os relays que o cliente já conhece pra encontrar o evento. Se
 * nenhum dos relays atuais tem o evento, retorna lista vazia.
 *
 * Timeout de 5s — se nada chega nesse tempo, devolve `null`.
 *
 * @param npub - Pubkey hex (não bech32) do user-alvo.
 * @returns Array de entries, ou `null` se não encontrou.
 */
export async function fetchRelayList(npub: string): Promise<RelayListEntry[] | null> {
  const relays = activeReadRelays()
  if (relays.length === 0) return null

  return new Promise<RelayListEntry[] | null>((resolve) => {
    let resolved = false
    let latest: SignedEvent | null = null

    const sub = pool.subscribeMany(
      relays,
      { kinds: [NIP_65_KIND], authors: [npub], limit: 1 },
      {
        onevent: (event: SignedEvent) => {
          // Replaceable — pega o mais recente por created_at.
          if (!latest || event.created_at > latest.created_at) {
            latest = event
          }
        },
        oneose: () => {
          if (resolved) return
          resolved = true
          try {
            sub.close()
          } catch {
            /* noop */
          }
          resolve(latest ? parseRelayList(latest) : null)
        },
      },
    )

    setTimeout(() => {
      if (resolved) return
      resolved = true
      try {
        sub.close()
      } catch {
        /* noop */
      }
      resolve(latest ? parseRelayList(latest) : null)
    }, 5000)
  })
}
