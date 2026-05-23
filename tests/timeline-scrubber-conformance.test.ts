// TimelineScrubber — LOCK_VIA_TEST conformance.
//
// Source: User pedido 2026-05-22 — "Os mapas que possuem animação,
// precisa de uma barra de lapso temporal, para termos noção do tempo
// decorrido entre os eventos ali registrados e exibidos."
//
// Cobre:
//   1. Componente exporta + recebe events Array<{ created_at: number }>
//   2. Helpers puros (computeTimelineRange + formatRelativePtBr) com
//      casos canônicos
//   3. Edge cases: array vazio (não renderiza), 1 evento, todos no
//      mesmo instante (span=0)
//   4. PT-BR labels relativos (agora/min/h/ontem/d/sem/mês/a)
//   5. Integrado no SpreadMap MapShell (timelineEvents prop)
//   6. Pointer-events-none (não bloqueia gesture do mapa)
//   7. Reduced motion respect (sem transitions impostas)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  computeTimelineRange,
  formatRelativePtBr,
  counterLabelForMode,
} from '../src/components/Feed/TimelineScrubber'

const SCRUBBER = readFileSync('src/components/Feed/TimelineScrubber.tsx', 'utf8')
const SPREAD_MAP = readFileSync('src/components/Feed/SpreadMap.tsx', 'utf8')

describe('TimelineScrubber — exports + props', () => {
  it('exporta TimelineScrubber component', () => {
    expect(SCRUBBER).toMatch(/export function TimelineScrubber/)
  })

  it('exporta TimelineScrubberProps interface', () => {
    expect(SCRUBBER).toMatch(/export interface TimelineScrubberProps/)
  })

  it('aceita events Array<{ created_at: number }> (alinhado ao SQLite)', () => {
    expect(SCRUBBER).toMatch(/events:\s*Array<\{\s*created_at:\s*number\s*\}>/)
  })

  it('aceita currentTime opcional (preparado pra modo interactive futuro)', () => {
    expect(SCRUBBER).toMatch(/currentTime\?:\s*number/)
  })

  it('exporta helpers puros (testáveis em isolation)', () => {
    expect(SCRUBBER).toMatch(/export function computeTimelineRange/)
    expect(SCRUBBER).toMatch(/export function formatRelativePtBr/)
  })

  it('usa pointer-events-none na trilha (não bloqueia gesture do mapa)', () => {
    expect(SCRUBBER).toMatch(/pointer-events-none/)
  })

  it('tem aria-label descritivo no group container (a11y)', () => {
    expect(SCRUBBER).toMatch(/aria-label=\{[^}]*linha do tempo/)
  })
})

describe('formatRelativePtBr — labels PT-BR', () => {
  const NOW = 1_700_000_000 // arbitrary anchor

  it('< 60s = "agora"', () => {
    expect(formatRelativePtBr(NOW - 30, NOW)).toBe('agora')
    expect(formatRelativePtBr(NOW, NOW)).toBe('agora')
  })

  it('< 60min = "Xmin atrás"', () => {
    expect(formatRelativePtBr(NOW - 60, NOW)).toBe('1min atrás')
    expect(formatRelativePtBr(NOW - 1800, NOW)).toBe('30min atrás')
  })

  it('< 24h = "Xh atrás"', () => {
    expect(formatRelativePtBr(NOW - 3600, NOW)).toBe('1h atrás')
    expect(formatRelativePtBr(NOW - 12 * 3600, NOW)).toBe('12h atrás')
  })

  it('1d = "ontem"', () => {
    expect(formatRelativePtBr(NOW - 86400, NOW)).toBe('ontem')
  })

  it('< 7d = "Xd atrás"', () => {
    expect(formatRelativePtBr(NOW - 3 * 86400, NOW)).toBe('3d atrás')
  })

  it('< 30d = "Xsem atrás"', () => {
    expect(formatRelativePtBr(NOW - 10 * 86400, NOW)).toBe('1sem atrás')
    expect(formatRelativePtBr(NOW - 21 * 86400, NOW)).toBe('3sem atrás')
  })

  it('< 365d = "Xmês atrás"', () => {
    expect(formatRelativePtBr(NOW - 60 * 86400, NOW)).toBe('2mês atrás')
  })

  it('>= 365d = "Xa atrás"', () => {
    expect(formatRelativePtBr(NOW - 400 * 86400, NOW)).toBe('1a atrás')
  })

  it('timestamp no futuro clamp = "agora" (defensivo)', () => {
    expect(formatRelativePtBr(NOW + 100, NOW)).toBe('agora')
  })
})

describe('computeTimelineRange — pure helper', () => {
  it('array vazio → null (não renderiza)', () => {
    expect(computeTimelineRange([])).toBeNull()
  })

  it('1 evento → range degenerado (span=0), tick centralizado', () => {
    const result = computeTimelineRange([{ created_at: 1000 }])
    expect(result).not.toBeNull()
    expect(result!.min).toBe(1000)
    expect(result!.max).toBe(1000)
    expect(result!.ticks).toEqual([0.5])
    expect(result!.count).toBe(1)
  })

  it('todos os eventos no mesmo instante → span=0, 1 tick central', () => {
    const result = computeTimelineRange([
      { created_at: 500 },
      { created_at: 500 },
      { created_at: 500 },
    ])
    expect(result!.ticks).toEqual([0.5])
  })

  it('eventos espalhados → ticks normalizados [0,1]', () => {
    const result = computeTimelineRange([
      { created_at: 100 },
      { created_at: 200 },
      { created_at: 300 },
    ])
    expect(result!.min).toBe(100)
    expect(result!.max).toBe(300)
    expect(result!.ticks).toEqual([0, 0.5, 1])
    expect(result!.count).toBe(3)
  })

  it('filtra timestamps inválidos (NaN/Infinity/0/negativos)', () => {
    const result = computeTimelineRange([
      { created_at: 100 },
      { created_at: NaN },
      { created_at: Infinity },
      { created_at: 0 },
      { created_at: -50 },
      { created_at: 200 },
    ])
    expect(result!.count).toBe(2)
    expect(result!.min).toBe(100)
    expect(result!.max).toBe(200)
  })

  it('só inválidos → null', () => {
    const result = computeTimelineRange([
      { created_at: NaN },
      { created_at: 0 },
    ])
    expect(result).toBeNull()
  })
})

describe('counterLabelForMode — Ted polish #8a (label por mode)', () => {
  it('post mode → "X DRIFT(s) do post" (vocab UI migrado 2026-05-23)', () => {
    expect(counterLabelForMode(1, 'post')).toBe('1 DRIFT do post')
    expect(counterLabelForMode(3, 'post')).toBe('3 DRIFTs do post')
  })
  it('global mode → "X evento(s) na rede"', () => {
    expect(counterLabelForMode(1, 'global')).toBe('1 evento na rede')
    expect(counterLabelForMode(5, 'global')).toBe('5 eventos na rede')
  })
  it('network mode → "X edge(s) da sua lente"', () => {
    expect(counterLabelForMode(1, 'network')).toBe('1 edge da sua lente')
    expect(counterLabelForMode(2, 'network')).toBe('2 edges da sua lente')
  })
  it('mode undefined → fallback "X evento(s)"', () => {
    expect(counterLabelForMode(1, undefined)).toBe('1 evento')
    expect(counterLabelForMode(4, undefined)).toBe('4 eventos')
  })
})

describe('Empty state — Ted polish #8b (ocultar quando N<2)', () => {
  it('scrubber retorna null quando count < 2', () => {
    // computeTimelineRange retorna count=1 pra 1 evento; component
    // adiciona guard "range.count < 2" pra evitar lapso degenerado.
    expect(SCRUBBER).toMatch(/range\.count\s*<\s*2/)
  })
})

describe('Fill bar animado — V_2026-05-23 (user pedido)', () => {
  it('renderiza fill bar com classe drift-scrubber-fill', () => {
    expect(SCRUBBER).toMatch(/className="[^"]*drift-scrubber-fill[^"]*"/)
  })

  it('keyframe CSS drift-scrubber-fill existe em styles/timeline-scrubber.css', () => {
    const css = readFileSync('src/styles/timeline-scrubber.css', 'utf8')
    expect(css).toMatch(/@keyframes\s+drift-scrubber-fill/)
    expect(css).toMatch(/scaleX\(0\)/)
    expect(css).toMatch(/scaleX\(1\)/)
  })

  it('respeita prefers-reduced-motion (fill estático)', () => {
    const css = readFileSync('src/styles/timeline-scrubber.css', 'utf8')
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    // No bloco reduced-motion deve forçar scaleX(1) e animation none.
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/animation:\s*none/)
    expect(block![0]).toMatch(/scaleX\(1\)/)
  })

  it('CSS importado no index.css', () => {
    const idx = readFileSync('src/index.css', 'utf8')
    expect(idx).toMatch(/@import\s+'\.\/styles\/timeline-scrubber\.css'/)
  })
})

describe('Toggle ▶/⏸ — autoplay ON default', () => {
  it('componente monta com paused=false (autoplay ON default)', () => {
    // useState(false) — autoplay ligado no mount. User pode pausar.
    expect(SCRUBBER).toMatch(/useState\(false\)/)
  })

  it('botão toggle com aria-label correto pra ambos os estados', () => {
    expect(SCRUBBER).toMatch(/aria-label=\{paused\s*\?\s*'tocar animação da linha do tempo'\s*:\s*'pausar animação da linha do tempo'\}/)
  })

  it('botão usa PT-BR (vocabulário UI) — sem "play"/"pause" em inglês', () => {
    // Permite "tocar" / "pausar" em labels; rejeita "play"/"pause" em strings JSX.
    const matchPlay = SCRUBBER.match(/>\s*play\s*</i)
    const matchPause = SCRUBBER.match(/>\s*pause\s*</i)
    expect(matchPlay).toBeNull()
    expect(matchPause).toBeNull()
  })

  it('toggle button é pointer-events-auto (clicável dentro do container pointer-events-none)', () => {
    // Container do scrubber é pointer-events-none (não bloqueia gesture do mapa);
    // botão precisa re-habilitar pra ser clicável.
    expect(SCRUBBER).toMatch(/pointer-events-auto/)
  })

  it('data-paused attribute sincroniza fill + caret', () => {
    expect(SCRUBBER).toMatch(/data-paused=\{pausedAttr\}/)
  })
})

describe('Integração TimelineScrubber em SpreadMap MapShell', () => {
  it('SpreadMap importa TimelineScrubber', () => {
    expect(SPREAD_MAP).toMatch(/from '\.\/TimelineScrubber'/)
  })

  it('MapShell aceita timelineEvents prop', () => {
    expect(SPREAD_MAP).toMatch(/timelineEvents\?:\s*Array<\{\s*created_at:\s*number\s*\}>/)
  })

  it('MapShell renderiza scrubber só quando há eventos', () => {
    expect(SPREAD_MAP).toMatch(/timelineEvents\s*&&\s*timelineEvents\.length\s*>\s*0/)
  })

  it('post mode passa destinations timestamps pro scrubber', () => {
    expect(SPREAD_MAP).toMatch(/timelineEvents=\{data\.destinations\.map\([\s\S]{0,80}createdAt/)
  })
})
