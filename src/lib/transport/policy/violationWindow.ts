/**
 * transport/policy/violationWindow — sliding-window violation tracker (puro).
 *
 * Extraído de webrtc/peer.ts (`recordCrossProtoViolation`) e
 * webrtc/rateLimit.ts (rateViolations bookkeeping). Padrão idêntico em
 * ambos: push timestamp, cap defensivo, prune por cutoff de janela,
 * verificar threshold. Refactor S2 (Ted/Barney audit 2026-05-08): extrair
 * antes da terceira ocorrência divergir (Tor health checks Fase 6.4+).
 *
 * Função 100% pura: muta o array passado in-place (necessário pra
 * preservar identidade do array já alocado em PeerState), mas não toca
 * relógio, side-effects de console/network ou estado global.
 *
 * Manifesto §7 — determinismo: mesmas (arr, now, cfg) → mesmo retorno
 * + mesmo estado pós-mutação. Tested em tests/policy-violationWindow.test.ts.
 */

export interface ViolationWindowConfig {
  /** Janela deslizante em ms — violações com timestamp < (now - windowMs) são pruned. */
  windowMs: number
  /** Cap absoluto do array — defesa contra spammer extremo (mantém os mais novos). */
  cap: number
  /** Count em janela que dispara `tripped=true` (caller decide ação). */
  threshold: number
}

export interface ViolationWindowResult {
  /** Número de violações dentro da janela após push/prune/cap. */
  count: number
  /** `true` se `count >= threshold` — caller decide kill/blacklist/etc. */
  tripped: boolean
}

/**
 * Registra uma violação no array `arr` (in-place), aplicando cap e prune.
 *
 * Ordem das operações (mantém compat exata com call sites originais):
 *  1. push(now)
 *  2. cap pelos N mais novos (splice front se length > cap)
 *  3. prune front enquanto arr[0] < cutoff (now - windowMs)
 *  4. retorna { count: arr.length, tripped: count >= threshold }
 *
 * Caller controla side-effects pós-tripped (cleanup, blacklist, etc.) —
 * função aqui só conta e sinaliza.
 */
export function recordViolation(
  arr: number[],
  now: number,
  cfg: ViolationWindowConfig,
): ViolationWindowResult {
  arr.push(now)
  if (arr.length > cfg.cap) {
    arr.splice(0, arr.length - cfg.cap)
  }
  const cutoff = now - cfg.windowMs
  while (arr.length && arr[0]! < cutoff) {
    arr.shift()
  }
  const count = arr.length
  return { count, tripped: count >= cfg.threshold }
}
