/**
 * AppearanceCard — seleção de tema visual.
 *
 * 3 paletas com identidade editorial distinta:
 *   - Cinder    (default) — brasa quase apagada sob cinza monástico
 *   - Rosenholz — madeira-de-rosa sob luz de luminária
 *   - Velatura  — camada de tinta translúcida sobre gesso seco (light)
 *
 * Preview live: cada card mostra mini-amostra dos tokens daquele tema
 * (bg, surface, accent, accent2, spread, bury) — user vê a vibe antes
 * de aplicar. Click aplica IMEDIATAMENTE (não persiste preview-on-hover
 * pra não causar surprise).
 *
 * Manifesto §7: tema é decisão LOCAL, não vai pra rede, não afeta
 * score/feed/weight. Outros clientes Drift veem o user idêntico — só a
 * UI local muda.
 */

import { setPref, usePrefsStore } from '../../lib/prefs'
import { applyTheme, THEME_IDS, THEME_META, type ThemeId } from '../../lib/theme'
import { FullPageCard } from '../UI/FullPageCard'
import { SectionHeader } from '../UI/SectionHeader'

interface CardProps {
  onClose: () => void
}

export function AppearanceCard({ onClose }: CardProps) {
  const current = usePrefsStore((s) => s.theme_id)

  function handleSelect(id: ThemeId) {
    if (id === current) return
    // Apply visual IMMEDIATELY (síncrono — setAttribute no <html>).
    // Não dependemos do subscribe do bootstrap pra disparar; chamar
    // direto garante que troca aparece sem latência de Zustand.
    applyTheme(id)
    // Persist async em SQLite + Zustand store. Subscribe em
    // bootstrap.ts ainda existe como redundância pra mudanças
    // vindas de outros lugares (ex: cross-tab sync futuro).
    void setPref('theme_id', id)
  }

  return (
    <FullPageCard onClose={onClose} title="aparência" ariaLabel="aparência — temas">
      <div className="space-y-3 px-4 py-5">
        <SectionHeader title="tema visual" />
        <p className="px-1 font-mono text-[10px] leading-relaxed text-drift-muted/30">
          decisão local — não vai pra rede, não muda como outros usuários veem você.
        </p>

        <div className="space-y-2 pl-3">
          {THEME_IDS.map((id) => {
            const meta = THEME_META[id]
            const isActive = current === id
            return (
              <button
                key={id}
                onClick={() => handleSelect(id)}
                aria-pressed={isActive}
                className={`group relative w-full overflow-hidden rounded-xl border text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                  isActive
                    ? 'border-drift-accent2/60 bg-drift-surface-1'
                    : 'border-drift-border/30 bg-drift-surface/30 hover:border-drift-accent2/30'
                }`}
              >
                {/* Preview strip — 6 swatches do tema com data-theme override no scope */}
                <ThemePreview themeId={id} />

                <div className="px-4 py-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-[14px] font-bold uppercase tracking-tag text-drift-text">
                      {meta.name}
                    </span>
                    {isActive && (
                      <span className="rounded-md bg-drift-accent2/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-meta text-drift-accent2">
                        ativo
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[11px] italic text-drift-muted/60">
                    {meta.tagline}
                  </p>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-meta text-drift-muted/40">
                    {meta.mood}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </FullPageCard>
  )
}

/**
 * ThemePreview — strip horizontal mostrando 6 tokens chave daquele tema
 * (bg, surface, accent, accent2, spread, bury). Usa `data-theme` no
 * wrapper pra resolver as CSS vars no contexto correto SEM aplicar o
 * tema globalmente.
 *
 * Cada swatch tem ~36px de largura. Strip total ~210px — cabe em tela
 * estreita (320px viewport - padding).
 */
function ThemePreview({ themeId }: { themeId: ThemeId }) {
  return (
    <div
      data-theme={themeId}
      className="flex h-12 w-full overflow-hidden"
      aria-hidden="true"
    >
      <Swatch
        bg="var(--drift-bg)"
        label="bg"
        textColor="var(--drift-muted)"
      />
      <Swatch
        bg="var(--drift-surface)"
        label="srf"
        textColor="var(--drift-muted)"
      />
      <Swatch
        bg="var(--drift-accent)"
        label="acc"
        textColor="var(--drift-bg)"
      />
      <Swatch
        bg="var(--drift-accent2)"
        label="ac2"
        textColor="var(--drift-bg)"
      />
      <Swatch
        bg="var(--drift-spread)"
        label="spd"
        textColor="var(--drift-bg)"
      />
      <Swatch
        bg="var(--drift-bury)"
        label="bry"
        textColor="var(--drift-bg)"
      />
    </div>
  )
}

function Swatch({
  bg,
  label,
  textColor,
}: {
  bg: string
  label: string
  textColor: string
}) {
  return (
    <div
      className="grid flex-1 place-items-center font-mono text-[9px] uppercase tracking-meta"
      style={{ background: bg, color: textColor }}
    >
      {label}
    </div>
  )
}

