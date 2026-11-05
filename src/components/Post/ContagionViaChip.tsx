/**
 * "↪ chegou por X" — aba Contágio (manifesto §24 emendado: nenhum sinal
 * que o leitor não vê). Mostra os contatos de maior vínculo que trouxeram
 * o post (`Post.arrivedVia`); com empate, "Ana, Bia +1". São exatamente
 * esses que perdem 0,5 de vínculo se o leitor denunciar o post — o modal
 * de denúncia diz isso antes do envio. O SINK não pune ninguém (§23).
 *
 * Fica no bloco de texto do card, acima do autor (não sobre a imagem nem
 * sobre a linha de números). Não aparece para post que entrou direto.
 */

import { useUserMetadata } from '../../lib/profiles'

/** Nome exibível de uma chave (kind 0 ou `anon…últimos6`). */
export function PersonName({ pub }: { pub: string }) {
  const meta = useUserMetadata(pub)
  return <>{meta?.displayName?.trim() || meta?.name?.trim() || `anon…${pub.slice(-6)}`}</>
}

/** "Ana", "Ana e Bia", "Ana, Bia e Caio". */
export function PeopleNames({ pubs }: { pubs: readonly string[] }) {
  return (
    <>
      {pubs.map((pub, i) => (
        <span key={pub}>
          {i > 0 && (i === pubs.length - 1 ? ' e ' : ', ')}
          <PersonName pub={pub} />
        </span>
      ))}
    </>
  )
}

const SHOWN = 2

export function ContagionViaChip({ vias }: { vias: readonly string[] }) {
  if (vias.length === 0) return null
  const shown = vias.slice(0, SHOWN)
  const more = vias.length - shown.length
  return (
    <div className="mb-2" data-testid="contagion-via">
      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-drift-border bg-drift-surface/85 px-3 py-1 font-mono text-[10px] uppercase tracking-meta text-drift-muted">
        <span aria-hidden="true">↪</span>
        {/* leitor de tela: a lista completa, sem abreviação */}
        <span className="sr-only">
          chegou por <PeopleNames pubs={vias} />
        </span>
        <span aria-hidden="true" className="truncate">
          chegou por {shown.map((pub, i) => (
            <span key={pub}>
              {i > 0 && ', '}
              <PersonName pub={pub} />
            </span>
          ))}
          {more > 0 && ` +${more}`}
        </span>
      </span>
    </div>
  )
}
