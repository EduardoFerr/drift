/**
 * useLiquidRipple — refração líquida REAL no toque via SVG
 * `feDisplacementMap`.
 *
 * V_2026-05-29 (user pedido: "refração líquida REAL no toque").
 * Spike GO A-scoped: `Docs/sessions/ripple-refraction-spike-2026-05-29.md`.
 *
 * Diferente de `useMaterialRipple` (overlay alpha — pixel atrás NÃO se
 * move), aqui os **children do elemento-alvo** sofrem deslocamento
 * físico de pixels: cristas de onda = lente convexa (empurra fora),
 * vales comprimem (puxam dentro). É o DOM dobrando, não overlay.
 *
 * ── Física (modelo de gota num fluido) ────────────────────────────
 *
 *   offset(r, t) = A(t) · sin(k·r − ω·t) · falloff(r)
 *
 *     r        = distância radial normalizada (0..1) ao epicentro
 *     k        = número de onda (2π / WAVELENGTH) → espaçamento dos anéis
 *     ω·t      = fase que avança no tempo → anéis viajam pra fora
 *     A(t)     = A0 · e^(−t/τ)        → energia dissipa (decay temporal)
 *     falloff  = (1 − r)^FALLOFF_EXP  → onda enfraquece longe do centro
 *
 *   Um envelope sin(πk) extra (k = progresso 0..1) faz a amplitude
 *   subir de 0 e morrer em 0 — sem corte abrupto no início/fim.
 *
 * O valor de `offset` é codificado na **luminância** de um
 * `radialGradient` (12 stops amostrando o seno). 128 = neutro (sem
 * deslocamento); >128 = crista (R/G channels empurram pixel pra fora);
 * <128 = vale (puxa pra dentro). `feDisplacementMap` lê R→dx, G→dy.
 *
 * ── Como usar ──────────────────────────────────────────────────────
 *
 *   const liquid = useLiquidRipple()
 *   <div ref={liquid.targetRef} className={`liquid-ripple-host ${...}`}>
 *     {conteúdo que vai refratar}
 *   </div>
 *   // dispara com o epicentro relativo ao alvo (0..1 em x/y):
 *   liquid.fire({ x, y })
 *
 * `fire` aplica `filter: url(#drift-liquid-ripple-N)` no alvo, roda um
 * RAF de ~750ms variando `scale` + o `href` do `feImage`, e ao
 * dissipar REMOVE o filtro (volta plano). Idempotente: chamar `fire`
 * de novo cancela o RAF anterior e reinicia.
 *
 * ── §1 trade-off ───────────────────────────────────────────────────
 * Refração exige RAF DURANTE a animação (~750ms) — variar `scale` e
 * regenerar o gradiente por frame não cabe em `@keyframes` puro. RAF é
 * cancelado na dissipação e o `filter`/`will-change` são removidos do
 * elemento. Idle = zero JS, sem filtro ativo ocioso. Scoped: o filtro
 * vive só no container do card tocado (não tela inteira → não re-render
 * full-screen, não quebra position:fixed da NavBar). Spike §1.A.
 *
 * ── reduced-motion / capability (WCAG 2.3.3) ──────────────────────
 * `prefers-reduced-motion: reduce` OU `disabled` → `fire` é no-op
 * total (nunca monta filtro, nunca inicia RAF). O caller deve combinar
 * com `useMaterialRipple` como fallback plano. Defesa em profundidade
 * extra no CSS (`.liquid-ripple-host { filter: none }` sob a media).
 *
 * Sem libs externas: SVG + `requestAnimationFrame` + DOM imperativo,
 * tudo built-in. Mesma filosofia de `useMaterialRipple`.
 */

import { useCallback, useEffect, useRef } from 'react'

/** Epicentro do toque, em coordenadas normalizadas (0..1) do alvo. */
export interface LiquidEpicenter {
  x: number
  y: number
}

export interface UseLiquidRippleOptions {
  /**
   * Quando `true`, `fire` vira no-op (sem filtro, sem RAF). Use pra
   * gate por setting (`prefs.liquid_ripple === false`) ou contexto que
   * não quer o efeito. `prefers-reduced-motion` já é tratado
   * internamente — não precisa passar aqui.
   */
  disabled?: boolean
  /** Duração total até dissipar (ms). Default 750. */
  durationMs?: number
  /**
   * Deslocamento de pico em px (força da lente convexa). Default 34.
   * >40 vira "vidro derretido" exagerado; <20 fica sutil demais.
   */
  maxScale?: number
}

export interface UseLiquidRippleResult {
  /** Ref no elemento cujos CHILDREN vão refratar (o container do card). */
  targetRef: React.RefObject<HTMLElement>
  /**
   * Dispara a onda a partir do epicentro (coord normalizada 0..1 do
   * alvo). No-op sob reduced-motion / disabled / sem targetRef montado.
   */
  fire: (epicenter: LiquidEpicenter) => void
  /** `true` quando o efeito está fisicamente disponível (não reduced, não disabled). */
  enabled: boolean
}

// ── Parâmetros físicos da onda ───────────────────────────────────────
const MAP_SIZE = 256 // resolução do raster do displacement map
const STOPS = 12 // nº de amostras do seno no radialGradient
const WAVELENGTH = 0.16 // fração do disco por anel (menor = mais anéis)
const FALLOFF_EXP = 1.4 // expoente da atenuação radial (1−r)^exp
const TAU = 0.42 // constante de decay temporal (e^(−k/τ))
const OMEGA_TURNS = 3.2 // voltas de fase ao longo da animação (anéis viajam)

// Contador global pra IDs únicos de filtro (múltiplos hosts coexistem
// sem colidir o `url(#...)`).
let filterSeq = 0

/**
 * Gera o data-URI SVG do displacement map num instante da onda.
 * Pura: mesma entrada → mesmo SVG. cx/cy em 0..1 (epicentro).
 */
function buildDisplacementMap(
  cx: number,
  cy: number,
  phase: number,
  amp: number,
): string {
  let stops = ''
  for (let i = 0; i <= STOPS; i++) {
    const r = i / STOPS
    const falloff = Math.pow(1 - r, FALLOFF_EXP)
    const sine = Math.sin((r / WAVELENGTH) * Math.PI * 2 - phase)
    const raw = 128 + sine * falloff * amp * 127
    const v = Math.max(0, Math.min(255, Math.round(raw)))
    // R e G iguais → deslocamento radial simétrico (dx,dy proporcionais).
    // B fixo em 128 (sem uso). Stop em % da distância radial.
    stops += `<stop offset="${(r * 100).toFixed(1)}%" stop-color="rgb(${v},${v},128)"/>`
  }
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${MAP_SIZE}' height='${MAP_SIZE}'>` +
    `<defs><radialGradient id='g' cx='${(cx * 100).toFixed(1)}%' cy='${(cy * 100).toFixed(1)}%' r='75%'>` +
    stops +
    `</radialGradient></defs>` +
    // base neutra (cinza) garante 128,128 fora do alcance do gradiente
    `<rect width='${MAP_SIZE}' height='${MAP_SIZE}' fill='rgb(128,128,128)'/>` +
    `<rect width='${MAP_SIZE}' height='${MAP_SIZE}' fill='url(#g)'/></svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

/**
 * Injeta (uma vez) o <filter> SVG no <body> e devolve os elementos
 * cujos atributos são animados. Idempotente por id.
 */
function ensureFilterDefs(id: string): {
  feImage: SVGFEImageElement
  feDisp: SVGFEDisplacementMapElement
} | null {
  if (typeof document === 'undefined') return null
  const existing = document.getElementById(id)
  if (existing) {
    const fe = existing.querySelector('feImage') as SVGFEImageElement | null
    const fd = existing.querySelector(
      'feDisplacementMap',
    ) as SVGFEDisplacementMapElement | null
    if (fe && fd) return { feImage: fe, feDisp: fd }
  }
  const NS = 'http://www.w3.org/2000/svg'
  let host = document.getElementById('drift-liquid-defs') as SVGSVGElement | null
  if (!host) {
    host = document.createElementNS(NS, 'svg')
    host.setAttribute('id', 'drift-liquid-defs')
    host.setAttribute('width', '0')
    host.setAttribute('height', '0')
    host.setAttribute('aria-hidden', 'true')
    host.style.position = 'absolute'
    host.style.width = '0'
    host.style.height = '0'
    host.style.overflow = 'hidden'
    document.body.appendChild(host)
  }
  const filter = document.createElementNS(NS, 'filter')
  filter.setAttribute('id', id)
  // Margem generosa pra onda não clipar nas bordas do filter region.
  filter.setAttribute('x', '-30%')
  filter.setAttribute('y', '-30%')
  filter.setAttribute('width', '160%')
  filter.setAttribute('height', '160%')
  filter.setAttribute('color-interpolation-filters', 'sRGB')

  const feImage = document.createElementNS(NS, 'feImage') as SVGFEImageElement
  feImage.setAttribute('result', 'map')
  feImage.setAttribute('preserveAspectRatio', 'none')

  const feDisp = document.createElementNS(
    NS,
    'feDisplacementMap',
  ) as SVGFEDisplacementMapElement
  feDisp.setAttribute('in', 'SourceGraphic')
  feDisp.setAttribute('in2', 'map')
  feDisp.setAttribute('scale', '0')
  feDisp.setAttribute('xChannelSelector', 'R')
  feDisp.setAttribute('yChannelSelector', 'G')

  filter.appendChild(feImage)
  filter.appendChild(feDisp)
  host.appendChild(filter)
  return { feImage, feDisp }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function useLiquidRipple(
  opts: UseLiquidRippleOptions = {},
): UseLiquidRippleResult {
  const { disabled = false, durationMs = 750, maxScale = 34 } = opts
  const targetRef = useRef<HTMLElement>(null)
  const rafRef = useRef<number | null>(null)
  // ID estável por instância do hook (um filtro por host).
  const filterIdRef = useRef<string>('')
  if (filterIdRef.current === '') {
    filterIdRef.current = `drift-liquid-ripple-${filterSeq++}`
  }

  // reduced-motion é avaliado no fire (não no render) pra refletir
  // mudança de preferência em runtime sem remount.
  const enabled = !disabled

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const el = targetRef.current
    if (el) {
      el.style.filter = ''
      el.style.willChange = ''
    }
  }, [])

  // Cancela RAF + limpa filtro no unmount (sem leak; idle zero-JS).
  useEffect(() => cleanup, [cleanup])

  const fire = useCallback(
    (epicenter: LiquidEpicenter) => {
      if (disabled) return
      if (prefersReducedMotion()) return // WCAG 2.3.3 — bypass total
      const el = targetRef.current
      if (!el) return

      const defs = ensureFilterDefs(filterIdRef.current)
      if (!defs) return // SSR / sem document
      const { feImage, feDisp } = defs

      // Reinício limpo se já houver uma onda em curso.
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

      const cx = Math.max(0, Math.min(1, epicenter.x))
      const cy = Math.max(0, Math.min(1, epicenter.y))
      const t0 = performance.now()

      el.style.filter = `url(#${filterIdRef.current})`
      el.style.willChange = 'filter'

      const frame = (t: number): void => {
        const k = (t - t0) / durationMs // progresso 0..1
        if (k >= 1) {
          feDisp.setAttribute('scale', '0')
          cleanup() // remove filter + will-change, cancela RAF
          return
        }
        // A(t) = e^(−k/τ) · sin(πk) → sobe de 0, dissipa em 0.
        const decay = Math.exp(-k / TAU)
        const envelope = Math.sin(k * Math.PI)
        const amp = decay * envelope
        const phase = k * Math.PI * OMEGA_TURNS // anéis viajam pra fora

        feDisp.setAttribute('scale', String(maxScale * amp))
        feImage.setAttribute('href', buildDisplacementMap(cx, cy, phase, 1))
        rafRef.current = requestAnimationFrame(frame)
      }
      rafRef.current = requestAnimationFrame(frame)
    },
    [disabled, durationMs, maxScale, cleanup],
  )

  return { targetRef, fire, enabled }
}
