/**
 * transport/policy/clockClamp — sanitização de timestamp peer-supplied (puro).
 *
 * Surgido de Threat audit T3 (Barney audit 2026-05-08): Date.now() é
 * input não-confiável quando vem de mensagem de peer (signaling msg.ts,
 * pong pingTs, hello ts...). Atacante pode forjar timestamps no futuro
 * (fingir frescor) ou no passado (replay). Clampar pra janela ±N do
 * relógio local rejeita ambos extremos sem confiar no clock do peer.
 *
 * Função 100% pura: recebe `peerTs` e `localNow` como parâmetros, sem
 * tocar relógio nem estado global. Manifesto §7 (determinismo).
 *
 * Diferença pra `pingPongTracker.validatePong` (que cobre membership
 * 1:1 + RTT): clockClamp NÃO valida pareamento — só rejeita timestamps
 * impossíveis. Usados em conjunto: clamp primeiro (cheap), depois
 * validatePong (membership lookup).
 *
 * Tested em tests/webrtc-threat-T3-clock-protection.test.ts.
 */

export interface ClockClampConfig {
  /** Tolerância máxima do timestamp peer estar à FRENTE do nosso relógio (ms).
   *  Atacante mandando ts=now+1e9 (clock skew falso) é dropado. */
  maxFutureSkewMs: number
  /** Tolerância máxima do timestamp peer estar ATRÁS do nosso relógio (ms).
   *  Atacante replay-attack de mensagem antiga é dropado. */
  maxPastSkewMs: number
}

export interface ClockClampResult {
  /** `true` se peerTs está dentro de [localNow - maxPast, localNow + maxFuture]. */
  ok: boolean
  /** Motivo do reject — útil pra log/telemetria. `null` se ok. */
  reason: 'future' | 'past' | 'invalid' | null
  /** Skew em ms (peerTs - localNow). Positivo = peer no futuro. */
  skewMs: number
}

/**
 * Valida que `peerTs` está dentro da janela de tolerância contra
 * `localNow`. Não muta nada; retorna decisão pura.
 *
 * Comportamento:
 *  - peerTs não-finite/NaN/negativo → `ok=false, reason='invalid'`
 *  - peerTs > localNow + maxFutureSkewMs → `ok=false, reason='future'`
 *  - peerTs < localNow - maxPastSkewMs → `ok=false, reason='past'`
 *  - caso contrário → `ok=true`
 */
export function clampPeerTimestamp(
  peerTs: number,
  localNow: number,
  cfg: ClockClampConfig,
): ClockClampResult {
  if (!Number.isFinite(peerTs) || peerTs < 0) {
    return { ok: false, reason: 'invalid', skewMs: 0 }
  }
  const skewMs = peerTs - localNow
  if (skewMs > cfg.maxFutureSkewMs) {
    return { ok: false, reason: 'future', skewMs }
  }
  if (-skewMs > cfg.maxPastSkewMs) {
    return { ok: false, reason: 'past', skewMs }
  }
  return { ok: true, reason: null, skewMs }
}
