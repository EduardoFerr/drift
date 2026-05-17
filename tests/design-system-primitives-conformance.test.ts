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

describe('Design system primitives — modal/overlay usage', () => {
  // FASE OBSERVE — violations atuais (Lily audit 2026-05-17):
  //   - src/components/Create/ComposeOverlay.tsx (sub-overlay interno)
  //   - src/components/Onboarding/OnboardingOverlay.tsx (overlay shell)
  //   - src/components/Post/ReplySheet.tsx (bottom-sheet manual)
  //   - src/components/Post/PostViewer.tsx (ModalWrapper interno)
  //   - src/components/Post/ThreadView.tsx (overlay manual)
  it.todo(
    '1. role="dialog" deve importar de SlideUpOverlay/FullPageCard/DialogHost',
  )

  // FASE OBSERVE — violations atuais: mesmas 5 views acima
  it.todo(
    '2. fixed inset-0 z-* fora de UI/ é overlay manual — usar primitive',
  )
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
