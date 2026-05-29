/**
 * TimelineScrubber — barra horizontal de lapso temporal pros mapas
 * animados.
 *
 * V_2026-05-22 (user pedido): "Os mapas que possuem animação,
 * precisa de uma barra de lapso temporal, para termos noção do
 * tempo decorrido entre os eventos ali registrados e exibidos."
 *
 * V_2026-05-23 (user pedido): "a barra não está enchendo. Era para
 * encher da esquerda para a direita conforme o tempo passasse né?"
 *   → Fill bar autoplay ON default + toggle ▶/⏸ visível.
 *
 * V_2026-05-29 (bug fix Ted+Lily — relógio compartilhado único):
 * antes havia DOIS clocks independentes (fill CSS aqui + RAF próprio no
 * GlobalModeMap) → play/pause da barra não pausava os arcos e a barra
 * não andava em sincronia real com o mapa. Agora, quando o caller passa
 * `currentTime` (fração [0,1] do `useTimelineClock`, fonte ÚNICA da
 * verdade sobre 30s), a barra entra em modo CONTROLLED: fill width =
 * currentTime×100%, caret na mesma posição, `paused`/toggle vêm do clock.
 * É EXATAMENTE o mesmo cursor que dirige o draw-on dos arcos → barra e
 * mapa andam juntos, 1 RAF total.
 *
 * Fallback legacy (PostModeMap, sem clock): scaleX(0→1) via CSS + hold =
 * ciclo linear infinite, `paused` interno. Mantido pra não regredir o
 * mapa de post.
 *
 * Autoplay default ON (preserva spirit §22/§24 — user no controle
 * via toggle visível; não é métrica de validação social).
 *
 * WCAG 2.3.3 — `prefers-reduced-motion` força fill estático em
 * scaleX(1) — vê range completo sem animação. CSS em
 * `src/styles/timeline-scrubber.css`.
 *
 * Pure rendering — recebe events array, deriva range internamente.
 * Sem fetch; só estado local `paused` pro toggle.
 */

import { useState, type CSSProperties } from 'react'

export interface TimelineScrubberProps {
  /**
   * Eventos a representar — timestamps em SEGUNDOS (unix, mesma
   * unidade de `spreads.created_at` no SQLite Drift). Componente
   * filtra valores inválidos defensivamente.
   */
  events: Array<{ created_at: number }>
  /**
   * "Now" reference (em segundos unix). Default = Math.floor(Date.now()/1000).
   * Exposto pra testes determinísticos.
   */
  now?: number
  /**
   * Cursor temporal NORMALIZADO [0,1] do relógio compartilhado único
   * (`useTimelineClock`). Ted+Lily 2026-05-29: esta é a MESMA fonte que
   * dirige o draw-on dos arcos no GlobalModeMap — fill + caret derivam
   * dela, então a barra e o mapa andam juntos (1 clock, não 2).
   *
   * Quando definido: fill width = currentTime×100%, caret em currentTime,
   * e o componente entra em modo CONTROLLED (paused/onTogglePaused vêm de
   * fora; sem animação CSS própria). Omitido (PostModeMap legacy): cai no
   * fallback CSS autoplay com `paused` interno.
   *
   * Nota: antes era timestamp em segundos; agora é fração [0,1]. O range
   * real (min/max timestamps) continua vindo de `events` pros labels.
   */
  currentTime?: number
  /**
   * Estado de pausa CONTROLLED (só efetivo quando `currentTime` definido).
   * Reflete o `paused` do relógio único — pausar a barra pausa os arcos e
   * vice-versa. Omitido → componente usa estado interno (fallback legacy).
   */
  paused?: boolean
  /**
   * Callback do toggle ▶/⏸ no modo controlled. Alterna o `paused` do
   * relógio compartilhado (afeta scrubber + arcos juntos).
   */
  onTogglePaused?: () => void
  /**
   * Ted polish 2026-05-22: semântica do label varia por mode. Caller
   * (MapShell) passa o mode pra customizar o counter:
   *   - 'post'    → "N DRIFTs do post"
   *   - 'global'  → "N eventos na rede"
   *   - 'network' → "N edges da sua lente"
   * Default (undefined) → "N eventos" (fallback genérico).
   */
  mode?: 'post' | 'global' | 'network'
  /** className adicional. */
  className?: string
}

/**
 * Label do counter por mode — pure function exportada pra teste.
 * Ted polish 2026-05-22 (audit ted-maps-review #8a — semântica per-mode).
 */
export function counterLabelForMode(
  count: number,
  mode: TimelineScrubberProps['mode'],
): string {
  if (mode === 'post') {
    return `${count} ${count === 1 ? 'DRIFT do post' : 'DRIFTs do post'}`
  }
  if (mode === 'global') {
    return `${count} ${count === 1 ? 'evento na rede' : 'eventos na rede'}`
  }
  if (mode === 'network') {
    return `${count} ${count === 1 ? 'edge da sua lente' : 'edges da sua lente'}`
  }
  return `${count} ${count === 1 ? 'evento' : 'eventos'}`
}

/**
 * Formata timestamp como tempo relativo PT-BR. Pure function exportada
 * pra testes.
 *
 *   < 60s   → "agora"
 *   < 60min → "Xmin atrás"
 *   < 24h   → "Xh atrás"
 *   < 7d    → "Xd atrás" (ou "ontem" pra 1d)
 *   < 30d   → "Xsem atrás"
 *   else    → "Xmês atrás" / "Xa atrás"
 *
 * @param tsSec Timestamp em segundos unix
 * @param nowSec Reference now em segundos unix
 */
export function formatRelativePtBr(tsSec: number, nowSec: number): string {
  const diff = Math.max(0, nowSec - tsSec)
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`
  const days = Math.floor(diff / 86400)
  if (days === 1) return 'ontem'
  if (days < 7) return `${days}d atrás`
  if (days < 30) return `${Math.floor(days / 7)}sem atrás`
  if (days < 365) return `${Math.floor(days / 30)}mês atrás`
  return `${Math.floor(days / 365)}a atrás`
}

/**
 * Pure helper — calcula range + posições normalizadas [0,1] dos ticks.
 * Exportado pra teste isolado (LOCK_VIA_TEST).
 */
export function computeTimelineRange(events: Array<{ created_at: number }>): {
  min: number
  max: number
  ticks: number[] // posições normalizadas [0,1]
  count: number
} | null {
  const valid = events
    .map((e) => e.created_at)
    .filter((t) => Number.isFinite(t) && t > 0)
  if (valid.length === 0) return null
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const span = max - min
  // Caso degenerado: todos os eventos no mesmo instante. Um único
  // tick centralizado.
  if (span === 0) {
    return { min, max, ticks: [0.5], count: valid.length }
  }
  const ticks = valid.map((t) => (t - min) / span)
  return { min, max, ticks, count: valid.length }
}

export function TimelineScrubber({
  events,
  now,
  currentTime,
  paused: pausedProp,
  onTogglePaused,
  mode,
  className = '',
}: TimelineScrubberProps) {
  const nowSec = now ?? Math.floor(Date.now() / 1000)
  const range = computeTimelineRange(events)

  // Modo CONTROLLED (Ted+Lily 2026-05-29): quando o caller passa
  // `currentTime` (cursor normalizado do relógio único), a barra é dirigida
  // por fora — fill/caret = currentTime, paused vem do clock. Sem clock
  // (PostModeMap legacy), mantém autoplay CSS + `paused` interno.
  const controlled = currentTime !== undefined
  // V_2026-05-23: autoplay ON default no fallback. Toggle ▶/⏸ visível pra
  // user pausar (preserva spirit §22/§24 — user no controle).
  const [internalPaused, setInternalPaused] = useState(false)
  const paused = controlled ? pausedProp ?? false : internalPaused
  const togglePaused = controlled
    ? onTogglePaused ?? (() => undefined)
    : () => setInternalPaused((p) => !p)

  // Ted polish 2026-05-22 #8b: empty state. Scrubber só informa lapso
  // temporal — com 0 ou 1 evento, não há lapso. Oculta em vez de
  // mostrar range degenerado ("—" vazio). Caller (MapShell) já filtra
  // events.length > 0; este guard pega o caso N=1 e events só com
  // timestamps inválidos.
  if (!range || range.count < 2) {
    return null
  }

  const { min, max, ticks, count } = range
  const startLabel = formatRelativePtBr(min, nowSec)
  const endLabel = max === min ? 'mesmo instante' : formatRelativePtBr(max, nowSec)
  const counterLabel = counterLabelForMode(count, mode)

  // Posição normalizada do cursor (0..1). Modo CONTROLLED (Ted+Lily
  // 2026-05-29): `currentTime` JÁ é a fração [0,1] do relógio único —
  // fill + caret derivam direto dela, então a barra acompanha exatamente
  // o draw-on dos arcos. Sem clock → null (fill/caret CSS autoplay).
  const cursor =
    currentTime !== undefined
      ? Math.min(1, Math.max(0, currentTime))
      : null

  const pausedAttr = paused ? 'true' : 'false'

  return (
    <div
      className={`pointer-events-none rounded-lg border border-drift-border/40 bg-drift-bg/95 px-3 py-2 backdrop-blur-sm ${className}`}
      role="group"
      aria-label={`linha do tempo dos eventos no mapa, ${counterLabel} entre ${startLabel} e ${endLabel}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-meta text-drift-muted">
        <span>{startLabel}</span>
        <span aria-hidden="true" className="flex-1 text-center text-drift-muted/60">
          {counterLabel}
        </span>
        <span>{endLabel}</span>
        {/* Toggle ▶/⏸ — pointer-events-auto pra clicável dentro de
            container pointer-events-none. PT-BR labels (vocabulário UI). */}
        <button
          type="button"
          onClick={togglePaused}
          aria-label={paused ? 'tocar animação da linha do tempo' : 'pausar animação da linha do tempo'}
          aria-pressed={!paused}
          className="pointer-events-auto -my-0.5 ml-1 rounded px-1 text-[11px] text-drift-muted/80 transition-colors hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
        >
          {paused ? '▶' : '⏸'}
          <span className="sr-only">{paused ? ' tocar' : ' pausar'}</span>
        </button>
      </div>
      {/* Trilha. Order: fill (atrás) → ticks → caret. aria-hidden — info
          semântica no group acima. */}
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-drift-surface"
        aria-hidden="true"
      >
        {/* Fill bar esquerda→direita.
            CONTROLLED (cursor != null): width = cursor×100%, dirigido pelo
            relógio único — anda em lockstep com os arcos. Sem CSS keyframe.
            UNCONTROLLED (PostModeMap legacy): scaleX(0→1) via CSS, pausa
            por data-paused. */}
        {cursor !== null ? (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-drift-accent2/35"
            style={{ width: `${cursor * 100}%` }}
          />
        ) : (
          <span
            className="drift-scrubber-fill absolute inset-0 rounded-full bg-drift-accent2/35"
            data-paused={pausedAttr}
          />
        )}
        {/* Tick marks pra cada evento. Render acima do fill. */}
        {ticks.map((p, i) => {
          const style: CSSProperties = {
            left: `${p * 100}%`,
            transform: 'translateX(-50%)',
          }
          return (
            <span
              key={i}
              className="absolute top-1/2 z-10 -translate-y-1/2 h-2 w-[2px] rounded-full bg-drift-accent2/70"
              style={style}
            />
          )
        })}
        {/* Caret CONTROLLED: na borda do fill (cursor×100%), dirigido pelo
            relógio único — mesma fonte dos arcos. */}
        {cursor !== null && (
          <span
            className="absolute -top-1 z-20 h-4 w-[3px] rounded-full bg-drift-accent shadow-[0_0_6px_rgba(232,255,90,0.55)]"
            style={{
              left: `${cursor * 100}%`,
              transform: 'translateX(-50%)',
            }}
          />
        )}
        {/* Caret animado UNCONTROLLED — segue a borda do fill via CSS
            keyframe. Só no fallback (sem clock). */}
        {cursor === null && (
          <span
            className="drift-scrubber-caret absolute -top-1 z-20 h-4 w-[3px] rounded-full bg-drift-accent shadow-[0_0_6px_rgba(232,255,90,0.55)]"
            data-paused={pausedAttr}
            style={{ transform: 'translateX(-50%)' }}
          />
        )}
      </div>
    </div>
  )
}
