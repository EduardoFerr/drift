/**
 * Camada de Transporte — interface uniforme para todos os meios de
 * comunicação com a rede Nostr.
 *
 * Hoje (MVP / Fase 3): só `wss.ts` está implementado. WSS clearnet
 * é o transporte primário.
 *
 * Fase 6 (cliente nativo Tauri):
 *   - `tor.ts`     — WSS via .onion, bypass DNS/SNI
 *   - `webrtc/`    — P2P direto entre clientes Drift (pasta, 12 arquivos pós-Sprint-4)
 *   - `bundle.ts`  — export/import de eventos via JSON ou QR code
 *                    (sneakernet, último recurso anti-bloqueio total)
 *
 * Por que abstrair AGORA, antes de Fase 6: `sync.ts` e `protocol.ts`
 * passam a falar com `Transport`, não com `pool` direto. Quando Fase 6
 * chegar, plugamos novos transportes sem tocar no resto. Manifesto §12,
 * arquitetura §32.
 *
 * Mantém compatibilidade: `wssTransport` é uma instância única apoiada
 * no SimplePool já existente — comportamento idêntico ao código pré-refactor.
 */

import type { SignedEvent } from '../../types/nostr'
import type { Filter as NostrFilter } from 'nostr-tools'

/**
 * Re-export do `Filter` de nostr-tools — usar isso garante compatibilidade
 * com as assinaturas reais do `pool.subscribeMany`, `relay.subscribe`, etc.
 * Inclui index signature `[#${string}]: string[]` pra tag filters
 * (`#e`, `#p`, `#a`).
 */
export type Filter = NostrFilter

export type Unsubscribe = () => void

export type EventHandler = (event: SignedEvent) => void | Promise<void>

export interface SubscribeHandlers {
  onevent: EventHandler
  /** End-Of-Stored-Events: relay terminou de mandar histórico. */
  oneose?: () => void
}

export interface TransportHealth {
  /** Endpoint identificador — URL WSS, endereço .onion, ou peer ID. */
  url: string
  ok: boolean
  /** Latência observada na última checagem, em ms. `null` se nunca testou. */
  latencyMs: number | null
}

export interface PublishResult {
  ok: number
  failed: number
  perRelay: { url: string; ok: boolean; error?: string }[]
}

/**
 * Transporte uniforme de eventos Nostr.
 *
 * Implementadores: `wss.ts` (atual), `tor.ts` (Fase 6), `webrtc/` (Fase 6, pasta),
 * `bundle.ts` (Fase 6 — sneakernet).
 */
export interface Transport {
  readonly kind: 'wss' | 'tor' | 'webrtc' | 'bundle'

  /** Publica um evento já assinado em todos os endpoints ativos do transporte. */
  publish(event: SignedEvent): Promise<PublishResult>

  /**
   * Inscreve-se em eventos que casam com o filtro.
   *
   * Cada evento que chega passa por `handlers.onevent`. `oneose` (opcional)
   * é chamado quando o transporte termina de enviar o histórico armazenado
   * — daí em diante é tempo real. Para múltiplos filtros (OR), chame
   * `subscribe()` várias vezes.
   */
  subscribe(filter: Filter, handlers: SubscribeHandlers): Unsubscribe

  /**
   * Mede saúde do transporte. Implementação varia: WSS abre sockets,
   * Tor mede latência via circuito, WebRTC consulta peers conhecidos.
   */
  health(timeoutMs?: number): Promise<TransportHealth[]>
}

// ─── Pool de transportes (Fase 6) ────────────────────────────────────
//
// Quando Tor / WebRTC entram, sync.ts e protocol.ts vão usar este pool
// que itera sobre todos os transportes ativos. Por enquanto exportamos
// só o WSS pra manter MVP simples.

export { wssTransport } from './wss'
export { webrtcTransport } from './webrtc'
