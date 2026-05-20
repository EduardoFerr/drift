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
      {/* Lily audit 2026-05-18 fixes coordenados:
          P0: track slider com fill linear-gradient (não default browser-cinza)
          P1: label dinâmico demoted de heading uppercase pra dado sentence-case
              text-[18px] semibold (resposta, não seção)
          P2: tick dots no track + remoção de "desligado/meio/máximo" textuais
          P3: "como funciona" colapsado por default (accordion via SectionHeader)
          P4: inner card aninhado removido (espaço respira) */}
      <div className="space-y-5 px-4 py-5">
        <p className="font-mono text-[12px] leading-relaxed text-drift-body">
          A Lente reordena seu feed <strong>localmente</strong>, no
          momento da visualização. Não muda o feed dos outros, não é
          compartilhada e não afeta o score canônico dos posts.
        </p>

        {/* Slider region — sem inner card aninhado. divider-y como
            agrupamento visual leve. */}
        <div className="space-y-3 border-y border-drift-border/30 py-5">
          {/* P1: dado é a estrela. Sentence-case display 18px semibold,
              não uppercase heading. Olho vai direto pra resposta. */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-display text-[18px] font-semibold leading-snug text-drift-text">
              {labelFor(local)}
            </span>
            <span className="shrink-0 font-mono text-[13px] tabular-nums text-drift-muted">
              {pct}%
            </span>
          </div>

          {/* P0: slider com track preenchido. CSS custom via inline style
              + appearance-none. linear-gradient narra visualmente o valor
              independente do número (Apple Settings pattern). */}
          <div className="relative">
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
              className="lens-slider h-11 w-full cursor-pointer appearance-none rounded-full bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
              style={{
                // Custom track via background-image gradient. Vendor-
                // prefixed thumb stays via accent-color CSS prop.
                background: `linear-gradient(to right, var(--drift-accent2) 0%, var(--drift-accent2) ${pct}%, var(--drift-surface) ${pct}%, var(--drift-surface) 100%)`,
                accentColor: 'var(--drift-accent2)',
              }}
            />
          </div>

          {/* P2: dots clicáveis alinhados aos snap stops (0/50/100), sem
              labels textuais. Tooltip carrega o nome. */}
          <div className="relative -mt-2 flex justify-between px-1">
            {SNAP_STOPS.map((stop) => {
              const stopPct = stop * 100
              const isAtStop = Math.abs(local - stop) < SNAP_THRESHOLD
              return (
                <button
                  key={stop}
                  type="button"
                  onClick={() => commitStrength(stop)}
                  className={`flex h-3 w-3 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                    isAtStop
                      ? 'bg-drift-accent2'
                      : 'bg-drift-border hover:bg-drift-accent2/60'
                  }`}
                  title={
                    stop === 0
                      ? 'desligado — feed canônico'
                      : stop === 0.5
                      ? 'meio — sua rede pesa, fora dela ainda aparece'
                      : 'máximo — quase só sua rede'
                  }
                  aria-label={`ajustar pra ${stopPct}%`}
                />
              )
            })}
          </div>

          <p className="font-mono text-[11px] leading-relaxed text-drift-body/85">
            {helperText(local)}
          </p>
        </div>

        {/* CTA "ver feed agora" — só aparece quando lens ativa */}
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

        {/* P3: "como funciona" colapsado por default. User que quer
            entender PageRank/NIP-02 expande. Wall-of-text não compete
            mais com slider. */}
        <ComoFuncionaCollapse />
      </div>
    </FullPageCard>
  )
}

/**
 * Sub-card colapsável "como funciona" — info densa (PageRank, NIP-02,
 * manifesto §24) escondida atrás de disclosure. User power que quer
 * entender expande; novice ignora.
 */
function ComoFuncionaCollapse() {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-drift-border/30 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 py-1 font-mono text-[11px] uppercase tracking-meta text-drift-muted hover:text-drift-accent2 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2/40"
      >
        <span>como funciona</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 font-mono text-[11px] leading-relaxed text-drift-body/85">
          <p>
            <span className="text-drift-accent2">Grafo:</span> usa quem
            você acompanha + posts que você deu drift.
          </p>
          <p>
            <span className="text-drift-accent2">Cálculo:</span>{' '}
            influência local de cada autor sobre o seu feed (algoritmo
            Personalized PageRank).
          </p>
          <p>
            <span className="text-drift-accent2">Local:</span> tudo no
            seu dispositivo. Não vaza, não é compartilhada, não fica em
            cache na nuvem.
          </p>
          <p className="pt-1 text-drift-muted">
            Manifesto §24 — visualização local, não ranking canônico.
            Você pode desligar a qualquer momento e o feed volta ao normal.
          </p>
        </div>
      )}
    </div>
  )
}
