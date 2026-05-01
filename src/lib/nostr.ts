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
import { nip44 } from 'nostr-tools'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import { getOrCreateIdentity, nsecHexToBytes } from './identity'
import { wssTransport, pool } from './transport/wss'
import { orchestrator } from './transport/orchestrator'
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
 * Fase 6.2-E: delega ao `orchestrator` que multiplexa todos os
 * transportes registrados (`wssTransport`, `webrtcTransport`, futuro
 * IPFS-pin). Manifesto §12. Bootstrap registra os transports ativos
 * — Tor NÃO é registrado como transport separado: em vez disso,
 * `bootstrap.ts` instala `TorWebSocket` como impl global do
 * `nostr-tools/pool` quando `network_mode ∈ {tor, onion-only}` em
 * Tauri+arti, e o `wssTransport` existente passa a rotear via Tor
 * sem mudança. Detalhes em `Docs/transport-paths.md`.
 *
 * Comportamento idêntico ao publish-direto-WSS quando só WSS está
 * registrado — orchestrator é compatível por design.
 */
export async function publishToRelays(event: NostrEvent): Promise<PublishResult> {
  return orchestrator.publish(event)
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

// ─── NIP-44 v2 facade ────────────────────────────────────────────────

/**
 * Cifra plaintext via NIP-44 v2 pro pubkey do peer destinatário.
 *
 * Usa `nip44.getConversationKey(senderNsecBytes, recipientNpubHex)` pra
 * derivar a chave HKDF/ECDH compartilhada e `nip44.encrypt` pra produzir
 * o payload base64 (versioned, AEAD, padded). Usado em
 * `webrtc-signaling-nostr.ts` (Fase 6.1b) pra signaling de WebRTC via
 * DM Nostr cifrado, e em qualquer feature futura que precise DM
 * (Manifesto §29).
 *
 * @param plain JSON ou texto a cifrar
 * @param peerNpubHex pubkey do destinatário (hex 64-char)
 * @param senderNsecBytes private key Uint8Array 32 bytes
 * @returns payload NIP-44 v2 base64 pronto pra `event.content`
 */
export function encryptDM(
  plain: string,
  peerNpubHex: string,
  senderNsecBytes: Uint8Array,
): string {
  const key = nip44.getConversationKey(senderNsecBytes, peerNpubHex)
  return nip44.encrypt(plain, key)
}

/**
 * Decifra payload NIP-44 v2 vindo de `event.content`.
 *
 * Lança se cifra inválida — caller deve catchar e dar drop silencioso
 * (manifesto §11 — eventos inválidos são ruído, não exceção).
 */
export function decryptDM(
  payload: string,
  peerNpubHex: string,
  recipientNsecBytes: Uint8Array,
): string {
  const key = nip44.getConversationKey(recipientNsecBytes, peerNpubHex)
  return nip44.decrypt(payload, key)
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
