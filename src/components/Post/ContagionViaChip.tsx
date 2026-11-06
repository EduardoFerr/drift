/**
 * "↪ chegou por X" — aba Contágio (manifesto §24 emendado: nenhum sinal
 * que o leitor não vê). Mostra os contatos de maior vínculo que trouxeram
 * o post (`Post.arrivedVia`); com empate, "Ana, Bia +1". São exatamente
 * esses que perdem 0,5 de vínculo se o leitor denunciar o post — o modal
 * de denúncia diz isso antes do envio. O SINK não pune ninguém (§23).
 *
 * Tocar na etiqueta abre "não trazer mais por X" (ContagionViaSheet): o
 * gesto local que corta as recomendações daquela pessoa e dá ao SINK e à
 * denúncia dela o peso de quem o leitor só segue.
 *
 * Fica no bloco de texto do card, acima do autor (não sobre a imagem nem
 * sobre a linha de números). Não aparece para post que entrou direto.
 */

import { createContext, useContext } from 'react'
import { useUserMetadata } from '../../lib/profiles'

/** Quem renderiza o card (PostViewer) abre a folha "chegou por". */
export const ContagionViaContext = createContext<((vias: readonly string[]) => void) | null>(null)

/** Nome exibível de uma chave (kind 0 ou `anon…últimos6`). */
export function PersonName({ pub }: { pub: string }) {
  const meta = useUserMetadata(pub)
  return <>{meta?.displayName?.trim() || meta?.name?.trim() || `anon…${pub.slice(-6)}`}</>
}

/** Começo e fim da chave ("1a2b3c4d…5e6f7a8b"): 64 bits — forjar uma chave
 *  com o mesmo começo e fim de um amigo é inviável; só o fim (6 caracteres,
 *  24 bits) sai em minutos numa CPU comum. */
export function keyMark(pub: string): string {
  return `${pub.slice(0, 8)}…${pub.slice(-8)}`
}

/**
 * Nome + começo e fim da chave ("Ana 1a2b3c4d…5e6f7a8b"), onde a escolha
 * importa (folha "chegou por", lista "não trazem", aviso da denúncia): uma
 * conta que copia o nome de um amigo fica fácil de distinguir.
 */
export function PersonNameKey({ pub }: { pub: string }) {
  const meta = useUserMetadata(pub)
  const name = meta?.displayName?.trim() || meta?.name?.trim() || 'anon'
  // dentro de um pai `flex min-w-0`: o nome corta com reticências, a chave
  // nunca some; normal-case: dentro de botão em maiúsculas ela fica igual à
  // da linha
  return (
    <>
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 normal-case text-drift-muted">&nbsp;{keyMark(pub)}</span>
    </>
  )
}

/** "Ana", "Ana e Bia", "Ana, Bia e Caio" — com `withKey`, cada nome com o
 *  começo e o fim da chave (onde há punição em jogo: a denúncia). */
export function PeopleNames({ pubs, withKey = false }: { pubs: readonly string[]; withKey?: boolean }) {
  return (
    <>
      {pubs.map((pub, i) => (
        <span key={pub}>
          {i > 0 && (i === pubs.length - 1 ? ' e ' : ', ')}
          <PersonName pub={pub} />
          {withKey && <span className="normal-case text-drift-muted"> ({keyMark(pub)})</span>}
        </span>
      ))}
    </>
  )
}

const SHOWN = 2
const PILL =
  'inline-flex max-w-full items-center gap-1 rounded-full border border-drift-border bg-drift-surface/85 px-3 py-1 font-mono text-[10px] uppercase tracking-meta text-drift-muted'

export function ContagionViaChip({ vias }: { vias: readonly string[] }) {
  const open = useContext(ContagionViaContext)
  if (vias.length === 0) return null
  const shown = vias.slice(0, SHOWN)
  const more = vias.length - shown.length
  const body = (
    <>
      <span aria-hidden="true">↪</span>
      {/* leitor de tela: a lista completa, sem abreviação */}
      <span className="sr-only">
        chegou por <PeopleNames pubs={vias} />
      </span>
      <span aria-hidden="true" className="truncate">
        chegou por{' '}
        {shown.map((pub, i) => (
          <span key={pub}>
            {i > 0 && ', '}
            <PersonName pub={pub} />
          </span>
        ))}
        {more > 0 && ` +${more}`}
      </span>
    </>
  )
  return (
    <div className="mb-2" data-testid="contagion-via">
      {open ? (
        <button
          type="button"
          aria-haspopup="dialog"
          // o card inteiro é área de gesto (swipe/long-press): a etiqueta
          // não deixa o toque vazar para ele
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            open(vias)
          }}
          data-no-longpress="true"
          // pointer-events-auto: em post com imagem o texto do card vive
          // numa camada pointer-events-none (o toque vai para a imagem),
          // como o "ver mais" (SubpostLayout)
          className={`${PILL} pointer-events-auto min-h-[28px] cursor-pointer transition-colors hover:border-drift-accent2 hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2`}
        >
          {body}
          <span aria-hidden="true" className="opacity-60">›</span>
        </button>
      ) : (
        <span className={PILL}>{body}</span>
      )}
    </div>
  )
}
