// Design system PRIMITIVES conformance — LOCK_VIA_TEST que detecta
// regressões de uso de design-system primitives (DriftAlert, SlideUpOverlay,
// etc.). Source: Marshall HIMYM audit 2026-05-17.
//
// Diferente de design-system-conformance.test.ts (Tailwind color tokens),
// este foca em PRIMITIVES de UI (componentes React) que substituem
// padrões repetidos ad-hoc.
//
// Estratégia em 2 fases:
//   FASE OBSERVE (atual): tests rodam como `it.todo` listando violations
//     atuais congeladas em comentário. Não falha build.
//   FASE ENFORCE (PR por test, junto com fix): converter `it.todo` → `it()`
//     após audit Lily decidir migrar a view. Zero janela broken.
//
// Heurísticas testadas (com FP rate estimado):
//   1. `role="dialog"` sem import de UI/{SlideUpOverlay,FullPageCard,DialogHost}
//      — FP ~15% (UI/Image lightbox legítimo)
//   2. `fixed inset-0 z-` fora de src/components/UI/ — zero ambiguidade
//   3. banner inline pattern `border-l-[Npx] border-l-drift-{variant}`
//      fora de UI/DriftAlert.tsx — sinal de banner ad-hoc
//
// Whitelist via comentário `// design-system: ok reason=<text>` na mesma
// linha (mirror do pattern `// wcag-audit: ok reason=`).

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PRIMITIVE_WHITELIST = new Set([
  'src/components/UI/SlideUpOverlay.tsx',
  'src/components/UI/FullPageCard.tsx',
  'src/components/UI/DialogHost.tsx',
  'src/components/UI/Image.tsx', // lightbox — full-bleed black bg, design intencional
  'src/components/UI/SectionHeader.tsx',
  'src/components/UI/DriftCard.tsx',
  'src/components/UI/DriftAlert.tsx',
])

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (full.endsWith('.tsx')) acc.push(full.replace(/\\/g, '/'))
  }
  return acc
}

function fileImportsPrimitive(content: string, primitives: string[]): boolean {
  return primitives.some(
    (p) =>
      content.includes(`from '../UI/${p}'`) ||
      content.includes(`from './UI/${p}'`),
  )
}

/**
 * Allowlist explícita de views legacy que ainda usam overlay manual
 * (`fixed inset-0 z-*`) ao invés de SlideUpOverlay/FullPageCard primitive.
 *
 * Cada migration futura REMOVE 1 entry — ratchet força progresso. Adicionar
 * NOVA entry exige justificativa no PR review (não é trivial).
 *
 * Migrações concluídas (removidas):
 *   - OnboardingOverlay [7fa7280] → SlideUpOverlay com boost prop
 *   - ReplySheet [pending-commit] → SlideUpOverlay variant=bottom-sheet
 *     + dragToDismiss + dragHandleVisible (primitive extension)
 *
 * Migrações pendentes:
 */
const OVERLAY_LEGACY_ALLOWLIST = new Set([
  // ComposeOverlay sub-overlay interno (preview/abort) — refactor maior
  'src/components/Create/ComposeOverlay.tsx',
  // PostViewer ModalWrapper interno — refactor maior
  'src/components/Post/PostViewer.tsx',
  // ThreadView role="tree" + bg semi-transparent — exceção documentada
  'src/components/Post/ThreadView.tsx',
])

describe('Design system primitives — modal/overlay usage', () => {
  // FASE OBSERVE — violations restantes (post OnboardingOverlay migration):
  //   - src/components/Create/ComposeOverlay.tsx (sub-overlay interno)
  //   - src/components/Post/ReplySheet.tsx (bottom-sheet manual)
  //   - src/components/Post/PostViewer.tsx (ModalWrapper interno)
  //   - src/components/Post/ThreadView.tsx (overlay manual exceção docs)
  it.todo(
    '1. role="dialog" deve importar de SlideUpOverlay/FullPageCard/DialogHost',
  )

  // ENFORCE (Marshall Tier 1 #5 post-OnboardingOverlay migration 2026-05-17):
  // Detecta NOVAS violations. Allowlist contém 4 legacy aguardando migração
  // — cada migration remove 1 entry da allowlist (ratchet).
  it('2. fixed inset-0 z-* fora de UI/ é overlay manual — usar primitive (allowlist 4 legacy)', () => {
    const violations: string[] = []
    for (const file of walk('src/components')) {
      if (file.startsWith('src/components/UI/')) continue
      if (OVERLAY_LEGACY_ALLOWLIST.has(file)) continue
      const content = readFileSync(file, 'utf8')
      // Whitelist por comentário
      if (/(?:\/\/|\/\*)\s*design-system:\s*ok/.test(content)) continue
      // Strip comments antes do match
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      if (/className=["'][^"']*fixed\s+inset-0\s+z-/.test(stripped)) {
        violations.push(file)
      }
    }
    expect(
      violations,
      `\n${violations.join('\n')}\nFix: usar SlideUpOverlay/FullPageCard primitive em vez de overlay manual. Ou adicionar à OVERLAY_LEGACY_ALLOWLIST com justificativa no PR.`,
    ).toEqual([])
  })
})

describe('Design system primitives — DriftAlert (banners/notices)', () => {
  // ENFORCE imediato — 3 banners migrados nesta sessão:
  //   - DiscoverNudgeBanner, LensNudgeBanner, EditProfileCard ManifestoNotice
  // Pattern legacy `border-l-[3px] border-l-drift-accent2 bg-drift-surface/95`
  // não deve aparecer fora de UI/DriftAlert.tsx — sinal de banner ad-hoc.
  it('não usa pattern banner inline ad-hoc fora de UI/DriftAlert', () => {
    const violations: string[] = []
    for (const file of walk('src/components')) {
      if (PRIMITIVE_WHITELIST.has(file)) continue
      const content = readFileSync(file, 'utf8')
      // Pattern legacy: border-l-[Npx] border-l-drift-{accent2,warning,bury}
      // — typical bottom-toast notification antes da extração.
      if (
        /border-l-\[\d+px\]\s+border-l-drift-(accent2|warning|bury)/.test(
          content,
        )
      ) {
        // Whitelist: aceita `// design-system: ok` (JS) OU `{/* design-system: ok` (JSX block)
        if (/(?:\/\/|\/\*)\s*design-system:\s*ok/.test(content)) continue
        violations.push(file)
      }
    }
    expect(
      violations,
      `\n${violations.join('\n')}\nFix: usar <DriftAlert variant="info|warning|danger" /> primitive.`,
    ).toEqual([])
  })
})
