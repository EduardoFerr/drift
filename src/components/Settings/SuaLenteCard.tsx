/**
 * SuaLenteCard — controle da lente (Docs/algoritmos.md §6; manifesto §24).
 *
 * A lente põe posts de quem você segue entre os primeiros das abas Global e
 * Em alta: com força k%, k de cada 100 cards vão para eles, na ordem de
 * sempre. Seguindo e Contágio não mudam. Os textos aqui dizem exatamente o
 * que a regra faz — nada de "entorno", "drifts mútuos" ou PageRank: na
 * produção o app só guarda a sua lista de quem você segue.
 *
 * Slider 0–100% com paradas em 0/50/100. Persistência: `lens_strength`
 * (REAL 0..1) e `active_lens` em `user_prefs`, só neste aparelho. Padrão:
 * desligada — a ordem de todo mundo.
 */

import { useEffect, useState } from 'react'
import { setLensStrength, useLensStore } from '../../lib/trust-lens'
import { db } from '../../lib/db'
import { usePrefsStore, setPref } from '../../lib/prefs'
import { listLenses, useLensRegistryStore } from '../../lib/lens/registry'
import { chooseLens } from '../../lib/lens/init'
import { FullPageCard } from '../UI/FullPageCard'
import { DriftButton } from '../UI/DriftButton'
import { Collapse } from '../UI/Collapse'
import { EyeIcon } from '../UI/Icons'

interface CardProps {
  onClose: () => void
}

const SNAP_STOPS = [0, 0.5, 1] as const
const SNAP_THRESHOLD = 0.06 // ±6% de janela em torno das paradas

/** Força do slider (0..1) em pontos inteiros (0..100). */
const pctOf = (strength: number) => Math.max(0, Math.min(100, Math.round(strength * 100)))

/**
 * O efeito, em palavras: quantos cards vão para quem você segue. Frações
 * simples quando batem (1 em cada 2, 3 em cada 4); senão, "k de cada 100".
 */
export function lensLabel(k: number): string {
  if (k <= 0) return 'desligada — a ordem de todo mundo'
  if (k >= 100) return 'primeiro, todos de quem você segue'
  for (const d of [2, 3, 4, 5, 10]) {
    const n = Math.round((k * d) / 100)
    if (n >= 1 && Math.abs(n / d - k / 100) < 0.005) {
      return `${n} em cada ${d} cards ${n === 1 ? 'é' : 'são'} de quem você segue`
    }
  }
  return `${k} de cada 100 cards são de quem você segue`
}

/** O que muda, com a regra inteira (Docs/algoritmos.md §6). */
export function lensHelper(k: number): string {
  if (k <= 0) {
    return 'A ordem de sempre: pontos de quem deu DRIFT, SINK e comentou (pelo peso de cada um), divididos pela idade do post. É a mesma para todo mundo que tem os mesmos posts.'
  }
  if (k >= 100) {
    return 'Nas abas global e em alta, primeiro vêm os posts de quem você segue (na ordem de sempre; de cada pessoa, no máximo 2, de até 7 dias), depois o resto. Post que a comunidade afundou não sobe.'
  }
  return `Nas abas global e em alta, ${k} de cada 100 cards vão para posts de quem você segue, na ordem de sempre, enquanto houver posts deles; os outros, para o resto. De cada pessoa, no máximo 2 posts (os de mais pontos, de até 7 dias). Um post que a lente adianta nunca fica abaixo do lugar que já tinha.`
}

export function SuaLenteCard({ onClose }: CardProps) {
  const strength = useLensStore((s) => s.strength)
  const [local, setLocal] = useState<number>(strength)
  // Lente ativa (quem você segue primeiro | cronológica) — reativa.
  const activeId = useLensRegistryStore((s) => s.activeId)
  // `version`: re-render quando lentes chegam ao registry (UI montada antes do boot).
  useLensRegistryStore((s) => s.version)
  const lenses = listLenses()
  const showStrengthControls = activeId === 'ppr-trust'

  // Sincroniza com o store se mudar de fora (ex.: boot).
  useEffect(() => {
    setLocal(strength)
  }, [strength])

  function commitStrength(raw: number) {
    let next = Math.max(0, Math.min(1, raw))
    for (const stop of SNAP_STOPS) {
      if (Math.abs(next - stop) <= SNAP_THRESHOLD) {
        next = stop
        break
      }
    }
    setLocal(next)
    setLensStrength(next)
    // Só neste aparelho (user_prefs), nunca publicado. REAL 0..1.
    void db.run(
      `INSERT INTO user_prefs (key, value) VALUES ('lens_strength', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(next)],
    )
  }

  function onSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    commitStrength(Number(e.target.value) / 100)
  }

  const pct = pctOf(local)
  const isActive = pct > 0

  return (
    <FullPageCard
      onClose={onClose}
      title="sua lente"
      ariaLabel="sua lente — posts de quem você segue entre os primeiros"
    >
      <div className="space-y-5 px-4 py-5">
        <p className="font-mono text-[12px] leading-relaxed text-drift-body">
          A lente põe posts de <strong>quem você segue</strong> entre os
          primeiros das abas <strong>global</strong> e <strong>em alta</strong>.
          Ela roda no seu aparelho: não muda a ordem de ninguém além da
          sua, não é publicada e não mexe no score dos posts. As abas
          seguindo e contágio não mudam.
        </p>

        <label className="block space-y-2">
          <span className="block font-mono text-[11px] uppercase tracking-meta text-drift-muted">
            lente
          </span>
          <select
            value={activeId}
            onChange={(e) => void chooseLens(e.target.value)}
            aria-label="qual lente"
            className="w-full cursor-pointer rounded border border-drift-border/40 bg-drift-surface px-3 py-2 font-mono text-[12px] text-drift-text focus:border-drift-accent2 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          >
            {lenses.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="block font-mono text-[10px] leading-relaxed text-drift-muted">
            {lenses.find((l) => l.id === activeId)?.description ?? ''}
          </span>
        </label>

        {/* Força: só na lente "quem você segue primeiro" (a cronológica não tem). */}
        {showStrengthControls && (
          <div className="space-y-3 border-y border-drift-border/30 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-[18px] font-semibold leading-snug text-drift-text" data-testid="lens-label">
                {lensLabel(pct)}
              </span>
              <span className="shrink-0 font-mono text-[13px] tabular-nums text-drift-muted">
                {pct}%
              </span>
            </div>

            <div className="relative">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={pct}
                onChange={onSliderChange}
                aria-label="força da lente"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-valuetext={lensLabel(pct)}
                className="lens-slider h-11 w-full cursor-pointer appearance-none rounded-full bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
                style={{
                  background: `linear-gradient(to right, var(--drift-accent2) 0%, var(--drift-accent2) ${pct}%, var(--drift-surface) ${pct}%, var(--drift-surface) 100%)`,
                  accentColor: 'var(--drift-accent2)',
                }}
              />
            </div>

            <div className="relative -mt-2 flex justify-between px-1">
              {SNAP_STOPS.map((stop) => {
                const isAtStop = Math.abs(local - stop) < SNAP_THRESHOLD
                return (
                  <button
                    key={stop}
                    type="button"
                    onClick={() => commitStrength(stop)}
                    className={`flex h-3 w-3 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40 ${
                      isAtStop ? 'bg-drift-accent2' : 'bg-drift-border hover:bg-drift-accent2/60'
                    }`}
                    title={
                      stop === 0
                        ? 'desligada — a ordem de todo mundo'
                        : stop === 0.5
                        ? 'metade — um card sim, um não'
                        : 'máximo — primeiro quem você segue'
                    }
                    aria-label={`ajustar pra ${stop * 100}%`}
                  />
                )
              })}
            </div>

            <p className="font-mono text-[11px] leading-relaxed text-drift-body/85" data-testid="lens-helper">
              {lensHelper(pct)}
            </p>
          </div>
        )}

        {/* Sub-toggles sempre no DOM (zero CLS); desabilitados com a lente
            desligada. LOCK_VIA_TEST: tests/sua-lente-cls-conformance.test.ts. */}
        {showStrengthControls && (
          <div className="space-y-0">
            <ReorderIndicatorToggle disabled={!isActive} />
            <MapColorsToggle disabled={!isActive} />
          </div>
        )}

        {isActive && showStrengthControls && (
          <div className="flex justify-end">
            <DriftButton variant="primary" size="md" onClick={onClose} className="inline-flex items-center gap-2">
              <EyeIcon size={14} />
              ver feed agora
            </DriftButton>
          </div>
        )}

        <ComoFuncionaCollapse />
      </div>
    </FullPageCard>
  )
}

/** "destacar o que a lente adiantou" — opt-in, padrão desligado. */
function ReorderIndicatorToggle({ disabled }: { disabled: boolean }) {
  const enabled = usePrefsStore((s) => s.lens_show_reorder_indicator)
  return (
    <ToggleRow
      disabled={disabled}
      title="destacar o que a lente adiantou"
      description={'o chip "lente" fica preenchido e ganha ↑ nos posts que subiram por causa da lente.'}
      checked={enabled}
      ariaLabel="destacar os posts que a lente adiantou"
      onChange={(checked) => {
        void setPref('lens_show_reorder_indicator', checked)
      }}
    />
  )
}

/**
 * "mostrar quem você segue no mapa" — opt-in (Satoshi: cor por proximidade
 * revela a sua rede a quem olha a tela). Os pontos de quem você segue ganham
 * cor pela proximidade calculada no aparelho; o resto fica na cor padrão.
 */
function MapColorsToggle({ disabled }: { disabled: boolean }) {
  const enabled = usePrefsStore((s) => s.lens_show_in_map)
  return (
    <ToggleRow
      disabled={disabled}
      title="mostrar quem você segue no mapa"
      description="no mapa da sua rede, os pontos de quem você segue ganham cor. só você vê."
      checked={enabled}
      ariaLabel="colorir no mapa os pontos de quem você segue"
      onChange={(checked) => {
        void setPref('lens_show_in_map', checked)
      }}
    />
  )
}

/** Linha de sub-toggle: dimmed + disabled com a lente desligada (altura constante). */
function ToggleRow({
  disabled,
  title,
  description,
  checked,
  ariaLabel,
  onChange,
}: {
  disabled: boolean
  title: string
  description: string
  checked: boolean
  ariaLabel: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 border-t border-drift-border/30 pt-3 transition-opacity duration-200 motion-reduce:transition-none ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer opacity-100'
      }`}
    >
      <div className="space-y-0.5">
        <span className="block font-mono text-[12px] text-drift-text">{title}</span>
        <span className="block font-mono text-[10px] leading-relaxed text-drift-muted">
          {disabled ? 'ligue a lente pra usar — ajuste a força acima.' : description}
        </span>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="mt-1 h-4 w-4 cursor-pointer accent-drift-accent2 disabled:cursor-not-allowed"
      />
    </label>
  )
}

/** "como funciona" — a regra inteira, colapsada por padrão. */
function ComoFuncionaCollapse() {
  const defaultOpen = usePrefsStore((s) => s.menu_detail_show_how_it_works)
  const showAlgorithm = usePrefsStore((s) => s.menu_detail_show_algorithm)
  const showManifesto = usePrefsStore((s) => s.menu_detail_show_manifesto)
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    setOpen(defaultOpen)
  }, [defaultOpen])
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
      <Collapse open={open}>
        <div className="space-y-2 pt-3 font-mono text-[11px] leading-relaxed text-drift-body/85">
          <p>
            <span className="text-drift-accent2">Quem conta:</span> quem você
            segue — menos quem você bloqueou, silenciou ou denunciou. Uma
            denúncia basta, e vale também para quem trouxe, na aba contágio,
            um post que você denunciou. Amigos de amigos não contam: o app só
            guarda a sua lista.
          </p>
          <p>
            <span className="text-drift-accent2">Onde:</span> só nas abas
            global e em alta. Seguindo e contágio continuam na ordem de sempre.
          </p>
          <p>
            <span className="text-drift-accent2">Quais posts:</span> de cada
            pessoa, no máximo 2 (os de mais pontos), de até 7 dias e que a
            comunidade não afundou.
          </p>
          <p>
            <span className="text-drift-accent2">Nunca:</span> põe um post que
            ela adianta abaixo do lugar que ele já tinha, nem traz post de quem
            você não segue.
          </p>
          {showAlgorithm && (
            <p>
              <span className="text-drift-accent2">Regra:</span> com força k%,
              entre os primeiros N cards, pelo menos N × k ÷ 100 (arredondado
              para baixo) são posts que a lente adianta, enquanto houver;
              dentro de cada grupo, a ordem de sempre.
            </p>
          )}
          <p>
            <span className="text-drift-accent2">Local:</span> calculada no
            seu aparelho a cada leitura do feed. Nada é gravado nem publicado.
          </p>
          {showManifesto && (
            <p className="pt-1 text-drift-muted">
              Manifesto §24 — algoritmo público, entradas suas. Desligue a
              lente e o feed volta à ordem de todo mundo.
            </p>
          )}
        </div>
      </Collapse>
    </div>
  )
}
