/**
 * SuaLenteCard — controle user-facing da Trust Lens (Phase 1).
 *
 * Slider 0-100% com snap stops em 0/50/100 ("Nenhuma" / "Moderada" /
 * "Forte"). Helper text dinâmico por faixa. Sem score numérico, sem
 * "trust" — vocabulário Drift §27 (Lily UX, plan §1.5).
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

interface CardProps {
  onClose: () => void
}

const SNAP_STOPS = [0, 0.5, 1] as const
const SNAP_THRESHOLD = 0.06 // ±6% snap window em torno dos stops

function helperText(strength: number): string {
  if (strength === 0) {
    return 'Lente desligada. O feed segue ordem canônica — drifts, sinks, idade.'
  }
  if (strength < 0.34) {
    return 'Influência sutil. Pessoas que você acompanha e o entorno delas sobem um pouco.'
  }
  if (strength < 0.67) {
    return 'Influência moderada. O feed prioriza autores próximos da sua rede social.'
  }
  return 'Influência forte. O feed reordena agressivamente em torno da sua rede social local.'
}

function labelFor(strength: number): string {
  if (strength < 0.05) return 'Nenhuma'
  if (strength < 0.34) return 'Suave'
  if (strength < 0.67) return 'Moderada'
  if (strength < 0.95) return 'Acentuada'
  return 'Forte'
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

  return (
    <FullPageCard
      onClose={onClose}
      title="sua lente"
      ariaLabel="sua lente — reordenamento local do feed"
    >
      <div className="space-y-5 px-4 py-5">
        <SectionHeader title="intensidade" />

        <p className="px-1 font-mono text-[11px] leading-relaxed text-drift-muted/60">
          A Lente reordena seu feed localmente, no momento da visualização.
          Não muda o feed dos outros, não é compartilhada e não afeta o
          score canônico dos posts.
        </p>

        <div className="rounded-2xl border border-drift-border/40 bg-drift-surface/40 px-5 py-5">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[14px] font-bold uppercase tracking-tag text-drift-text">
              {labelFor(local)}
            </span>
            <span className="font-mono text-[12px] text-drift-muted/70">
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

          <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-meta text-drift-muted/40">
            <button
              type="button"
              onClick={() => commitStrength(0)}
              className="hover:text-drift-accent2"
            >
              nenhuma
            </button>
            <button
              type="button"
              onClick={() => commitStrength(0.5)}
              className="hover:text-drift-accent2"
            >
              moderada
            </button>
            <button
              type="button"
              onClick={() => commitStrength(1)}
              className="hover:text-drift-accent2"
            >
              forte
            </button>
          </div>

          <p className="mt-4 font-mono text-[11px] leading-relaxed text-drift-muted/70">
            {helperText(local)}
          </p>
        </div>

        <SectionHeader title="como funciona" />
        <div className="space-y-2 px-1 font-mono text-[11px] leading-relaxed text-drift-muted/50">
          <p>
            A Lente usa o grafo de pessoas que você acompanha e os drifts
            mútuos pra calcular uma influência local — quem está mais
            próximo da sua rede aparece com peso maior.
          </p>
          <p>
            Tudo é computado no seu dispositivo, com base em eventos
            públicos do Nostr. Nada sai daqui.
          </p>
          <p className="text-drift-muted/30">
            Manifesto §24 — visualização local, não ranking canônico.
          </p>
        </div>
      </div>
    </FullPageCard>
  )
}

