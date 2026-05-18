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
 *   - text vazio          → title='', body='' (subpost só com imagem
 *                           não mostra label "(sem texto)" — UX preserva
 *                           card limpo, deixa só a imagem falar)
 *   - text 1 linha curta  → title=text, body=''
 *   - text com '\n'       → title=primeira linha, body=resto
 *   - text long sem \n    → title=primeira frase (split '. '),
 *                           body=resto. Se não tem '. ', title='',
 *                           body=text inteiro.
 *
 * TAG synthesis: post.category || post.location?.city || post.contentWarning.
 * Sempre uppercase + tracking 2.5px (mockup .c-tag).
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Subpost, Post, LayoutKind } from '../../types/drift'
import { DEFAULT_LAYOUT } from '../../types/drift'
import { Image } from '../UI/Image'
import { getDecorativeLetters } from '../../lib/decorativeLetters'

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
  // Subpost sem texto (só imagem, p.ex.) — retorna empty pra que
  // SubpostLayout não renderize título placeholder. User feedback
  // 2026-05-08: "Quando tiver imagem mas não houver texto, nao deve
  // aparecer essa label (sem texto)".
  if (!text || !text.trim()) return { title: '', body: '' }
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

function CardText({
  post,
  subpost,
  variant,
  expanded = false,
  onToggleExpanded,
}: {
  post: Post
  subpost: Subpost
  /**
   * 'inset' = bg surface + padding 14/17/18 (portrait/text default).
   * 'overlay' = bg transparent (landscape, sobre gradient).
   * 'centered' = padding 28/22/28, body sem clamp (text layout / expanded).
   */
  variant: 'inset' | 'overlay' | 'centered'
  /**
   * V9.7 (user pedido 2026-05-09): quando true, body renderiza sem
   * clamp e o botão vira "ver menos". Layouts Portrait/Landscape
   * escondem a imagem nesse modo e setam variant='centered'. Default
   * false (estado original do card).
   */
  expanded?: boolean
  /** Toggle handler — only fired pelos botões "ver mais"/"ver menos". */
  onToggleExpanded?: () => void
}) {
  const tag = synthesizeTag(post)
  const { title, body } = splitTitleBody(subpost.text)
  // V9.4 — detecta overflow do body com clamp pra mostrar "ver mais".
  // V9.8 (2026-05-15, Lighthouse forced-reflow audit): movido de
  // useLayoutEffect → useEffect + rAF. Razão: feed com N posts × M
  // subposts disparava N*M reads sync de scrollHeight/clientHeight na
  // commit phase, forçando style+layout flush e gerando warning de
  // forced-reflow no Lighthouse. Agora a medida roda post-paint,
  // batchada num único rAF que o browser resolve em uma layout pass.
  // Custo: 1 frame (~16ms) entre paint inicial (texto clampado com
  // "..." nativo do CSS) e aparição do botão "ver mais". Flicker
  // imperceptível — o conteúdo do card já está correto, só o toggle
  // aparece um frame depois. Re-checa quando body/variant/expanded
  // mudam. User pedido 2026-05-09: "alguns textos grande estão com
  // '...' no final, deveria ter '...ver mais' como ação que abre card
  // com texto completo".
  const bodyRef = useRef<HTMLParagraphElement>(null)
  const [bodyOverflows, setBodyOverflows] = useState(false)
  useEffect(() => {
    // Quando expanded, body não tem clamp → não medimos overflow
    // (sempre cabe). Forçar true libera renderização do "ver menos"
    // mesmo se o texto antes overflowava. Sync update OK aqui: nenhum
    // read DOM antes, só write de state.
    if (expanded) {
      setBodyOverflows(true)
      return
    }
    let cancelled = false
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return
      const el = bodyRef.current
      if (!el) {
        setBodyOverflows(false)
        return
      }
      setBodyOverflows(el.scrollHeight > el.clientHeight + 1)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [body, variant, expanded])
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

  // Body line-clamp:
  // - inset/overlay: clamp-3 (cards menores no feed)
  // - centered: NO CLAMP — com TEXT_MAX_CHARS=250 unified (user feedback
  //   2026-05-08), body cabe naturalmente em viewport mobile sem truncar.
  //   Defesa real é o limite na origem (Compose + Reply). splitTitleBody
  //   geralmente quebra em "." → title curto (1-10 chars) + body resto;
  //   no pior caso (sem split natural), title='' e body inteiro renderiza
  //   em fluid-xs italic — fit confortável.
  const bodyClamp = variant === 'centered' ? '' : 'line-clamp-3'
  // Title size:
  // - centered: text-fluid-display (clamp 13-16px) — text-3xl static (30px)
  //   estourava em mobile narrow. Display 16px max preserva hierarquia
  //   visual sem romper grid. Pra titles legítimos curtos (1-2 sentenças
  //   pré-period split), display é generoso o suficiente.
  // - outros: text-xl (mantém)
  const titleSize = variant === 'centered' ? 'text-fluid-display' : 'text-xl'
  const titleClamp = ''

  // User feedback 2026-05-17: texto sobre imagem ainda perde contraste
  // em fotos super claras (gradient ajuda mas não basta). Aplica
  // text-shadow halo+offset SÓ na variant 'overlay' (Landscape com
  // gradient sobre foto). 'inset' e 'centered' têm bg sólido drift-
  // surface → shadow ali polui sem ganho. Classes em index.css
  // @layer utilities. Tunável (alpha+blur) sem tocar markup.
  const overImage = variant === 'overlay'
  const titleShadow = overImage ? 'text-on-image-title' : ''
  const bodyShadow = overImage ? 'text-on-image-body' : ''
  const metaShadow = overImage ? 'text-on-image-meta' : ''

  return (
    <div className={`relative ${wrapperBg} ${padding} ${flex}`}>
      <div className={`mb-[5px] font-mono text-[12px] uppercase tracking-tag text-drift-muted ${metaShadow}`}>
        {tag}
      </div>
      {title && (
        <h2
          className={`mb-2 font-display font-bold leading-title tracking-title text-drift-text ${titleSize} ${titleClamp} ${titleShadow}`}
        >
          {title}
        </h2>
      )}
      {body && (
        <p
          ref={bodyRef}
          className={`mb-1 font-mono text-xs italic leading-body text-drift-body ${bodyClamp} ${bodyShadow}`}
        >
          {body}
        </p>
      )}
      {body && bodyOverflows && onToggleExpanded && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggleExpanded()
          }}
          // pointer-events-auto: em Portrait/Landscape o CardText vive
          // dentro de um overlay com pointer-events-none (libera tap da
          // imagem). Sem este override o botão herda none → não clica.
          // User report 2026-05-09. touch-action:none delega gestos
          // pro SwipeHandler pai (não bloqueia swipe nav).
          className="pointer-events-auto mb-2 inline-flex items-center self-start font-mono text-[12px] uppercase tracking-meta text-drift-accent2 hover:text-drift-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2 rounded"
          style={{ touchAction: 'none' }}
          // V10.6 — opt-out de long-press (tap explícito pra expandir
          // texto não deve virar moderação).
          data-no-longpress="true"
          aria-label={expanded ? 'recolher texto' : 'expandir texto'}
        >
          {expanded ? 'ver menos' : 'ver mais'}
        </button>
      )}
      {/* Round 4 Fase B (F-11 friction fix): meta line com ícones em vez
          de labels jargão. Antes: "DRIFT 22.1K · SUBS 3 · HÁ 6H" — três
          abreviações em três idiomas conceituais (verbo PT/EN, plural EN,
          advérbio PT). Agora: símbolos universais + número.
          Tooltips preservam significado pra screen readers. */}
      <div className={`flex gap-3 font-mono text-[12px] uppercase tracking-meta text-drift-muted ${metaShadow}`}>
        <span title={`drifts: ${drift}`} aria-label={`${drift} drifts`}>
          <span aria-hidden="true">↑</span>{' '}
          <span className="text-drift-accent2">{drift}</span>
        </span>
        <span title={`${subs} subposts`} aria-label={`${subs} subposts`}>
          <span aria-hidden="true">▣</span>{' '}
          <span className="text-drift-accent2">{subs}</span>
        </span>
        <span title={`há ${age}`} aria-label={`há ${age}`}>
          <span aria-hidden="true">⏱</span>{' '}
          <span className="text-drift-accent2">{age}</span>
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
  const [expanded, setExpanded] = useState(false)
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

  // V9.7 (user pedido 2026-05-09): "ao clicar em ver mais a camada
  // onde tem o texto centraliza o texto e deixamos de exibir a camada
  // de imagem; ver menos volta ao estado original". Modal SlideUpOverlay
  // removido em favor deste expand inline.
  if (expanded) {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-drift-surface">
        <CardText
          post={post}
          subpost={subpost}
          variant="centered"
          expanded
          onToggleExpanded={() => setExpanded(false)}
        />
      </div>
    )
  }

  // V14.3 — refactor estrutural (user feedback 2026-05-07): "pense em
  // dois cards, imagem em baixo e texto em cima com fundo transparente".
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
          lightbox
        />
      </div>

      {/* Card de cima: gradient + texto puramente visuais. User insight
          2026-05-09: "a camada de texto fica em cima da camada de
          imagem e ambas preenchem todo espaço — basta usarmos a
          primeira camada como interface". CardText não tem elementos
          interativos (tag/título/body/meta-stats com ícones). Overlay
          inteira pointer-events-none → imagem absorve TODOS os taps.
          Botão "ver mais" tem pointer-events-auto pra escapar. */}
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{ background: 'var(--card-overlay-gradient)' }}
      >
        <div className="absolute inset-x-0 bottom-0">
          <CardText
            post={post}
            subpost={subpost}
            variant="overlay"
            onToggleExpanded={() => setExpanded(true)}
          />
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
  const [expanded, setExpanded] = useState(false)
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

  // V9.7 expanded mode: idem PortraitLayout.
  if (expanded) {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-drift-surface">
        <CardText
          post={post}
          subpost={subpost}
          variant="centered"
          expanded
          onToggleExpanded={() => setExpanded(false)}
        />
      </div>
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
          lightbox
        />
      </div>
      {/* Card de cima: overlay puramente visual (sem clickables) →
          pointer-events-none na cadeia inteira. Vide explicação em
          PortraitLayout acima. */}
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{ background: 'var(--card-overlay-gradient)' }}
      >
        {/* V9.2: CardDots saiu daqui pro SubpostCarousel (top bar). */}
        <div className="absolute inset-x-0 bottom-0">
          <CardText
            post={post}
            subpost={subpost}
            variant="overlay"
            onToggleExpanded={() => setExpanded(true)}
          />
        </div>
      </div>
    </div>
  )
}

function TextLayout({ subpost, post }: SubpostLayoutProps) {
  const letters = getDecorativeLetters(subpost.text)

  return (
    <div className="flex h-full w-full flex-col bg-drift-surface">
      {/* V9.2: CardDots saiu daqui pro SubpostCarousel (top bar). */}

      {/* Text flex:1 centered. */}
      <div className="relative flex flex-1 flex-col justify-center overflow-hidden">
        <CardText post={post} subpost={subpost} variant="centered" />

        {/* Decorative letter — Syne 800 100px drift-border absolute
            bottom-right. Round 4 Fase B (F-04 / Barney friction audit):
            opacity bumpada de 0.55 → 0.85 — em 0.55 sobre drift-border
            #2a2a2e contra bg drift-surface #15151a o resultado era quase
            invisível, deixando ~70% do card vazio (TX-3 Ted UX spike).
            getDecorativeLetters nunca retorna vazio (fallback '•••' em
            decorativeLetters.ts:46) — defesa em depth. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute select-none font-display font-extrabold uppercase text-drift-border"
          style={{
            fontSize: '100px',
            letterSpacing: '-6px',
            opacity: 0.85,
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
