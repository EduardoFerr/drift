/**
 * Follows — NIP-02 (Contact List, kind 3).
 *
 * Manifesto §30 (Compatibilidade Nostr): Drift usa o evento padrão
 * de followers que Damus/Snort/Coracle/Iris usam. Identidades Drift
 * podem seguir e ser seguidas em qualquer cliente Nostr.
 *
 * Modelo NIP-02:
 *   kind: 3
 *   tags: [['p', npubHex, optionalRelayHint, optionalPetname], ...]
 *   content: '' (alguns clientes legacy põem o petname dict aqui — ignoramos)
 *
 * Replaceable event (faixa 0-9999 com kind 3 = especial NIP-01): cada
 * publicação substitui a anterior por (pubkey, kind=3). Pra adicionar
 * 1 follow, precisamos publicar a lista INTEIRA (snapshot).
 *
 * Manifesto §24 (sem afinidade no feed): seguir alguém NÃO altera o
 * score que o user vê. É filtro local — feed "Seguindo" usa essa
 * lista pra restringir, mas a ordem dentro do filtro continua
 * determinística (score puro).
 */

import { create } from 'zustand'
import { db } from './db'
import { signDriftEvent, publishToRelays } from './nostr'
import { pool } from './transport/wss'
import { activeReadRelays } from './relays'
import { getOrCreateIdentity } from './identity'
import type { SignedEvent } from '../types/nostr'

const NIP_02_KIND = 3

// ─── Store reativa ───────────────────────────────────────────────────

interface FollowsState {
  /** Set de npubs (hex) que o user atual está seguindo. */
  following: Set<string>
  loaded: boolean
  /** Última atualização da lista local (vinda da rede ou de mutação local). */
  updatedAt: number | null
}

export const useFollowsStore = create<FollowsState>(() => ({
  following: new Set<string>(),
  loaded: false,
  updatedAt: null,
}))

// ─── Carregamento ────────────────────────────────────────────────────

let initialized = false

/**
 * Carrega a lista de follows do banco pra store. Chamado em bootstrap.
 *
 * Source: tabela `follows` (já no schema). Cada row tem follower_pub
 * + following_pub. Filtramos pelo follower atual.
 */
export async function loadFollows(): Promise<void> {
  if (initialized) return
  initialized = true

  const identity = await getOrCreateIdentity()
  const rows = await db.exec<{ following_pub: string; created_at: number }>(
    `SELECT following_pub, created_at FROM follows WHERE follower_pub = ?`,
    [identity.npub],
  )
  const lastUpdated =
    rows.length > 0
      ? Math.max(...rows.map((r) => r.created_at))
      : null
  useFollowsStore.setState({
    following: new Set(rows.map((r) => r.following_pub)),
    loaded: true,
    updatedAt: lastUpdated,
  })
}

async function refreshLocal(): Promise<void> {
  const identity = await getOrCreateIdentity()
  const rows = await db.exec<{ following_pub: string }>(
    `SELECT following_pub FROM follows WHERE follower_pub = ?`,
    [identity.npub],
  )
  useFollowsStore.setState({
    following: new Set(rows.map((r) => r.following_pub)),
    loaded: true,
    updatedAt: Date.now() / 1000,
  })
}

// ─── Sync com Nostr ──────────────────────────────────────────────────

/**
 * Busca o kind 3 mais recente do user atual nos relays e atualiza o
 * banco local. Útil pra rehidratar follows após import de identidade
 * ou trocar de device.
 *
 * Idempotente. Se o evento remoto for mais antigo que o local, ignora.
 */
export async function syncFollowsFromRelays(): Promise<void> {
  const identity = await getOrCreateIdentity()
  const relays = activeReadRelays()
  if (relays.length === 0) return

  const latest = await new Promise<SignedEvent | null>((resolve) => {
    let best: SignedEvent | null = null
    let resolved = false

    const sub = pool.subscribeMany(
      relays,
      { kinds: [NIP_02_KIND], authors: [identity.npub], limit: 1 },
      {
        onevent: (event: SignedEvent) => {
          if (!best || event.created_at > best.created_at) best = event
        },
        oneose: () => {
          if (resolved) return
          resolved = true
          try {
            sub.close()
          } catch {
            /* noop */
          }
          resolve(best)
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
      resolve(best)
    }, 5000)
  })

  if (!latest) return

  const localLatest = useFollowsStore.getState().updatedAt
  if (localLatest && latest.created_at <= localLatest) return

  // Substitui local pelo remoto. NIP-02 é replaceable; o evento mais
  // recente é a única verdade.
  await applyContactList(latest)
}

/**
 * Persiste um evento kind 3 (de qualquer origem — sync, próprio, etc.)
 * Substitui follows do follower (pubkey do evento) pelo conteúdo do evento.
 *
 * Re-export: pode ser chamado por `events.ts:onNostrEvent` se quisermos
 * processar kinds 3 que chegam pelo subscribe — mas pra Phase 5 isso
 * fica fora do pipeline `onNostrEvent` porque kind 3 é "out-of-band"
 * pra ranking.
 */
export async function applyContactList(event: SignedEvent): Promise<void> {
  if (event.kind !== NIP_02_KIND) return

  const followingNpubs: string[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'p') continue
    const npub = tag[1]
    if (typeof npub !== 'string' || !/^[0-9a-f]{64}$/.test(npub)) continue
    followingNpubs.push(npub)
  }

  // Replaceable: limpa todos os follows do follower e re-insere.
  await db.run(`DELETE FROM follows WHERE follower_pub = ?`, [event.pubkey])
  for (const target of followingNpubs) {
    await db.run(
      `INSERT OR IGNORE INTO follows (follower_pub, following_pub, created_at) VALUES (?, ?, ?)`,
      [event.pubkey, target, event.created_at],
    )
  }

  const identity = await getOrCreateIdentity()
  if (event.pubkey === identity.npub) {
    // Era a lista do user atual — atualiza store reativa.
    await refreshLocal()
  }
}

// ─── Mutação local + publish ─────────────────────────────────────────

export async function follow(targetNpub: string): Promise<void> {
  const identity = await getOrCreateIdentity()
  if (targetNpub === identity.npub) return // não pode seguir a si mesmo

  await db.run(
    `INSERT OR IGNORE INTO follows (follower_pub, following_pub, created_at) VALUES (?, ?, ?)`,
    [identity.npub, targetNpub, Math.floor(Date.now() / 1000)],
  )
  await refreshLocal()
  await publishCurrentList()
}

export async function unfollow(targetNpub: string): Promise<void> {
  const identity = await getOrCreateIdentity()
  await db.run(
    `DELETE FROM follows WHERE follower_pub = ? AND following_pub = ?`,
    [identity.npub, targetNpub],
  )
  await refreshLocal()
  await publishCurrentList()
}

export function isFollowing(npub: string): boolean {
  return useFollowsStore.getState().following.has(npub)
}

/**
 * Publica a lista atual como kind 3. Snapshot — substitui qualquer
 * lista anterior do user na rede.
 *
 * Fire-and-forget — chamado por follow/unfollow. Se falhar, mutação
 * local persiste e republicar manualmente é possível.
 */
async function publishCurrentList(): Promise<void> {
  const list = Array.from(useFollowsStore.getState().following)
  const tags: string[][] = list.map((npub) => ['p', npub])
  try {
    const event = await signDriftEvent({
      kind: NIP_02_KIND,
      tags,
      content: '',
    })
    await publishToRelays(event)
  } catch (err) {
    console.error('[follows] publish kind 3 failed:', err)
  }
}

