/**
 * Helpers de formatação compartilhados.
 *
 * Antes deste módulo, várias cópias literais de `timeAgo(unixSeconds)`
 * viviam espalhadas em `Feed/PostCard.tsx`, `Post/PostViewer.tsx` e
 * `Post/CommentCard.tsx` — risco de drift se uma fosse atualizada
 * sozinha. Esta consolidação preserva o comportamento original
 * (lowercase `s`/`min`/`h`/`d`).
 *
 * Outros formatos compactos (uppercase `S`/`MIN`/`H`/`D` do mockup
 * portrait/landscape) seguem em `SubpostLayout.timeAgoCompact` por ser
 * outra spec visual; assinatura ms (`LocalListsSettings.timeAgo`)
 * idem (input semanticamente diferente).
 */

/**
 * "Tempo atrás" lowercase compacto (s/min/h/d) a partir de unix
 * timestamp em segundos.
 *
 * `now` opcional pra testes determinísticos (manifesto §7).
 */
export function timeAgo(
  unixSeconds: number,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const diff = now - unixSeconds
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
