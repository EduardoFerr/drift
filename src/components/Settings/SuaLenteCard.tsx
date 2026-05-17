/**
 * SuaLenteCard — controle user-facing da Trust Lens (Phase 1).
 *
 * Slider 0-100% com snap stops em 0/50/100. Labels descritivos (ação,
 * não adjetivo abstrato) + helper text dinâmico + CTA "ver feed agora"
 * pra teste imediato. Lily UX polish 2026-05-17.
 *
 * Manifesto §24 (carve-out view-layer): valor do slider afeta APENAS
 * `s_local` computado no view-boundary do feed. NUNCA persisted em
 * `posts.score`. NUNCA shared via event.
 *
 * Persistência: `lens_strength` (REAL 0..1) em `user_prefs`. Default 0
 * (lens off — feed canônico bit-exact). Idempotente: setLensStrength
 * normaliza para [0, 1].
 *
 * Plano: `Docs/plans/trust-lens-phase1-plan.md` §1.5.
 */

import { useEffect, useState } from 'react'
import { setLensStrength, useLensStore } from '../../lib/trust-lens'
import { db } from '../../lib/db'
import { FullPageCard } from '../UI/FullPageCard'
import { SectionHeader } from '../UI/SectionHeader'
import { DriftButton } from '../UI/DriftButton'
import { EyeIcon } from '../UI/Icons'

interface CardProps {
  onClose: () => void
}

const SNAP_STOPS = [0, 0.5, 1] as const
const SNAP_THRESHOLD = 0.06 // ±6% snap window em torno dos stops

/**
 * Label DESCRITIVO da ação (Lily polish 2026-05-17): substitui adjetivos
 * abstratos ("Nenhuma/Suave/Moderada") por descrições do efeito real.
 * User entende o que vai mudar no feed antes de mover o slider.
 */
function labelFor(strength: number): string {
  if (strength < 0.05) return 'sem reordenação'
  if (strength < 0.34) return 'levemente prioriza quem você segue'
  if (strength < 0.67) return 'prioriza quem você segue'
  if (strength < 0.95) return 'prioriza forte quem você segue'
  return 'prioriza apenas sua rede próxima'
}

/** Helper text com exemplo concreto do efeito. */
function helperText(strength: number): string {
  if (strength === 0) {
    return 'Feed em ordem canônica — drifts, sinks e idade. Todos os clientes Drift veem a mesma ordem.'
  }
  if (strength < 0.34) {
    return 'Posts de quem você acompanha (e do entorno deles) sobem um pouco. Resto do feed quase inalterado.'
  }
  if (strength < 0.67) {
    return 'Posts da sua rede social local (follows + mutual drifts) ganham peso significativo. Vozes fora da rede continuam aparecendo.'
  }
  if (strength < 0.95) {
    return 'Feed fortemente reordenado em torno dos follows. Posts fora da sua rede ficam raros.'
  }
  return 'Feed quase só com quem você acompanha + entorno próximo. Descoberta de novas vozes cai drasticamente.'
}

export function SuaLenteCard({ onClose }: CardProps) {
  const strength = useLensStore((s) => s.strength)
  const [local, setLocal] = useState<number>(strength)

  // Sincroniza com store se mudar de fora (ex: boot load).
  useEffect(() => {
    setLocal(strength)
  }, [strength])

  function commitStrength(raw: number) {
    let next = Math.max(0, Math.min(1, raw))
    // Snap to stops dentro da janela.
    for (const stop of SNAP_STOPS) {
      if (Math.abs(next - stop) <= SNAP_THRESHOLD) {
        next = stop
        break
      }
    }
    setLocal(next)
    setLensStrength(next)
    // Persiste em user_prefs (chave dedicada — sai do schema de UserPrefs
    // pra evitar churn de migração até Phase 2). REAL 0..1.
    void db.run(
      `INSERT INTO user_prefs (key, value) VALUES ('lens_strength', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(next)],
    )
  }

  function onSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const pct = Number(e.target.value)
    commitStrength(pct / 100)
  }

  const pct = Math.round(local * 100)
  const isActive = local > 0

  return (
    <FullPageCard
      onClose={onClose}
      title="sua lente"
      ariaLabel="sua lente — reordenamento local do feed"
    >
      <div className="space-y-5 px-4 py-5">
        <SectionHeader title="intensidade" />

        <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/70">
          A Lente reordena seu feed localmente, no momento da visualização.
          Não muda o feed dos outros, não é compartilhada e não afeta o
          score canônico dos posts.
        </p>

        <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/40 px-5 py-5">
          {/* Label primário descritivo (Lily) — fala o que muda, não
              adjetivo abstrato. Quebra em 2 linhas em mobile pra labels
              mais longos sem squash visual. */}
          <div className="flex items-start justify-between gap-3">
            <span className="font-display text-[14px] font-bold uppercase leading-snug tracking-tag text-drift-text">
              {labelFor(local)}
            </span>
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-drift-muted/70">
              {pct}%
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            onChange={onSliderChange}
            aria-label="intensidade da lente"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={labelFor(local)}
            className="mt-4 h-11 w-full cursor-pointer appearance-none bg-transparent accent-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          />

          <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-meta text-drift-muted/50">
            <button
              type="button"
              onClick={() => commitStrength(0)}
              className="hover:text-drift-accent2"
              title="desliga a lente — feed canônico"
            >
              desligado
            </button>
            <button
              type="button"
              onClick={() => commitStrength(0.5)}
              className="hover:text-drift-accent2"
              title="meio-termo — sua rede tem peso, mas fora dela ainda aparece"
            >
              meio
            </button>
            <button
              type="button"
              onClick={() => commitStrength(1)}
              className="hover:text-drift-accent2"
              title="máximo — quase só sua rede"
            >
              máximo
            </button>
          </div>

          <p className="mt-4 font-mono text-[11px] leading-relaxed text-drift-muted/70">
            {helperText(local)}
          </p>
        </div>

        {/* CTA "ver feed agora" — fecha o card pra user testar o efeito
            imediato no PostViewer. Lily approach a 2026-05-17:
            "experimente AGORA" reduz distância entre slider e resultado.
            Só aparece quando lens ativa (strength > 0) — sem isso, CTA
            seria no-op. */}
        {isActive && (
          <div className="flex justify-end">
            <DriftButton
              variant="primary"
              size="md"
              onClick={onClose}
              className="inline-flex items-center gap-2"
            >
              <EyeIcon size={14} />
              ver feed agora
            </DriftButton>
          </div>
        )}

        <SectionHeader title="como funciona" />
        <div className="space-y-3 px-1 font-mono text-[11px] leading-relaxed text-drift-muted/70">
          <p>
            <span className="text-drift-accent2">Grafo:</span> usa quem
            você acompanha (NIP-02) + posts que você deu drift.
          </p>
          <p>
            <span className="text-drift-accent2">Cálculo:</span> influência
            local de cada autor sobre o seu feed (Personalized PageRank).
          </p>
          <p>
            <span className="text-drift-accent2">Local:</span> tudo no
            seu dispositivo. Não vaza, não é compartilhada, não fica em
            cache na nuvem.
          </p>
          <p className="pt-1 text-drift-muted/40">
            Manifesto §24 — visualização local, não ranking canônico.
            Você pode desligar a qualquer momento e o feed volta ao normal.
          </p>
        </div>
      </div>
    </FullPageCard>
  )
}
