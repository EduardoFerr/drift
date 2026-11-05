/**
 * Folha "chegou por" (aba Contágio): explica por que o post chegou e
 * oferece o gesto local "não trazer mais por X" para cada pessoa que o
 * trouxe. O gesto corta só as recomendações de X — os posts que X escreve
 * continuam chegando, e o SINK e a denúncia de X continuam valendo. Fica no
 * aparelho; desfaz em configurações → listas locais → não trazem.
 *
 * Por quê: na simulação, com denúncia em só 10% dos spams vistos, a isca
 * vai a 12%; este gesto usado em 20% das vezes a segura (spec §4.8). É o
 * jeito de dizer "esse contato me traz lixo" sem denunciar post honesto e
 * sem deixar de seguir em público.
 */

import { useState } from 'react'
import { SlideUpOverlay } from '../UI/SlideUpOverlay'
import { ModalHeader } from '../UI/ModalHeader'
import { setNoBring } from '../../lib/contagion-data'
import { invalidateFeed } from '../../lib/feed'
import { PersonName } from './ContagionViaChip'

export function ContagionViaSheet({ vias, onClose }: { vias: readonly string[]; onClose: () => void }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  async function cut(pub: string) {
    if (busy) return
    setBusy(pub)
    try {
      await setNoBring(pub, true)
      setDone((d) => new Set(d).add(pub))
    } finally {
      setBusy(null)
    }
  }

  // A aba só se atualiza ao fechar: atualizar já tiraria o post (e esta
  // folha, que mora no card dele) da tela antes da confirmação aparecer.
  function close() {
    if (done.size > 0) invalidateFeed()
    onClose()
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
                <PersonName pub={pub} />
              </span>
              {done.has(pub) ? (
                <span className="font-mono text-[11px] uppercase tracking-meta text-drift-accent2" role="status">
                  não traz mais
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void cut(pub)}
                  className="rounded-lg border border-drift-border/50 px-3 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-text transition-colors hover:border-drift-accent2 hover:text-drift-accent2 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 disabled:opacity-40"
                >
                  não trazer mais por <PersonName pub={pub} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
          os posts que essa pessoa escreve continuam aparecendo; ela só deixa de trazer posts de
          outras pessoas para a sua aba contágio. fica só no seu aparelho — desfaça em
          configurações → listas locais → não trazem. se o post é spam ou golpe, denuncie pelo menu ⋮.
        </p>
      </div>
    </SlideUpOverlay>
  )
}
