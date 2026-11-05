/**
 * "↪ chegou por X" — aba Contágio (manifesto §24 emendado: nenhum sinal
 * que o leitor não vê). Mostra o contato de maior vínculo que trouxe o
 * post; é esse contato que perde 0,5 de vínculo se o leitor denunciar
 * daqui (o SINK não pune ninguém). Não aparece para post que entrou direto.
 *
 * Canto inferior esquerdo do card — o direito é do LensInspector, o topo
 * das ações. Não é botão: só informa.
 */

import { useUserMetadata } from '../../lib/profiles'

export function ContagionViaChip({ viaPub }: { viaPub: string }) {
  const meta = useUserMetadata(viaPub)
  const name = meta?.displayName?.trim() || meta?.name?.trim() || `anon…${viaPub.slice(-6)}`
  return (
    <span
      className="pointer-events-none absolute bottom-4 left-4 z-30 inline-flex h-8 max-w-[60%] items-center gap-1 truncate rounded-full border border-drift-border bg-drift-surface/85 px-3 font-mono text-[10px] uppercase tracking-meta text-drift-muted backdrop-blur-sm"
      title={`chegou por ${name} — denunciar daqui também enfraquece esse vínculo`}
      data-testid="contagion-via"
    >
      <span aria-hidden="true">↪</span>
      <span className="truncate">chegou por {name}</span>
    </span>
  )
}
