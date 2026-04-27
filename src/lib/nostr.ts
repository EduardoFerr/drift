/**
 * Camada Nostr — sign, verify, helpers de tag.
 *
 * Esta camada é agnóstica a transporte: assina eventos e os verifica.
 * O transporte real (WSS hoje, Tor/WebRTC na Fase 6) vive em
 * `lib/transport/`. Para publicar, use `publishToRelays` (que delega
 * pro transporte ativo) ou chame `wssTransport.publish` direto.
 *
 * Conhecimento dos kinds Drift (9078..9081) e schema vive em
 * `lib/protocol.ts` e `lib/events.ts`. Aqui só são tratados como
 * `kind: number` opaco.
 */

import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import { getOrCreateIdentity, nsecHexToBytes } from './identity'
import { wssTransport, pool } from './transport/wss'
import type { PublishResult, TransportHealth } from './transport'

// Re-export para chamadores legados que importavam `pool` de `nostr.ts`.
// (Em particular, `sync.ts` usa `pool.subscribeMany` direto pra rebuild.)
export { pool }

// ─── Assinatura ──────────────────────────────────────────────────────

export interface DriftEventInput {
  kind: number
  tags: string[][]
  content: string
}

/**
 * Assina um evento Drift com o nsec do usuário.
 *
 * Injeta `created_at` (unix seconds, agora) e `pubkey` automaticamente
 * — chamadores passam apenas `kind`, `tags` e `content`.
 *
 * @param input - Evento sem assinatura, sem timestamp, sem pubkey.
 * @returns Evento Nostr completo com `id`, `sig`, `pubkey`, `created_at`.
 */
export async function signDriftEvent(input: DriftEventInput): Promise<NostrEvent> {
  const identity = await getOrCreateIdentity()
  const nsecBytes = nsecHexToBytes(identity.nsec)
  const template: EventTemplate = {
    kind: input.kind,
    tags: input.tags,
    content: input.content,
    created_at: Math.floor(Date.now() / 1000),
  }
  return finalizeEvent(template, nsecBytes)
}

/**
 * Verifica assinatura Schnorr de um evento Nostr.
 *
 * Eventos inválidos devem ser rejeitados silenciosamente — uma
 * assinatura quebrada NÃO é exceção operacional, é ruído da rede.
 */
export function verifyDriftEvent(event: NostrEvent): boolean {
  try {
    return verifyEvent(event)
  } catch {
    return false
  }
}

// ─── Publicação ──────────────────────────────────────────────────────

/**
 * Publica um evento já assinado nos transportes ativos.
 *
 * Hoje: só WSS clearnet. Quando Tor / WebRTC entrarem (Fase 6),
 * iteramos sobre `[wssTransport, torTransport, webrtcTransport]` e
 * agregamos o resultado. Manifesto §12.
 */
export async function publishToRelays(event: NostrEvent): Promise<PublishResult> {
  return wssTransport.publish(event)
}

// ─── Helpers de tag ──────────────────────────────────────────────────

/** Lê o primeiro valor de uma tag pelo nome. Ex: `getTag(e, 'e')` → primeiro postId. */
export function getTag(event: NostrEvent, name: string): string | null {
  for (const tag of event.tags) {
    if (tag[0] === name) return tag[1] ?? null
  }
  return null
}

/** Lê todos os valores de tags com o mesmo nome. */
export function getTags(event: NostrEvent, name: string): string[] {
  const out: string[] = []
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') out.push(tag[1])
  }
  return out
}

// ─── Diagnóstico ─────────────────────────────────────────────────────

export type RelayHealth = TransportHealth

/**
 * Tenta abrir WebSocket em cada relay e mede latência.
 *
 * Usado em telas de diagnóstico (boot panel). Não usa o pool — abre
 * sockets dedicados pra isolar a medição.
 *
 * @param timeoutMs - Tempo máximo aguardando ws.onopen.
 * @returns Status individual por relay.
 */
export async function checkRelayConnectivity(timeoutMs = 5000): Promise<RelayHealth[]> {
  return wssTransport.health(timeoutMs)
}
