/**
 * Conformance test — auto-rebroadcast on addRelay.
 *
 * Satoshi audit 2026-05-21 (`Docs/sessions/satoshi-redundancia-audit-2026-05-21.md`)
 * flagou gap: `rebroadcastToRelay` era 100% funcional, mas MANUAL — user
 * precisava clicar em Settings pra rodar. Promessa manifesto §16
 * (disponibilidade distribuída) só funciona se user souber clicar.
 *
 * Fix: hook em `relays.ts:addRelay()` dispara `rebroadcastToRelay(url, npub)`
 * async fire-and-forget quando relay novo é adicionado.
 *
 * Estes tests são source-grep — não executam o código, só validam que
 * o LOCK estrutural está no lugar. Conformance lock contra regressão.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const RELAYS_PATH = resolve(__dirname, '../src/lib/relays.ts')
const SOURCE = readFileSync(RELAYS_PATH, 'utf8')

describe('auto-rebroadcast on addRelay (Satoshi audit 2026-05-21)', () => {
  it('relays.ts faz import dinâmico de rebroadcastToRelay', () => {
    // Import lazy via Promise.all/import() pra evitar ciclo
    // (relays.ts ← identity.ts ← bootstrap.ts ← relays.ts).
    expect(SOURCE).toMatch(/import\(['"]\.\/rebroadcast['"]\)/)
    expect(SOURCE).toContain('rebroadcastToRelay')
  })

  it('addRelay dispara rebroadcast como fire-and-forget (void prefix)', () => {
    // `void scheduleRebroadcast(url)` — sem await, não bloqueia caller.
    expect(SOURCE).toMatch(/void\s+scheduleRebroadcast\s*\(/)
  })

  it('scheduleRebroadcast tem error handler (try/catch ou .catch)', () => {
    // Catch obrigatório — fire-and-forget que lança UnhandledPromiseRejection
    // mataria a app. Aceita ambos try/catch ou .catch().
    const hasTryCatch = /async function scheduleRebroadcast[\s\S]*?try\s*\{[\s\S]*?\}\s*catch/.test(
      SOURCE,
    )
    const hasDotCatch = /scheduleRebroadcast\([^)]*\)\.catch\(/.test(SOURCE)
    expect(hasTryCatch || hasDotCatch).toBe(true)
  })

  it('comentário Satoshi audit 2026-05-21 está presente como rastro do fix', () => {
    expect(SOURCE).toContain('Satoshi audit 2026-05-21')
  })

  it('idempotência: dispara apenas quando isNew (re-add do mesmo relay NÃO redispara)', () => {
    // Guard `isNew` previne spam em re-add — bate em INSERT...ON CONFLICT
    // que atualiza read/write mas NÃO deve disparar rebroadcast novamente.
    expect(SOURCE).toMatch(/isNew\s*&&/)
    // E o isNew vem de um lookup prévio na tabela relays_user.
    expect(SOURCE).toMatch(/const\s+isNew\s*=\s*!existing/)
  })

  it('não dispara rebroadcast se relay foi adicionado read-only (write=false)', () => {
    // Read-only relay não precisa receber re-broadcast (não usamos pra publish).
    expect(SOURCE).toMatch(/input\.write\s*!==\s*false/)
  })
})
