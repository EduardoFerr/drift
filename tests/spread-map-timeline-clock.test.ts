// @vitest-environment jsdom
//
// useTimelineClock — behavioral LOCK_VIA_TEST (Ted+Lily 2026-05-29).
//
// Relógio compartilhado único pros mapas animados. Antes scrubber e arcos
// rodavam DOIS loops independentes; este hook é a fonte única. Cobre o
// comportamento RUNTIME (não só presença textual):
//   - currentTime avança 0→1 sobre 30s (DURATION canônica)
//   - paused congela o cursor (não reseta) e retoma de onde parou
//   - loop: ao chegar a 1, segura e reinicia em 0
//   - reduced-motion: currentTime=1 estático, sem RAF, toggle no-op
//
// RAF é fake-driven via fila controlada + performance.now() falso, então o
// teste é determinístico (manifesto §7) apesar de exercitar animação.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useTimelineClock,
  TIMELINE_DURATION_MS,
  TIMELINE_PAUSE_MS,
} from '../src/hooks/useTimelineClock'

// ─── Fake RAF + clock determinístico ──────────────────────────────────
let nowMs = 0
let rafQueue: Array<(ts: number) => void> = []

function flushFrame(advanceMs: number): void {
  nowMs += advanceMs
  const due = rafQueue
  rafQueue = []
  for (const cb of due) cb(nowMs)
}

beforeEach(() => {
  nowMs = 0
  rafQueue = []
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => {
    rafQueue.push(cb)
    return rafQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafQueue = []
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useTimelineClock — duração canônica', () => {
  it('exporta DURATION = 30000ms (30s)', () => {
    expect(TIMELINE_DURATION_MS).toBe(30_000)
  })

  it('currentTime avança de 0 a ~0.5 na metade dos 30s', () => {
    const { result } = renderHook(() => useTimelineClock())
    expect(result.current.currentTime).toBe(0)

    // 1º frame ancora lastTs (delta 0); 2º frame avança 15s = metade.
    act(() => flushFrame(0))
    act(() => flushFrame(TIMELINE_DURATION_MS / 2))

    expect(result.current.currentTime).toBeCloseTo(0.5, 5)
    expect(result.current.currentTime).toBeLessThan(1)
  })

  it('currentTime satura em 1 ao completar os 30s', () => {
    const { result } = renderHook(() => useTimelineClock())
    act(() => flushFrame(0))
    act(() => flushFrame(TIMELINE_DURATION_MS))
    expect(result.current.currentTime).toBe(1)
  })
})

describe('useTimelineClock — play/pause congela o cursor', () => {
  it('paused congela currentTime (não avança, não reseta)', () => {
    const { result } = renderHook(() => useTimelineClock())
    act(() => flushFrame(0))
    act(() => flushFrame(TIMELINE_DURATION_MS / 3)) // ~0.333
    const frozenAt = result.current.currentTime
    expect(frozenAt).toBeGreaterThan(0.3)

    act(() => result.current.togglePaused())
    expect(result.current.paused).toBe(true)

    // Mesmo "passando tempo", sem RAF agendado o cursor não muda.
    act(() => flushFrame(TIMELINE_DURATION_MS))
    expect(result.current.currentTime).toBeCloseTo(frozenAt, 5)
  })

  it('despausar retoma de onde parou (não do zero)', () => {
    const { result } = renderHook(() => useTimelineClock())
    act(() => flushFrame(0))
    act(() => flushFrame(TIMELINE_DURATION_MS / 4)) // ~0.25
    const at = result.current.currentTime

    act(() => result.current.togglePaused()) // pausa
    act(() => result.current.togglePaused()) // despausa
    // Re-ancora delta no próximo frame; depois avança +1/4 → ~0.5.
    act(() => flushFrame(0))
    act(() => flushFrame(TIMELINE_DURATION_MS / 4))

    expect(result.current.currentTime).toBeGreaterThan(at)
    expect(result.current.currentTime).toBeCloseTo(0.5, 1)
  })
})

describe('useTimelineClock — loop ao fim do ciclo', () => {
  it('chega a 1, segura, e reinicia em 0 após TIMELINE_PAUSE_MS', () => {
    const { result } = renderHook(() => useTimelineClock())
    act(() => flushFrame(0))
    act(() => flushFrame(TIMELINE_DURATION_MS))
    expect(result.current.currentTime).toBe(1)

    // Durante a pausa de fim de ciclo segue em 1.
    act(() => flushFrame(16))
    expect(result.current.currentTime).toBe(1)

    // Esgota o hold timer → reinicia o ciclo.
    act(() => vi.advanceTimersByTime(TIMELINE_PAUSE_MS + 1))
    act(() => flushFrame(0)) // re-ancora
    act(() => flushFrame(TIMELINE_DURATION_MS / 2))
    expect(result.current.currentTime).toBeLessThan(1)
    expect(result.current.currentTime).toBeCloseTo(0.5, 1)
  })
})

describe('useTimelineClock — WCAG 2.3.3 reduced-motion', () => {
  it('reduced-motion → currentTime=1 estático, sem RAF agendado', () => {
    const { result } = renderHook(() =>
      useTimelineClock({ reducedMotion: true }),
    )
    expect(result.current.currentTime).toBe(1)
    expect(result.current.paused).toBe(true)
    // Nenhum frame foi agendado (loop não arranca sob reduced-motion).
    expect(rafQueue.length).toBe(0)
  })

  it('toggle é no-op sob reduced-motion (não destrava animação)', () => {
    const { result } = renderHook(() =>
      useTimelineClock({ reducedMotion: true }),
    )
    act(() => result.current.togglePaused())
    expect(result.current.paused).toBe(true)
    expect(result.current.currentTime).toBe(1)
    expect(rafQueue.length).toBe(0)
  })
})
