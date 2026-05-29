/**
 * useTimelineClock — relógio compartilhado único pros mapas animados.
 *
 * Bug fix 2026-05-29 (Ted+Lily): antes existiam DOIS loops independentes
 * pro mesmo fenômeno temporal:
 *   - GlobalModeMap tinha um RAF próprio (`ANIM_DURATION` 8s) avançando um
 *     progresso interno `p` que dirigia o draw-on dos arcos.
 *   - TimelineScrubber tinha SUA animação CSS (fill scaleX 0→1) + estado
 *     `paused` local que controlava SÓ o fill.
 * Resultado: (1) duração errada (8s, não 30s); (2) play/pause da barra não
 * pausava os arcos; (3) os arcos desenhavam pelo tempo-interno deles, não
 * gated pela posição da barra → "tudo de uma vez".
 *
 * Este hook é a FONTE ÚNICA DA VERDADE: um RAF avança `currentTime` (0→1)
 * sobre `durationMs`. Scrubber e arcos LEEM `currentTime` — não rodam loops
 * próprios. `paused` congela o relógio (afeta AMBOS juntos). Ao chegar a 1,
 * pausa breve (`pauseMs`) e reinicia em 0 (loop).
 *
 * Pureza/determinismo (manifesto §7): o avanço usa `performance.now()` como
 * relógio de parede (inevitável pra animação real-time), mas a LÓGICA de
 * gating dos arcos a partir de `currentTime` é pura (em SpreadMap). O hook
 * só produz o cursor; o que se desenha em cada cursor é determinístico.
 *
 * WCAG 2.3.3: com `reducedMotion`, NÃO arranca RAF — `currentTime` fica
 * estático em 1 (todos os arcos full, scrubber cheio). Sem movimento.
 *
 * Perf: 1 RAF por mapa animado (não 2). O setState a 60fps é barato — só
 * um número; o custo real é o re-render do overlay deck.gl, que já existia.
 */

import { useEffect, useRef, useState } from 'react'

/** Duração canônica de um ciclo completo da timeline. LOCK_VIA_TEST. */
export const TIMELINE_DURATION_MS = 30_000

/** Pausa entre o fim de um ciclo (currentTime=1) e o restart (0). */
export const TIMELINE_PAUSE_MS = 2_000

export interface TimelineClock {
  /** Cursor temporal normalizado [0,1]. Fonte única pra scrubber + arcos. */
  currentTime: number
  /** True quando o relógio está congelado (pausado pelo user ou reduced). */
  paused: boolean
  /** Alterna pausa. No-op sob reduced-motion (não há clock pra pausar). */
  togglePaused: () => void
}

export interface UseTimelineClockOptions {
  /** Duração de um ciclo em ms. Default 30s (TIMELINE_DURATION_MS). */
  durationMs?: number
  /** Pausa entre ciclos em ms. Default 2s. */
  pauseMs?: number
  /**
   * WCAG 2.3.3: quando true, não roda RAF. currentTime=1 estático
   * (todos arcos full, scrubber cheio). toggle vira no-op.
   */
  reducedMotion?: boolean
  /**
   * Estado inicial de pausa (autoplay OFF se true). Default false —
   * autoplay ON, espelhando o comportamento histórico do scrubber.
   */
  initialPaused?: boolean
}

/**
 * Cria o relógio único. Um RAF avança currentTime; pausar congela o cursor
 * (não reseta). Loop com pausa no fim do ciclo.
 */
export function useTimelineClock({
  durationMs = TIMELINE_DURATION_MS,
  pauseMs = TIMELINE_PAUSE_MS,
  reducedMotion = false,
  initialPaused = false,
}: UseTimelineClockOptions = {}): TimelineClock {
  // Sob reduced-motion o relógio "já chegou ao fim": cursor cheio, estático.
  const [currentTime, setCurrentTime] = useState(reducedMotion ? 1 : 0)
  const [paused, setPaused] = useState(initialPaused)

  // Refs pra acumular tempo decorrido SEM resetar ao pausar/despausar.
  // `elapsedRef` guarda o progresso (ms dentro do ciclo) já consumido;
  // `lastTsRef` é o timestamp do último frame (null quando o RAF não está
  // ativo, ex. logo após despausar). Assim despausar retoma de onde parou.
  const elapsedRef = useRef(reducedMotion ? durationMs : 0)
  const lastTsRef = useRef<number | null>(null)
  const holdingRef = useRef(false) // true durante a pausa de fim-de-ciclo

  useEffect(() => {
    if (reducedMotion) {
      // Estático: cursor cheio, sem RAF.
      elapsedRef.current = durationMs
      setCurrentTime(1)
      return
    }
    if (paused) {
      // Congela: solta o RAF mas preserva elapsedRef pra retomar.
      lastTsRef.current = null
      return
    }

    let rafId = 0
    let holdTimer: ReturnType<typeof setTimeout> | undefined

    const tick = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts
      const delta = ts - lastTsRef.current
      lastTsRef.current = ts

      if (!holdingRef.current) {
        elapsedRef.current += delta
      }

      const p = Math.min(elapsedRef.current / durationMs, 1)
      setCurrentTime(p)

      if (p >= 1 && !holdingRef.current) {
        // Fim do ciclo: segura cheio por pauseMs, depois reinicia em 0.
        holdingRef.current = true
        holdTimer = setTimeout(() => {
          elapsedRef.current = 0
          holdingRef.current = false
          lastTsRef.current = null // próximo frame re-ancora o delta
        }, pauseMs)
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafId)
      if (holdTimer) clearTimeout(holdTimer)
      lastTsRef.current = null
    }
  }, [paused, reducedMotion, durationMs, pauseMs])

  return {
    currentTime,
    paused: reducedMotion ? true : paused,
    togglePaused: () => {
      if (reducedMotion) return
      setPaused((p) => !p)
    },
  }
}
