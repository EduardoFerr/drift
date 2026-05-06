/**
 * SubpostLayout — V4 three-layout system.
 *
 * Aplica template visual baseado em `subpost.layout` (LayoutKind).
 * Single source of truth do enum: `LAYOUT_VALUES` em `types/drift.ts`.
 *
 * IMPLEMENTAÇÃO: switch exhaustive (NÃO `Record<K, fn>` registry).
 * Razão: 3 keys fixas e fechadas — não há plug-in externo (manifesto §12,
 * sem chave mestra disfarçada de "extensão"). Switch + `assertNever` no
 * default branch é mais legível, mantém locality do control flow, e o
 * type-checker pega exhaustiveness via `never` (compile error se alguém
 * adicionar 'square' a LAYOUT_VALUES sem case correspondente).
 *
 * HIMYM Round 1 (Ted, Lily) consensus: registry pattern era
 * over-engineering. Round 2: ratificado.
 *
 * TEMPLATES (alinhados ao mockup v0.7):
 *
 *   portrait — imagem topo flex:1, texto bottom fixo. Padrão Stories.
 *
 *   landscape — imagem absolute inset-0, gradient overlay bottom 96%
 *     opacity, texto overlaid (absolute bottom-16px). Photo-card.
 *
 *   text — sem imagem, texto centralizado, decorative letter Syne 800
 *     100px drift-border opacity 0.55 absolute bottom-right (aria-hidden).
 *     Card text-first. Manuscript vibe.
 *
 * DEFESA: subpost.layout deveria sempre vir já normalizado (read path =
 * feed.ts:parseSubposts; write path = protocol.ts:createPost). Mesmo
 * assim, default branch chama assertNever — se um caller passar layout
 * inválido programaticamente, TS quebra. Defesa em camada (manifesto §7).
 */

import type { ReactNode } from 'react'
import type { Subpost, LayoutKind } from '../../types/drift'
import { DEFAULT_LAYOUT } from '../../types/drift'
import { Image } from '../UI/Image'
import { getDecorativeLetters } from '../../lib/decorativeLetters'

export interface SubpostLayoutProps {
  subpost: Subpost
}

export function SubpostLayout({ subpost }: SubpostLayoutProps): ReactNode {
  // Defensive: caller que não normalizou (ex.: test direto sem feed.ts
  // pipeline) cai pra DEFAULT_LAYOUT. Não throw — UI sempre renderiza.
  const layout: LayoutKind = subpost.layout ?? DEFAULT_LAYOUT

  switch (layout) {
    case 'portrait':
      return <PortraitLayout subpost={subpost} />
    case 'landscape':
      return <LandscapeLayout subpost={subpost} />
    case 'text':
      return <TextLayout subpost={subpost} />
    default:
      // Exhaustiveness check — adicionar layout novo a LAYOUT_VALUES sem
      // case correspondente quebra o build (TS2345: Argument of type
      // 'string' is not assignable to parameter of type 'never').
      return assertNever(layout)
  }
}

function assertNever(x: never): never {
  throw new Error(`SubpostLayout: layout não tratado (${String(x)})`)
}

// ─── Templates ───────────────────────────────────────────────────────

function PortraitLayout({ subpost }: { subpost: Subpost }) {
  const hasImage =
    (subpost.type === 'image' || subpost.type === 'text+image') && subpost.imageUrl

  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      {hasImage && (
        <div className="flex flex-1 items-center justify-center overflow-hidden">
          <Image
            src={subpost.imageUrl!}
            className="max-h-full max-w-full rounded"
            aspect="auto"
          />
        </div>
      )}
      {subpost.text && (
        <p className="shrink-0 whitespace-pre-wrap text-center font-mono text-[13px] leading-relaxed text-drift-text">
          {subpost.text}
        </p>
      )}
      {!hasImage && !subpost.text && <EmptyContent />}
    </div>
  )
}

function LandscapeLayout({ subpost }: { subpost: Subpost }) {
  const hasImage =
    (subpost.type === 'image' || subpost.type === 'text+image') && subpost.imageUrl

  if (!hasImage) {
    // Sem imagem, landscape degenera pra portrait (sem fallback exótico).
    return <PortraitLayout subpost={subpost} />
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Image
        src={subpost.imageUrl!}
        className="absolute inset-0 h-full w-full object-cover"
        aspect="auto"
      />
      {/* Gradient overlay bottom 96% opacity pra legibilidade do texto. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
        style={{
          background:
            'linear-gradient(to top, rgba(12, 12, 11, 0.96), rgba(12, 12, 11, 0))',
        }}
        aria-hidden="true"
      />
      {subpost.text && (
        <p className="absolute inset-x-4 bottom-4 whitespace-pre-wrap text-center font-mono text-[13px] leading-relaxed text-drift-text">
          {subpost.text}
        </p>
      )}
    </div>
  )
}

function TextLayout({ subpost }: { subpost: Subpost }) {
  // Decorative letter usa text como fonte. Função pura sanitiza Unicode
  // (NFKC + strip RTL/ZW/control) — manifesto §7 + Round 1 Barney #2.
  const letters = getDecorativeLetters(subpost.text)

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center p-6">
      <p className="z-10 max-w-prose whitespace-pre-wrap text-center font-mono text-[15px] leading-relaxed text-drift-text">
        {subpost.text ?? '(sem conteúdo de texto)'}
      </p>
      {/* Decorative letter — visual puro, screen reader pula. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 right-3 select-none font-display font-extrabold uppercase text-drift-border"
        style={{
          fontSize: '100px',
          letterSpacing: '-6px',
          opacity: 0.55,
          lineHeight: 1,
        }}
      >
        {letters}
      </span>
    </div>
  )
}

function EmptyContent() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-drift-muted">
      (sem conteúdo)
    </div>
  )
}
