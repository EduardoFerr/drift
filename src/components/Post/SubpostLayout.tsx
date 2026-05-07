/**
 * SubpostLayout — V4 three-layout system + V8 full card content.
 *
 * V4 introduziu layout enum (portrait/landscape/text). V8 expandiu o
 * contrato: SubpostLayout agora renderiza o CARD COMPLETO (não só a
 * mídia) — incluindo tag row, título Syne, body italic, meta stats,
 * dots indicator. Razão: cada layout posiciona estes blocos de forma
 * radicalmente diferente (mockup v0.7), e renderizar de fora obrigaria
 * positioning hacks. Camada V4 "pure de subpost" virou "pure de
 * (subpost, post, idx, total)" — ainda determinística (§7).
 *
 * 3 templates (CSS reference: drift.html mockup linhas 65-105):
 *
 *   portrait — flex column. Media flex:1 top. Dots middle (border
 *     top/bottom). Text block bottom (tag/title/body/meta).
 *
 *   landscape — display block. Media absolute fill com gradient bottom.
 *     Dots absolute z-3 acima do text. Text block absolute bottom
 *     transparent (sobre o gradient).
 *
 *   text — flex column. Sem media. Dots top (border-bottom). Text block
 *     flex:1 centered. Decorative letter Syne 800 100px absolute
 *     bottom-right (aria-hidden).
 *
 * Switch exhaustive (assertNever) — adicionar layout novo a
 * LAYOUT_VALUES sem case quebra a build.
 *
 * HEURISTIC title/body split: subpost.text não tem campo title
 * separado. Synthesis determinística (§7):
 *   - text vazio          → title='(sem texto)', body=''
 *   - text 1 linha curta  → title=text, body=''
 *   - text com '\n'       → title=primeira linha, body=resto
 *   - text long sem \n    → title=primeira frase (split '. '),
 *                           body=resto. Se não tem '. ', title='',
 *                           body=text inteiro.
 *
 * TAG synthesis: post.category || post.location?.city || post.contentWarning.
 * Sempre uppercase + tracking 2.5px (mockup .c-tag).
 */

import type { ReactNode } from 'react'
import type { Subpost, Post, LayoutKind } from '../../types/drift'
import { DEFAULT_LAYOUT } from '../../types/drift'
import { Image } from '../UI/Image'
import { getDecorativeLetters } from '../../lib/decorativeLetters'
import { DotsIndicator } from '../UI/DotsIndicator'

export interface SubpostLayoutProps {
  subpost: Subpost
  post: Post
  /** 0-indexed position in subposts array. Pra dots indicator. */
  subpostIdx: number
  /** Total de subposts. DotsIndicator retorna null se ≤1. */
  subpostsTotal: number
}

export function SubpostLayout({
  subpost,
  post,
  subpostIdx,
  subpostsTotal,
}: SubpostLayoutProps): ReactNode {
  const layout: LayoutKind = subpost.layout ?? DEFAULT_LAYOUT

  switch (layout) {
    case 'portrait':
      return (
        <PortraitLayout
          subpost={subpost}
          post={post}
          subpostIdx={subpostIdx}
          subpostsTotal={subpostsTotal}
        />
      )
    case 'landscape':
      return (
        <LandscapeLayout
          subpost={subpost}
          post={post}
          subpostIdx={subpostIdx}
          subpostsTotal={subpostsTotal}
        />
      )
    case 'text':
      return (
        <TextLayout
          subpost={subpost}
          post={post}
          subpostIdx={subpostIdx}
          subpostsTotal={subpostsTotal}
        />
      )
    default:
      return assertNever(layout)
  }
}

function assertNever(x: never): never {
  throw new Error(`SubpostLayout: layout não tratado (${String(x)})`)
}

// ─── Pure helpers (testáveis) ────────────────────────────────────────

/**
 * Synthesize tag row do post. Determinístico.
 * Ex.: "DERIVA · SÃO PAULO" (location), "PENSAMENTO · INTERIOR" (category),
 *      "⚠ NSFW" (contentWarning), "DERIVA" (fallback).
 */
export function synthesizeTag(post: Post): string {
  const parts: string[] = []
  if (post.category) parts.push(post.category.toUpperCase())
  if (post.location?.city) parts.push(post.location.city.toUpperCase())
  if (parts.length === 0 && post.contentWarning) {
    return `⚠ ${String(post.contentWarning).toUpperCase()}`
  }
  if (parts.length === 0) return 'DERIVA'
  return parts.join(' · ')
}

/**
 * Synthesize title/body do subpost.text. Determinístico.
 * Heurística: \n divide; senão primeiro `. ` divide; senão tudo é body.
 */
export function splitTitleBody(text: string | null): {
  title: string
  body: string
} {
  if (!text || !text.trim()) return { title: '(sem texto)', body: '' }
  const trimmed = text.trim()

  // 1. Newline divide?
  const nl = trimmed.indexOf('\n')
  if (nl > 0) {
    return {
      title: trimmed.slice(0, nl).trim(),
      body: trimmed.slice(nl + 1).trim(),
    }
  }

  // 2. Curto e sem newline → tudo é title
  if (trimmed.length <= 60) {
    return { title: trimmed, body: '' }
  }

  // 3. Longo e sem newline → split na primeira sentença
  const dot = trimmed.indexOf('. ')
  if (dot > 0 && dot < 80) {
    return {
      title: trimmed.slice(0, dot + 1).trim(),
      body: trimmed.slice(dot + 2).trim(),
    }
  }

  // 4. Sem split natural — tudo vai no body
  return { title: '', body: trimmed }
}

/**
 * Format meta stats numéricos. 22100 → "22.1K".
 */
export function formatStat(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/**
 * Format "tempo atrás" no formato compacto do mockup ("6H", "3D", "12MIN").
 * Determinístico — recebe `now` em segundos opcionalmente pra testes.
 */
export function timeAgoCompact(unixSeconds: number, now = Math.floor(Date.now() / 1000)): string {
  const diff = now - unixSeconds
  if (diff < 60) return `${diff}S`
  if (diff < 3600) return `${Math.floor(diff / 60)}MIN`
  if (diff < 86400) return `${Math.floor(diff / 3600)}H`
  return `${Math.floor(diff / 86400)}D`
}

// ─── Card pieces (compartilhadas pelos 3 layouts) ────────────────────

function CardDots({ idx, total }: { idx: number; total: number }) {
  // Mockup .c-dots com border-top/bottom controlado pelo layout pai
  // (portrait/text) ou border-none + position absolute (landscape).
  // Layout pai aplica wrapper; aqui só renderiza os dots.
  return (
    <div className="flex items-center justify-center gap-[5px] py-[7px]">
      <DotsIndicator total={total} active={idx} />
    </div>
  )
}

function CardText({
  post,
  subpost,
  variant,
}: {
  post: Post
  subpost: Subpost
  /**
   * 'inset' = bg surface + padding 14/17/18 (portrait/text default).
   * 'overlay' = bg transparent (landscape, sobre gradient).
   * 'centered' = padding 28/22/28, body sem clamp (text layout).
   */
  variant: 'inset' | 'overlay' | 'centered'
}) {
  const tag = synthesizeTag(post)
  const { title, body } = splitTitleBody(subpost.text)
  const drift = formatStat(post.spreads)
  const subs = post.subposts.length
  const age = timeAgoCompact(post.createdAt)

  const wrapperBg = variant === 'overlay' ? '' : 'bg-drift-surface'
  // pb maior pra inset (Portrait): user feedback 2026-05-07 — depois
  // que removemos o p-4 do wrapper externo do card no PostViewer, o
  // pb-[18px] anterior deixava o meta line "colado" no fim do card
  // (faltavam 16px que vinham do p-4). Bumpa pra pb-7 (28px) só no
  // inset; overlay (Landscape) e centered (Text) ficam intocados.
  // Padding tokens vêm do design-system mockup v0.7 (definidos em
  // tailwind.config.js + CSS vars em index.css). 'inset' Portrait
  // dispensa pt — texto fica abaixo da imagem que já tem padding
  // visual via gradient ou bg.
  const padding =
    variant === 'centered'
      ? 'px-card-x-wide py-7'
      : variant === 'overlay'
      ? 'px-card-x pt-3.5 pb-card'
      : 'px-card-x pb-7'

  // Layout 'text' (variant='centered') flex flex-col justify-center
  // pra texto subir do meio. Outros: bloco normal.
  const flex = variant === 'centered' ? 'flex flex-1 flex-col justify-center' : ''

  // Body line-clamp 3 nos modos inset/overlay; text layout sem clamp.
  const bodyClamp = variant === 'centered' ? '' : 'line-clamp-3'
  const titleSize = variant === 'centered' ? 'text-3xl' : 'text-xl'

  return (
    <div className={`relative ${wrapperBg} ${padding} ${flex}`}>
      <div className="mb-[5px] font-mono text-[9px] uppercase tracking-tag text-drift-muted">
        {tag}
      </div>
      {title && (
        <h2
          className={`mb-2 font-display font-bold leading-title tracking-title text-drift-text ${titleSize}`}
        >
          {title}
        </h2>
      )}
      {body && (
        <p
          className={`mb-2.5 font-mono text-xs italic leading-body text-drift-body ${bodyClamp}`}
        >
          {body}
        </p>
      )}
      <div className="flex gap-3 font-mono text-[9px] uppercase tracking-meta text-drift-muted">
        <span>
          DRIFT <span className="text-drift-accent2">{drift}</span>
        </span>
        <span>
          SUBS <span className="text-drift-accent2">{subs}</span>
        </span>
        <span>
          HÁ <span className="text-drift-accent2">{age}</span>
        </span>
      </div>
    </div>
  )
}

// ─── Templates ───────────────────────────────────────────────────────

function PortraitLayout({
  subpost,
  post,
  subpostIdx,
  subpostsTotal,
}: SubpostLayoutProps) {
  const hasImage =
    (subpost.type === 'image' || subpost.type === 'text+image') && subpost.imageUrl

  // V9.3 graceful fallback: se subpost foi marcado como portrait mas
  // NÃO tem imagem (autor escolheu portrait mas só escreveu texto),
  // delega pra TextLayout — visual editorial com decorative letter
  // em vez do feio "(sem imagem)" placeholder. Mockup nunca mostra
  // portrait vazio; sempre é um dos 3 templates plenos.
  if (!hasImage) {
    return (
      <TextLayout
        subpost={subpost}
        post={post}
        subpostIdx={subpostIdx}
        subpostsTotal={subpostsTotal}
      />
    )
  }

  // V14.3 — refactor estrutural (user feedback 2026-05-07): "pense em
  // dois cards, imagem em baixo e texto em cima com fundo transparente".
  // Antes: flex column com image flex-1 + text shrink-0 — texto e
  // imagem como siblings no mesmo nível. Agora: layered overlay igual
  // ao LandscapeLayout. Image absolute fill (preserva inteira via
  // fit=contain + position=top, sem crop), text absolute bottom com
  // bg transparente via variant=overlay + gradient pra legibilidade.
  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Card de baixo: imagem. fit=contain preserva imagem inteira
          (sem crop); position=top alinha no topo, letterbox cai embaixo
          onde o gradient + text overlay absorvem. */}
      <div className="absolute inset-0 overflow-hidden">
        <Image
          src={subpost.imageUrl!}
          meta={subpost.meta}
          position="top"
          className="block h-full w-full"
          aspect="auto"
        />
      </div>

      {/* Card de cima: gradient é o bg do card de texto — dots e texto
          são filhos dele (correção user feedback: estavam siblings, mas
          semanticamente são parte do mesmo "card de texto").
          pointer-events-none no wrapper deixa cliques passarem pra
          imagem nas áreas vazias do gradient; filhos com
          pointer-events-auto recuperam interatividade onde precisa. */}
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          background:
            'linear-gradient(to top, rgba(10,10,9,0.96) 0%, rgba(10,10,9,0.55) 45%, transparent 70%)',
        }}
      >
        {subpostsTotal > 1 && (
          <div className="pointer-events-auto absolute inset-x-0 z-[3] bottom-[88px] py-2">
            <CardDots idx={subpostIdx} total={subpostsTotal} />
          </div>
        )}
        <div className="pointer-events-auto absolute inset-x-0 bottom-0">
          <CardText post={post} subpost={subpost} variant="overlay" />
        </div>
      </div>
    </div>
  )
}

function LandscapeLayout({
  subpost,
  post,
  subpostIdx,
  subpostsTotal,
}: SubpostLayoutProps) {
  const hasImage =
    (subpost.type === 'image' || subpost.type === 'text+image') && subpost.imageUrl

  if (!hasImage) {
    // V9.3 fallback: landscape sem imagem → TextLayout (não Portrait,
    // porque Portrait sem imagem também caia em Text). Decorative
    // letter > placeholder vazio.
    return (
      <TextLayout
        subpost={subpost}
        post={post}
        subpostIdx={subpostIdx}
        subpostsTotal={subpostsTotal}
      />
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Media absolute fill. Image internamente é position:relative
          (precisa pro skeleton overlay) — então envolvemos num wrapper
          absoluto pra escapar do flow normal.
          User feedback 2026-05-07: paisagem deve renderizar imagem em
          tamanho natural (width/height auto) com object-position: center
          top. Container tem overflow-hidden; pixels que extrapolam ficam
          cortados a partir do bottom. Sem object-fit, sem scaling.
          natural=true muda os styles do <img> internamente. */}
      <div className="absolute inset-0 overflow-hidden">
        <Image
          src={subpost.imageUrl!}
          meta={subpost.meta}
          natural
          position="top"
          className="block h-full w-full"
          aspect="auto"
        />
      </div>
      {/* Card de cima: gradient é o bg do card de texto — dots e texto
          são filhos. pointer-events-none no wrapper deixa cliques
          passarem pra imagem nas áreas vazias; filhos com pointer-
          events-auto recuperam interatividade onde precisa.
          Bottom calc do dots: 16(meta gap) + 14(padding-top text) +
          20(title) + 38(body+meta) ≈ 88px. */}
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          background:
            'linear-gradient(to top, rgba(10,10,9,0.96) 0%, rgba(10,10,9,0.55) 45%, transparent 70%)',
        }}
      >
        {subpostsTotal > 1 && (
          <div className="pointer-events-auto absolute inset-x-0 z-[3] bottom-[88px] py-2">
            <CardDots idx={subpostIdx} total={subpostsTotal} />
          </div>
        )}
        <div className="pointer-events-auto absolute inset-x-0 bottom-0">
          <CardText post={post} subpost={subpost} variant="overlay" />
        </div>
      </div>
    </div>
  )
}

function TextLayout({
  subpost,
  post,
  subpostIdx,
  subpostsTotal,
}: SubpostLayoutProps) {
  const letters = getDecorativeLetters(subpost.text)

  return (
    <div className="flex h-full w-full flex-col bg-drift-surface">
      {/* Dots top (border-bottom). */}
      {subpostsTotal > 1 && (
        <div className="shrink-0 border-b border-drift-border">
          <CardDots idx={subpostIdx} total={subpostsTotal} />
        </div>
      )}

      {/* Text flex:1 centered. */}
      <div className="relative flex flex-1 flex-col justify-center overflow-hidden">
        <CardText post={post} subpost={subpost} variant="centered" />

        {/* Decorative letter — Syne 800 100px drift-border opacity 0.55,
            absolute bottom-right negative offsets pra colar na borda. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute select-none font-display font-extrabold uppercase text-drift-border"
          style={{
            fontSize: '100px',
            letterSpacing: '-6px',
            opacity: 0.55,
            lineHeight: 1,
            right: '-10px',
            bottom: '-18px',
          }}
        >
          {letters}
        </span>
      </div>
    </div>
  )
}
