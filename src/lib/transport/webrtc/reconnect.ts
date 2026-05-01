/**
 * webrtc/reconnect — backoff exponencial + scheduling.
 *
 * Counter por peer reseta em sucesso (`dc.onopen` em `peer.ts`). Cap em
 * `MAX_ATTEMPTS=5`. Delay: 1s → 2s → 4s → 8s → 16s → 30s (cap em
 * `MAX_MS`). Manifesto §15 (resiliência sem hammer).
 *
 * `_scheduleReconnect` chama `connectTo` (em `discovery.ts`) via lazy
 * dynamic import dentro do `setTimeout` callback — evita circular
 * top-level: peer → reconnect → discovery → peer. Padrão consistente
 * com o já usado em `boot.ensureSignalingAsync` (lazy de identity, wss,
 * webrtc-signaling-nostr).
 */

const _RECONNECT_CONSTANTS_INTERNAL = {
  BASE_MS: 1000,
  MAX_MS: 30_000,
  MAX_ATTEMPTS: 5,
} as const

/** Re-exportado em `webrtc/index.ts` como `_RECONNECT_CONSTANTS`.
 *  `webrtc-reconnect.test.ts` lê pra checar BASE_MS/MAX_ATTEMPTS. */
export const _RECONNECT_CONSTANTS = _RECONNECT_CONSTANTS_INTERNAL

/** Calcula delay do próximo reconnect. attempt=0→1s, 1→2s, ..., cap em MAX_MS.
 *  Função pura — testável sem state.
 *  Re-exportado em `webrtc/index.ts` como `_computeBackoffDelay`. */
export function _computeBackoffDelay(attempt: number): number {
  const { BASE_MS, MAX_MS } = _RECONNECT_CONSTANTS_INTERNAL
  const exp = BASE_MS * Math.pow(2, attempt)
  return Math.min(exp, MAX_MS)
}

/** Counter de tentativas de reconexão por peer. Reset em sucesso. */
const reconnectAttempts = new Map<string, number>()
/** Timer pendente por peer (cancela em sucesso ou close). */
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Test-only: limpa state de reconnect.
 *  Re-exportado em `webrtc/index.ts` como `_resetReconnectCounter`. */
export function _resetReconnectCounter(peerId: string): void {
  reconnectAttempts.delete(peerId)
  const t = reconnectTimers.get(peerId)
  if (t) {
    clearTimeout(t)
    reconnectTimers.delete(peerId)
  }
}

/**
 * Schedule reconexão com backoff. Retorna delay aplicado em ms, ou null
 * se MAX_ATTEMPTS atingido (giveup).
 *
 * Função de side-effect — caller decide se chamar (em modo mock,
 * peer.id é UUID per-tab que nunca volta; gating fica no caller).
 *
 * Re-exportado em `webrtc/index.ts` como `_scheduleReconnect`.
 */
export function _scheduleReconnect(peerId: string): number | null {
  const attempt = reconnectAttempts.get(peerId) ?? 0
  if (attempt >= _RECONNECT_CONSTANTS_INTERNAL.MAX_ATTEMPTS) {
    console.warn('[webrtc] reconnect cap atingido pra', peerId.slice(0, 8))
    reconnectAttempts.delete(peerId)
    return null
  }

  const delay = _computeBackoffDelay(attempt)
  reconnectAttempts.set(peerId, attempt + 1)

  // Cancela timer pendente (caso scheduleReconnect seja chamado 2× rápido).
  const existing = reconnectTimers.get(peerId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    reconnectTimers.delete(peerId)
    console.info(
      '[webrtc] reconnect attempt',
      attempt + 1,
      'pra',
      peerId.slice(0, 8),
    )
    // Lazy dynamic import pra evitar circular reconnect ↔ discovery
    // top-level. setTimeout já é assíncrono — custo é zero perceptível.
    void import('./discovery').then(({ connectTo }) =>
      connectTo(peerId).catch(() => {
        /* falha já vai re-trigger reconnect via onconnectionstatechange */
      }),
    )
  }, delay)
  reconnectTimers.set(peerId, timer)
  return delay
}
