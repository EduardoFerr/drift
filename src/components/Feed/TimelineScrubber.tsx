/**
 * TimelineScrubber — barra horizontal de lapso temporal pros mapas
 * animados.
 *
 * V_2026-05-22 (user pedido): "Os mapas que possuem animação,
 * precisa de uma barra de lapso temporal, para termos noção do
 * tempo decorrido entre os eventos ali registrados e exibidos."
 *
 * Modo passive (atual): mostra range [min, max] em labels relative
 * PT-BR + tick marks pra cada evento, posicionados proporcionalmente
 * dentro do range. Não interage com o estado de animação do mapa
 * (escopo passive — display visual do range + atual).
 *
 * Modo interactive (futuro): drag handle muda current time → filtra
 * eventos. Por ora deixamos `current` opcional + indicador visual
 * preparado, sem handle drag.
 *
 * WCAG 2.3.3 — `prefers-reduced-motion` desativa qualquer transition;
 * fica estático mostrando só labels start/end.
 *
 * Pure rendering — recebe events array, deriva range internamente.
 * Sem fetch, sem effect; ideal pra placement em MapShell.
 */

import type { CSSProperties } from 'react'

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
   * Tempo atualmente em foco na animação (segundos). Quando definido,
   * mostra um indicador (caret) na posição correspondente do range.
   * Omitido → só range + ticks.
   */
  currentTime?: number
  /**
   * Ted polish 2026-05-22: semântica do label varia por mode. Caller
   * (MapShell) passa o mode pra customizar o counter:
   *   - 'post'    → "N spreads do post"
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
    return `${count} ${count === 1 ? 'spread do post' : 'spreads do post'}`
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
  mode,
  className = '',
}: TimelineScrubberProps) {
  const nowSec = now ?? Math.floor(Date.now() / 1000)
  const range = computeTimelineRange(events)

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
  const span = max - min
  const counterLabel = counterLabelForMode(count, mode)

  // Posição do caret de "current time" (0..1). Clamped pra range.
  const caretPos =
    currentTime !== undefined && span > 0
      ? Math.min(1, Math.max(0, (currentTime - min) / span))
      : null

  return (
    <div
      className={`pointer-events-none rounded-lg border border-drift-border/40 bg-drift-bg/95 px-3 py-2 backdrop-blur-sm ${className}`}
      role="group"
      aria-label={`linha do tempo dos eventos no mapa, ${counterLabel} entre ${startLabel} e ${endLabel}`}
    >
      <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-meta text-drift-muted">
        <span>{startLabel}</span>
        <span aria-hidden="true" className="text-drift-muted/60">
          {counterLabel}
        </span>
        <span>{endLabel}</span>
      </div>
      {/* Trilha + ticks. role="presentation" — info semântica já no aria-label
          do group acima. */}
      <div
        className="relative h-2 w-full rounded-full bg-drift-surface"
        aria-hidden="true"
      >
        {/* Tick marks pra cada evento. Cada tick é um pixel-fino dot.
            Posição via left:%. */}
        {ticks.map((p, i) => {
          const style: CSSProperties = {
            left: `${p * 100}%`,
            transform: 'translateX(-50%)',
          }
          return (
            <span
              key={i}
              className="absolute top-1/2 -translate-y-1/2 h-2 w-[2px] rounded-full bg-drift-accent2/70"
              style={style}
            />
          )
        })}
        {/* Caret de current time, quando passado. Triangle/diamond
            apontando pra trilha. */}
        {caretPos !== null && (
          <span
            className="absolute -top-1 h-4 w-[3px] rounded-full bg-drift-accent shadow-[0_0_6px_rgba(232,255,90,0.55)]"
            style={{
              left: `${caretPos * 100}%`,
              transform: 'translateX(-50%)',
            }}
          />
        )}
      </div>
    </div>
  )
}
