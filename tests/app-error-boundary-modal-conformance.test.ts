// AppErrorBoundary custom modal conformance — LOCK_VIA_TEST.
//
// Source: Barney dead-UX audit 2026-05-23 §5.1 (P0 threat). User em
// estado de erro NÃO pode topar com `window.confirm` nativo num fluxo
// destrutivo (apaga IndexedDB + OPFS = perde nsec se não tem backup).
//
// Test garante:
//  1. AppErrorBoundary NÃO usa `window.confirm` no path destrutivo
//  2. Modal custom renderiza com role=alertdialog + aria-modal +
//     aria-labelledby + aria-describedby
//  3. CTA primário = "EXPORTAR NSEC PRIMEIRO"-equivalente
//     (border drift-accent), CTA destrutivo = secundário (border
//     drift-border / muted)
//  4. As 3 frases-warning do manifesto §3 estão presentes
//  5. Backdrop opaco (bg-drift-bg, sem /opacity ou /N suffix)
//  6. Boundary não depende de Zustand/Framer/dialog-host (mountable
//     antes dos providers)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FILE = 'src/components/UI/AppErrorBoundary.tsx'

describe('AppErrorBoundary custom modal — B-UX-3 P0 threat fix', () => {
  const src = readFileSync(FILE, 'utf8')

  it('NÃO chama window.confirm em nenhum lugar', () => {
    expect(src).not.toMatch(/window\.confirm\s*\(/)
    expect(src).not.toMatch(/\bconfirm\s*\(\s*['"`]/)
  })

  it('renderiza modal com role=alertdialog + aria-modal', () => {
    expect(src).toMatch(/role=["']alertdialog["']/)
    expect(src).toMatch(/aria-modal=["']true["']/)
  })

  it('modal tem aria-labelledby + aria-describedby vinculados a ids', () => {
    const labelledBy = src.match(/aria-labelledby=["']([^"']+)["']/)
    const describedBy = src.match(/aria-describedby=["']([^"']+)["']/)
    expect(labelledBy).not.toBeNull()
    expect(describedBy).not.toBeNull()
    // IDs referenciados precisam existir no JSX
    if (labelledBy) expect(src).toMatch(new RegExp(`id=["']${labelledBy[1]}["']`))
    if (describedBy) expect(src).toMatch(new RegExp(`id=["']${describedBy[1]}["']`))
  })

  it('contém as 3 frases-warning do manifesto §3', () => {
    expect(src).toMatch(/apaga sua identidade Drift local/i)
    expect(src).toMatch(/você perde a conta/i)
    expect(src).toMatch(/Manifesto §3.*dispositivo descartável.*identidade não/i)
  })

  it('backdrop opaco — bg-drift-bg sem /opacity suffix', () => {
    // Match modal container line(s) — devem usar bg-drift-bg puro
    // (não bg-drift-bg/N nem bg-black/M)
    const modalBackdrop = src.match(/fixed inset-0[^"`]*bg-drift-bg(?!\/)/)
    expect(
      modalBackdrop,
      'backdrop precisa ser bg-drift-bg opaco (sem /opacity)',
    ).not.toBeNull()
  })

  it('botão "voltar (não apagar)" é CTA primário (border-drift-accent)', () => {
    // Captura bloco do botão "voltar" e checa border-drift-accent
    const voltarBtn = src.match(
      /onClick=\{this\.closeWipeModal\}[^>]*className=["']([^"']+)["']/,
    )
    expect(voltarBtn).not.toBeNull()
    if (voltarBtn) {
      expect(voltarBtn[1]).toMatch(/border-drift-accent\b/)
    }
  })

  it('botão "apagar tudo mesmo assim" é secundário (border-drift-border)', () => {
    const apagarBtn = src.match(
      /onClick=\{this\.proceedToFinal\}[^>]*className=["']([^"']+)["']/,
    )
    expect(apagarBtn).not.toBeNull()
    if (apagarBtn) {
      // Secundário: NÃO usa border-drift-accent puro como border principal
      expect(apagarBtn[1]).toMatch(/border-drift-border\b/)
      expect(apagarBtn[1]).not.toMatch(/\bborder-drift-accent\b/)
    }
  })

  it('NÃO importa Zustand / Framer Motion / dialog-host (standalone pre-provider)', () => {
    expect(src).not.toMatch(/from\s+['"]zustand['"]/)
    expect(src).not.toMatch(/from\s+['"]framer-motion['"]/)
    expect(src).not.toMatch(/from\s+['"][^'"]*\bdialog['"]/)
    expect(src).not.toMatch(/from\s+['"][^'"]*DialogHost['"]/)
  })

  it('exportIdentity é dinamicamente importado (defensivo — db pode estar quebrado)', () => {
    // Import dinâmico (await import) evita load-time crash se identity.ts
    // chain quebrar. Static import top-level traria SQLite eager.
    expect(src).toMatch(/await\s+import\(\s*['"][^'"]*identity['"]/)
    // E NÃO há import estático de identity no topo
    expect(src).not.toMatch(/^import[^;]+from\s+['"][^'"]*\/identity['"]/m)
  })

  it('mostra fallback quando export do nsec falha', () => {
    expect(src).toMatch(/exportFailed/)
    expect(src).toMatch(/perde a identidade permanentemente|irrecuperáve|FALHOU/i)
  })
})
