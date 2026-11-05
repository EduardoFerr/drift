/**
 * Folha "chegou por" (aba Contágio): explica por que o post chegou e
 * oferece o gesto local "não trazer mais por X" para cada pessoa que o
 * trouxe. O gesto corta só as recomendações de X — os posts que X escreve
 * continuam chegando, e o SINK e a denúncia de X continuam valendo. Fica no
 * aparelho; desfaz aqui mesmo ("desfazer") ou em config → conteúdo →
 * listas → não trazem.
 *
 * Por quê: na simulação, com denúncia em só 10% dos spams vistos, a isca
 * vai a 12%; este gesto usado em 20% das vezes a segura (spec §4.8). É o
 * jeito de dizer "esse contato me traz lixo" sem denunciar post honesto e
 * sem deixar de seguir em público.
 */

import { useEffect, useState } from 'react'
import { SlideUpOverlay } from '../UI/SlideUpOverlay'
import { ModalHeader } from '../UI/ModalHeader'
import { setNoBring } from '../../lib/contagion-data'
import { holdFeed, invalidateFeed } from '../../lib/feed'
import { PersonName, PersonNameKey } from './ContagionViaChip'

const ACTION =
  'rounded-lg border border-drift-border/50 px-3 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-text transition-colors hover:border-drift-accent2 hover:text-drift-accent2 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 disabled:opacity-40'

export function ContagionViaSheet({ vias, onClose }: { vias: readonly string[]; onClose: () => void }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  // Última ação: o botão da linha troca (o tocado some), então o foco vai
  // para o novo botão da mesma linha, e o leitor de tela ouve o resultado.
  const [last, setLast] = useState<{ pub: string; cut: boolean } | null>(null)

  // A lista não se mexe com a folha aberta: um evento do relay que
  // recalculasse a aba tiraria o post — e esta folha, que mora no card
  // dele — da tela no meio da ação. Os refreshes pedidos rodam ao fechar.
  useEffect(() => holdFeed(), [])

  async function toggle(pub: string, cut: boolean) {
    if (busy) return
    setBusy(pub)
    try {
      await setNoBring(pub, cut)
      setChanged(true)
      setDone((d) => {
        const next = new Set(d)
        if (cut) next.add(pub)
        else next.delete(pub)
        return next
      })
      setLast({ pub, cut })
    } finally {
      setBusy(null)
    }
  }

  function close() {
    if (changed) invalidateFeed()
    onClose()
  }

  const focusIfLast = (pub: string) => (el: HTMLButtonElement | null) => {
    if (el && last?.pub === pub) el.focus()
  }

  return (
    <SlideUpOverlay onClose={close} ariaLabel="chegou por">
      <ModalHeader title="chegou por" onClose={close} />
      <div className="space-y-4 pb-2">
        <p className="font-mono text-[12px] leading-relaxed text-drift-text/85">
          {vias.length > 1 ? 'estas pessoas driftaram' : 'esta pessoa driftou'} este post, e você confia
          nela{vias.length > 1 ? 's' : ''} — por isso ele chegou até você.
        </p>
        <ul className="space-y-2">
          {vias.map((pub) => (
            <li
              key={pub}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-drift-border/40 bg-drift-surface/40 px-3 py-2.5"
            >
              <span className="min-w-0 truncate font-mono text-[12px] text-drift-text">
                <PersonNameKey pub={pub} />
              </span>
              {done.has(pub) ? (
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-meta text-drift-accent2">não traz mais</span>
                  <button
                    type="button"
                    ref={focusIfLast(pub)}
                    disabled={busy !== null}
                    onClick={() => void toggle(pub, false)}
                    className={ACTION}
                  >
                    desfazer
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  ref={focusIfLast(pub)}
                  disabled={busy !== null}
                  onClick={() => void toggle(pub, true)}
                  className={ACTION}
                >
                  não trazer mais por <PersonName pub={pub} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {/* sempre montada: região que nasce com texto não é anunciada */}
        <p role="status" className="sr-only">
          {last &&
            (last.cut ? (
              <>
                pronto: <PersonName pub={last.pub} /> não traz mais posts para a sua aba contágio
              </>
            ) : (
              <>
                desfeito: <PersonName pub={last.pub} /> volta a trazer posts para a sua aba contágio
              </>
            ))}
        </p>
        <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
          os posts que essa pessoa escreve continuam aparecendo; ela só deixa de trazer posts de
          outras pessoas para a sua aba contágio. fica só no seu aparelho — desfaça aqui ou em
          config → conteúdo → listas → não trazem. se o post é spam ou golpe, denuncie pelo menu ⋮.
        </p>
      </div>
    </SlideUpOverlay>
  )
}
