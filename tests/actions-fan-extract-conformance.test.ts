/**
 * ActionsFan extract conformance — LOCK_VIA_TEST.
 *
 * Source: Sprint N+2 P1.5 (Lily) — extrair `<ActionsFan>` primitive
 * de PostViewer.tsx (~120 LoC inline → arquivo dedicado).
 *
 * Cobre:
 *  1. PostViewer NÃO declara mais inline `function ActionsFan`
 *  2. ActionsFan.tsx existe + exporta default + named FanIcon
 *  3. PostViewer importa o component (não duplica lógica)
 *  4. Bit-exact behavior: o component preserva os elementos visuais
 *     que distinguem a UI (container glass, separator destrutivo,
 *     stagger animation, top:72px, data-no-longpress, role="group")
 *  5. Lógica pura (`buildFanItems`) continua sendo importada de
 *     `lib/actions-fan` — não foi reimplementada inline
 *
 * Marshall lock: extract sem conformance é regressão esperando
 * acontecer (alguém reverte por engano, ninguém percebe).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const POST_VIEWER_FILE = 'src/components/Post/PostViewer.tsx'
const ACTIONS_FAN_FILE = 'src/components/Post/ActionsFan.tsx'

const POST_VIEWER_SRC = readFileSync(POST_VIEWER_FILE, 'utf8')
const ACTIONS_FAN_SRC = existsSync(ACTIONS_FAN_FILE)
  ? readFileSync(ACTIONS_FAN_FILE, 'utf8')
  : ''

describe('ActionsFan extract — file structure', () => {
  it('ActionsFan.tsx existe', () => {
    expect(existsSync(ACTIONS_FAN_FILE)).toBe(true)
  })

  it('ActionsFan.tsx exporta default function', () => {
    expect(ACTIONS_FAN_SRC).toMatch(
      /export\s+default\s+function\s+ActionsFan\b/,
    )
  })

  it('ActionsFan.tsx co-exporta FanIcon (compartilhado com ModerationModal)', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/export\s+function\s+FanIcon\b/)
  })

  it('ActionsFan.tsx exporta ActionsFanProps interface', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/export\s+interface\s+ActionsFanProps\b/)
  })
})

describe('PostViewer — inline ActionsFan removido', () => {
  it('NÃO declara `function ActionsFan` inline', () => {
    expect(POST_VIEWER_SRC).not.toMatch(/^function\s+ActionsFan\b/m)
  })

  it('NÃO declara `function FanIcon` inline (movido p/ ActionsFan.tsx)', () => {
    expect(POST_VIEWER_SRC).not.toMatch(/^function\s+FanIcon\b/m)
  })

  it('importa ActionsFan default + FanIcon named do novo módulo', () => {
    expect(POST_VIEWER_SRC).toMatch(
      /import\s+ActionsFan\s*,\s*\{\s*FanIcon\s*\}\s+from\s+['"]\.\/ActionsFan['"]/,
    )
  })

  it('NÃO importa mais `buildFanItems` / `FanItem` direto de lib/actions-fan', () => {
    // Lógica de quais items aparecem agora é encapsulada dentro do
    // component — PostViewer não precisa saber.
    expect(POST_VIEWER_SRC).not.toMatch(
      /import\s+\{[^}]*buildFanItems[^}]*\}\s+from\s+['"][^'"]*actions-fan['"]/,
    )
  })

  it('renderiza `<ActionsFan ...>` no JSX (call site preservado)', () => {
    expect(POST_VIEWER_SRC).toMatch(/<ActionsFan\b/)
  })
})

describe('ActionsFan — lógica pura preservada', () => {
  it('importa `buildFanItems` de lib/actions-fan (não reimplementa)', () => {
    expect(ACTIONS_FAN_SRC).toMatch(
      /from\s+['"]\.\.\/\.\.\/lib\/actions-fan['"]/,
    )
    expect(ACTIONS_FAN_SRC).toMatch(/\bbuildFanItems\b/)
  })

  it('importa FanItem type de lib/actions-fan', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/\btype\s+FanItem\b/)
  })
})

describe('ActionsFan — bit-exact behavior markers', () => {
  it('preserva container glass card (rounded-2xl + border-drift-border + bg-drift-surface)', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/rounded-2xl/)
    expect(ACTIONS_FAN_SRC).toMatch(/border-drift-border/)
    expect(ACTIONS_FAN_SRC).toMatch(/bg-drift-surface/)
  })

  it('preserva separator destrutivo (border-t border-drift-bury/30)', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/border-t\s+border-drift-bury\/30/)
  })

  it('preserva top:72px (12px gap do header — user feedback 2026-05-18)', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/top:\s*`?72px`?/)
  })

  it('preserva data-no-longpress="true" (opt-out do long-press 5s)', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/data-no-longpress="true"/)
  })

  it('preserva role="group" + aria-label="ações do post"', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/role="group"/)
    expect(ACTIONS_FAN_SRC).toMatch(/aria-label="ações do post"/)
  })

  it('preserva stagger animation (delay: i * 0.035)', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/delay:\s*i\s*\*\s*0\.035/)
  })

  it('preserva separação neutralItems vs destructiveItems por key "moderar"', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/it\.key\s*!==\s*['"]moderar['"]/)
    expect(ACTIONS_FAN_SRC).toMatch(/it\.key\s*===\s*['"]moderar['"]/)
  })

  it('preserva gating de labels via menu_detail_show_action_labels', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/menu_detail_show_action_labels/)
  })

  it('preserva FanIcon size=22 strokeWidth=2 (V11.8 — ícones grossos)', () => {
    // Pelo menos uma ocorrência (neutral + destructive ambos usam size 22).
    expect(ACTIONS_FAN_SRC).toMatch(/<FanIcon\s+icon=\{item\.icon\}\s+size=\{22\}\s+strokeWidth=\{2\}/)
  })

  it('preserva stopPropagation no onClick (não dispara swipe parent)', () => {
    expect(ACTIONS_FAN_SRC).toMatch(/e\.stopPropagation\(\)/)
  })
})

describe('ActionsFan — D4 visibility hardening (Sprint N+3 Batch A)', () => {
  // Source: D4 issue 2026-05-21 — drop-shadow/alpha insuficiente em
  // backgrounds claros / fotos brilhantes. Reforço requer contraste
  // WCAG AA (≥4.5:1) entre container e qualquer bg via combinação
  // shadow + ring + border.

  // Strip docstring/comments antes de grep — docstrings históricos mencionam
  // as classes antigas (shadow-lg, bg-drift-surface/85) por contexto.
  const FAN_CODE_ONLY = ACTIONS_FAN_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
    /^\s*\/\/.*$/gm,
    '',
  )

  it('usa shadow-2xl (não shadow-lg) — drop shadow forte sobre foto', () => {
    expect(FAN_CODE_ONLY).toMatch(/\bshadow-2xl\b/)
    // Hard fail se alguém reverter pra shadow-lg no JSX (não no docstring)
    expect(FAN_CODE_ONLY).not.toMatch(/\bshadow-lg\b/)
  })

  it('container tem ring-1 ring-black/10 (segunda borda externa anti-bg-claro)', () => {
    expect(FAN_CODE_ONLY).toMatch(/\bring-1\b/)
    expect(FAN_CODE_ONLY).toMatch(/\bring-black\/10\b/)
  })

  it('bg-drift-surface SOLID — sem alpha modifier no JSX (preserva contraste WCAG)', () => {
    // /85 ou /90 quebraria contraste em bg branco/foto clara — preferimos
    // backdrop-blur via container chrome (não aplicado aqui) ao invés de
    // alpha translúcido que comprime contraste.
    expect(FAN_CODE_ONLY).not.toMatch(/bg-drift-surface\/(?:5\d|6\d|7\d|8\d|9\d)\b/)
  })
})

describe('ActionsFan — props contract preserved', () => {
  const REQUIRED_PROPS = [
    'visible',
    'isMine',
    'pinned',
    'isFollowing',
    'currentHasImage',
    'onPinToggle',
    'onFollowToggle',
    'onMute',
    'onSharePost',
    'onShareImage',
    'onOpenModeration',
  ] as const

  it.each(REQUIRED_PROPS)('declara prop `%s` em ActionsFanProps', (prop) => {
    // Match either `prop:` or `prop?:` dentro da interface
    const re = new RegExp(`\\b${prop}\\??:\\s*`)
    expect(ACTIONS_FAN_SRC).toMatch(re)
  })
})
