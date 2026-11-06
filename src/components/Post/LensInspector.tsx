/**
 * LensInspector — chip "lente" + folha que explica por que o post subiu.
 *
 * O chip aparece só quando a lente adiantou ESTE post nas abas Global ou
 * Em alta (`Post.lensLift`, calculado na leitura do feed). A folha diz o
 * motivo real, com os números da regra pública (Docs/algoritmos.md §6):
 * você segue o autor; com a lente em k%, k de cada 100 cards vão para quem
 * você segue; o post estava no lugar X (ou fora da aba) e foi para o Y.
 *
 * Nada aqui consulta o banco nem é gravado (manifesto §24/§28). O nome vem
 * com o começo e o fim da chave, como na folha "chegou por": copiar o nome
 * de alguém é fácil, a chave não.
 *
 * Acessibilidade: chip ≥ 44 px; aria-label descritivo; SlideUpOverlay
 * cuida do foco e do Esc.
 */

import { useState } from 'react'
import { useLensStore } from '../../lib/trust-lens'
import { usePrefsStore } from '../../lib/prefs'
import { SlideUpOverlay } from '../UI/SlideUpOverlay'
import { ModalHeader } from '../UI/ModalHeader'
import { EyeIcon } from '../UI/Icons'
import { PersonNameKey } from './ContagionViaChip'
import type { Post } from '../../types/drift'

interface InspectorProps {
  authorPub: string
  lensLift?: Post['lensLift']
}

/** "1º", "12º" — lugar na aba, contado a partir de 1. */
const ordinal = (i: number) => `${i + 1}º`

export function LensInspector({ authorPub, lensLift }: InspectorProps) {
  const strength = useLensStore((s) => s.strength)
  // Opt-in: chip preenchido + seta, pra quem quer ver cada adiantamento.
  const showReorderIndicator = usePrefsStore((s) => s.lens_show_reorder_indicator)
  const [open, setOpen] = useState(false)

  if (!lensLift || !(strength > 0)) return null
  const k = Math.max(1, Math.min(100, Math.round(strength * 100)))

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className={`absolute bottom-4 right-4 z-30 inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full px-3 backdrop-blur-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/50 ${
          showReorderIndicator
            ? 'border border-drift-accent2 bg-drift-accent2/15 text-drift-accent2 hover:bg-drift-accent2/25'
            : 'border border-drift-accent2/40 bg-drift-surface/85 text-drift-accent2 hover:border-drift-accent2 hover:bg-drift-surface/95'
        }`}
        aria-label="a lente adiantou este post — toque pra ver por quê"
        title="a lente adiantou este post"
        data-no-longpress="true"
        data-testid="lens-chip"
      >
        <EyeIcon size={14} />
        <span className="font-mono text-[10px] uppercase tracking-meta">
          {showReorderIndicator ? 'lente ↑' : 'lente'}
        </span>
      </button>

      {open && (
        <SlideUpOverlay onClose={() => setOpen(false)} ariaLabel="por que a lente adiantou este post">
          <ModalHeader title="sua lente" onClose={() => setOpen(false)} />
          <div className="space-y-3 px-1 pt-1 font-mono text-[12px] leading-relaxed text-drift-text" data-testid="lens-sheet">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-1">
              <span>Você segue</span>
              <span className="flex min-w-0 text-drift-accent2"><PersonNameKey pub={authorPub} /></span>
            </p>
            <p>
              {k === 100
                ? 'Com a sua lente em 100%, os posts de quem você segue vêm primeiro nas abas global e em alta, na ordem de sempre (até 2 de cada pessoa, de até 7 dias).'
                : `Com a sua lente em ${k}%, ${k} de cada 100 cards das abas global e em alta vão para posts de quem você segue, na ordem de sempre.`}
            </p>
            <p>
              {lensLift.from === null
                ? `Este post estava fora dos primeiros da aba e entrou no ${ordinal(lensLift.to)} lugar.`
                : `Sem a lente, este post estaria em ${ordinal(lensLift.from)}; com ela, está em ${ordinal(lensLift.to)}.`}
            </p>
            <p className="text-drift-muted">
              A lente é calculada no seu aparelho e não muda a ordem de ninguém além da sua. Desligada, a aba volta à ordem de todo mundo.
            </p>
          </div>
        </SlideUpOverlay>
      )}
    </>
  )
}
