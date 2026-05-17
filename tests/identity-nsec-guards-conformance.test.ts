// Identity nsec security guards — manifesto §8 LOCK_VIA_TEST.
//
// Source: Barney HIMYM audit 2026-05-17 — §8 ("nsec NUNCA persiste em
// claro") está VIOLADO em prod sem guards porque copy expõe o nsec ao
// clipboard do sistema (Win+V history, iCloud Universal Clipboard,
// 3rd-party clipboard managers).
//
// Estes testes travam que IdentityPanel.tsx mantém os guards:
//   1. Auto-clear clipboard com TTL (writeText('') após N segundos)
//   2. Auto-hide reveal após M segundos sem interação
//   3. Warning visível ANTES do botão copy
//   4. Download/QR promovidos visualmente (primary > copy)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PANEL = readFileSync('src/components/Identity/IdentityPanel.tsx', 'utf8')

describe('IdentityPanel — nsec security guards (manifesto §8)', () => {
  it('define TTLs explícitos pra clipboard clear e reveal auto-hide', () => {
    expect(PANEL).toMatch(/NSEC_CLIPBOARD_TTL_MS\s*=\s*\d+/)
    expect(PANEL).toMatch(/NSEC_REVEAL_TTL_MS\s*=\s*\d+/)
  })

  it('TTLs em ranges sãos (clipboard ≤60s, reveal ≤120s)', () => {
    // Numeric literals JS aceitam _ separator (30_000); strip antes de parsear.
    const cb = PANEL.match(/NSEC_CLIPBOARD_TTL_MS\s*=\s*([\d_]+)/)
    const rv = PANEL.match(/NSEC_REVEAL_TTL_MS\s*=\s*([\d_]+)/)
    expect(cb).not.toBeNull()
    expect(rv).not.toBeNull()
    const cbMs = Number(cb![1].replace(/_/g, ''))
    const rvMs = Number(rv![1].replace(/_/g, ''))
    // Suficientemente longo pra UX (mín 10s) mas curto contra leak (máx)
    expect(cbMs).toBeGreaterThanOrEqual(10_000)
    expect(cbMs).toBeLessThanOrEqual(60_000)
    expect(rvMs).toBeGreaterThanOrEqual(30_000)
    expect(rvMs).toBeLessThanOrEqual(120_000)
  })

  it('chama navigator.clipboard.writeText("") pra limpar clipboard', () => {
    // Pode aparecer com aspas duplas ou simples
    expect(PANEL).toMatch(/navigator\.clipboard\.writeText\(\s*['"]{2}\s*\)/)
  })

  it('warning Barney §8 visível com role="alert" mencionando clipboard/Win\\+V/iCloud', () => {
    // role="alert" presente no bloco de warning
    expect(PANEL).toMatch(/role=["']alert["']/)
    // Menciona vetores específicos de exposição (case-insensitive)
    expect(PANEL.toLowerCase()).toMatch(/win\+v|clipboard|icloud/)
  })

  it('texto user-facing menciona pelo menos 2 vetores de exposição', () => {
    const lower = PANEL.toLowerCase()
    const vectors = ['win+v', 'icloud', 'clipboard', 'gerenciador', 'extensão']
    const hits = vectors.filter((v) => lower.includes(v))
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })

  it('botão download tem label "recomendado" (promoção visual primary)', () => {
    expect(PANEL).toMatch(/recomendado/)
  })

  it('botão copy tem label que sinaliza tradeoff (não é CTA neutro)', () => {
    // "copiar mesmo assim" ou similar — não apenas "copiar nsec" puro
    expect(PANEL.toLowerCase()).toMatch(/mesmo assim|apesar do risco/)
  })

  it('countdown visível no botão copy após cópia (clipboardTtlMs em ms→s)', () => {
    expect(PANEL).toMatch(/clipboardTtlMs/)
    expect(PANEL).toMatch(/limpa em.*\$\{?.*clipboardTtlMs/)
  })
})
