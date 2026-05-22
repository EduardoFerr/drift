/**
 * AuthorChip — header sutil de autor (avatar + alias) reutilizado em
 * SubpostLayout (CardText meta line) e CommentCard.
 *
 * Lily Sprint N+2 P2.11 (audit profile-picture-audit-2026-05-21).
 *
 * Contrato:
 *   - `picture` opt-in (manifesto §5.3) — fallback identicon determinístico
 *     derivado dos 8 primeiros chars do authorPub
 *   - `alias` opt-in — fallback `anon…<last6>` (mesma convenção do
 *     ProfileModal + CommentCard legacy)
 *   - `picture` passa por `isSafeAvatarUrl` ANTES do <img> (manifesto §28
 *     Barney audit: rejeita `javascript:`, `file://`, data: não-imagem,
 *     etc. — fallback silencioso pro identicon). `referrerPolicy="no-referrer"`
 *     + `loading="lazy"` obrigatórios (LOCK_VIA_TEST avatar-url-safety).
 *
 * Visual: sutil — avatar 24px, alias font-mono uppercase tracking-meta
 * text-drift-muted. Não compete com title/body do card. Tamanho `sm`
 * pra inset/overlay (cards no feed), `xs` pra comments list-variant
 * (mais compacto).
 */

import type { ReactNode } from 'react'

export interface AuthorChipProps {
  /** Hex pubkey 64 chars OU npub bech32 — usado pro fallback identicon. */
  authorPub: string
  /** display_name OR name do kind 0 (LWW). undefined = modo Anônimo (§5.3). */
  alias?: string
  /** URL https:// ou data:image/ do kind 0. Schemes hostis caem no fallback. */
  picture?: string
  /** Tamanho do avatar (px). 24 default; 20 pra list-variant compacto. */
  size?: 'xs' | 'sm'
  /** Classes extras pro wrapper (margin, gap fine-tuning no caller). */
  className?: string
  /** Adverbiar em overlay (Landscape): aplica text-shadow halo pra contraste. */
  overlay?: boolean
}

/**
 * Manifesto §28 — scheme whitelist defensivo. Espelha
 * ProfileModal.tsx:isSafeAvatarUrl (mesma lista: https:// + data:image/).
 * Defensa em camada: feed.ts:rowToPost confia no autor; AuthorChip não.
 */
function isSafeAvatarUrl(url: string): boolean {
  if (!url) return false
  // wcag-audit: ok reason=length-cap-prevents-DoS-from-massive-data-urls
  if (url.length > 4096) return false
  const lower = url.trim().toLowerCase()
  return lower.startsWith('https://') || lower.startsWith('data:image/')
}

/**
 * "anon…<last6>". Espelha truncate() em CommentCard.tsx + ProfileModal.
 */
function aliasFallback(pub: string): string {
  if (!pub) return 'anon'
  if (pub.length <= 8) return `anon${pub}`
  return `anon…${pub.slice(-6)}`
}

export function AuthorChip({
  authorPub,
  alias,
  picture,
  size = 'sm',
  className = '',
  overlay = false,
}: AuthorChipProps): ReactNode {
  const display = alias?.trim() || aliasFallback(authorPub)
  const px = size === 'xs' ? 20 : 24
  const fontSize = size === 'xs' ? 'text-[10px]' : 'text-[12px]'
  const aliasShadow = overlay ? 'text-on-image-meta' : ''

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      // a11y: chip é decorativo — title já cobre o autor pro screen reader.
      title={`autor: ${display}`}
    >
      <Avatar pub={authorPub} picture={picture} px={px} alt={display} />
      <span
        className={`font-mono uppercase tracking-meta text-drift-muted ${fontSize} ${aliasShadow}`}
      >
        {display}
      </span>
    </span>
  )
}

function Avatar({
  pub,
  picture,
  px,
  alt,
}: {
  pub: string
  picture?: string
  px: number
  alt: string
}) {
  const style = { width: px, height: px }
  if (picture && isSafeAvatarUrl(picture)) {
    return (
      <img
        src={picture}
        alt={alt}
        // Barney §28 — `referrerPolicy="no-referrer"` evita que origem do
        // avatar (potencialmente hostil) colha viewer's Referer + IP.
        // `loading="lazy"` reduz DoS de avatares enormes em listas.
        referrerPolicy="no-referrer"
        loading="lazy"
        style={style}
        className="shrink-0 rounded-full border border-drift-border/40 object-cover"
        onError={(e) => {
          // URL quebrou → esconde img. Pai não re-renderiza com identicon
          // (sem state), mas o gap fica pequeno (size=20/24) — aceitável
          // vs custo de useState pro hot path do feed.
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
    )
  }
  // Identicon determinístico — hue derivado dos 8 primeiros chars do pub
  // (hex ou npub funciona). Mesma fórmula do ProfileModal pra consistência
  // visual cross-component (user vê o mesmo "tom" do avatar no feed e no
  // modal). Manifesto §7 determinismo.
  //
  // Fix 2026-05-21 (Lily): parseInt('preview', 16) = NaN → hsl(NaN,...)
  // = CSS inválido → avatar quebra visualmente (bug PreviewOverlay).
  // Guard defensivo: pub não-hex → hue fallback 180 (cyan neutro).
  // Defesa em camada — ComposeOverlay também passa pub hex válido agora.
  const parsedHue = parseInt(pub.slice(0, 8), 16)
  const hue = Number.isFinite(parsedHue) ? parsedHue % 360 : 180
  const initials = pub.slice(0, 2).toUpperCase()
  return (
    <span
      style={{ ...style, background: `hsl(${hue}, 50%, 60%)` }}
      className="grid shrink-0 place-items-center rounded-full border border-drift-border/40 font-display text-[10px] font-bold text-drift-bg"
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
