/**
 * transport/policy/pingPongTracker — ping/pong 1:1 tracker (puro).
 *
 * Extraído de webrtc/health.ts (`_markPing` + `_handlePong`). Refactor S2
 * (Ted/Barney audit 2026-05-08): Tor health checks (Fase 6.4 etapa 5+)
 * vão querer reusar exatamente esta lógica — extrair antes da terceira
 * ocorrência divergir.
 *
 * Funções 100% puras: mutam o array passado in-place (preserva
 * identidade do array já alocado em PeerState), sem tocar relógio nem
 * estado global.
 *
 * Threat model (Threat audit T2): pong só é aceito se corresponde a um
 * ping efetivamente enviado por nós. Atacante não pode forjar pong com
 * `pingTs ≈ now` pra fingir RTT≈0.
 */

/**
 * Registra que enviamos um ping em `now`. Faz push + prune por
 * `cutoff = now - opts.staleMs` + cap em `opts.capStale` (mantém os
 * mais novos).
 *
 * Ordem (compat com `_markPing` original):
 *  1. push(now)
 *  2. prune front enquanto arr[0] < cutoff
 *  3. cap (mantém últimos N se length > capStale)
 */
export function markPing(
  arr: number[],
  now: number,
  opts: { capStale: number; staleMs: number },
): void {
  arr.push(now)
  const cutoff = now - opts.staleMs
  while (arr.length && arr[0]! < cutoff) {
    arr.shift()
  }
  if (arr.length > opts.capStale) {
    arr.splice(0, arr.length - opts.capStale)
  }
}

export interface ValidatePongResult {
  /** `true` se pingTs estava em `arr` (consumido 1:1). */
  ok: boolean
  /** RTT em ms (`now - pingTs`) se ok, senão `null`. */
  rttMs: number | null
}

/**
 * Valida pong contra pings pendentes. Se `pingTs` está em `arr`, consome
 * (splice 1:1) e retorna `{ ok: true, rttMs: now - pingTs }`. Caso
 * contrário, `{ ok: false, rttMs: null }`.
 *
 * NÃO faz validação de staleness ou de timestamp futuro — é
 * responsabilidade do caller (defense-in-depth permanece em health.ts).
 * Aqui o foco é exclusivamente o pareamento 1:1 + cálculo de RTT.
 */
export function validatePong(
  arr: number[],
  pingTs: number,
  now: number,
): ValidatePongResult {
  if (arr.length === 0) return { ok: false, rttMs: null }
  const idx = arr.indexOf(pingTs)
  if (idx === -1) return { ok: false, rttMs: null }
  arr.splice(idx, 1)
  return { ok: true, rttMs: now - pingTs }
}
