/**
 * dismissRule debounce — D16 Sprint N+3 Batch A.
 *
 * Source: D16 hardening 2026-05-21 — `dismissRule`/`dismissRules`
 * faziam db.get+db.run a cada call. Flood (XSS payload em loop, ou
 * bug de UI re-disparando handler) consumia I/O sem ganho.
 *
 * Fix: trailing-edge debounce 250ms. Múltiplas calls dentro da janela
 * coalescem em 1 flush — buffer dedup-ed (Set) acumula ruleIds, timer
 * único agendado por scheduleDismissFlush.
 *
 * Test strategy:
 *   - Mock `db` (sqlite worker) — capturar quantas vezes db.get/db.run
 *     foi chamado (proxy pra "quantos flushes aconteceram").
 *   - vi.useFakeTimers() pra controlar janela determinística.
 *   - Cenários: flood single rule, flood multi rules, calls fora da
 *     janela (devem flushar separadamente), erro propaga via Promise.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock db ANTES de importar capabilities — db.ts é importado top-level.
// vi.mock hoist NÃO permite top-level vars na factory; usamos vi.hoisted.
const { dbGet, dbRun } = vi.hoisted(() => ({
  dbGet: vi.fn<(sql: string, params?: unknown[]) => Promise<{ value: string } | undefined>>(),
  dbRun: vi.fn<(sql: string, params?: unknown[]) => Promise<void>>(),
}))

vi.mock('../src/lib/db', () => ({
  db: {
    get: dbGet,
    run: dbRun,
    exec: vi.fn(async () => []),
  },
}))

// Import só APÓS o mock — vitest hoist garante mock antes deste import.
import {
  dismissRule,
  dismissRules,
  __flushDismissForTests,
} from '../src/lib/capabilities'

describe('dismissRule debounce — D16 Sprint N+3', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    dbGet.mockClear()
    dbRun.mockClear()
    dbGet.mockResolvedValue({ value: '' })
    dbRun.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    // Limpa buffers pendentes entre testes (não vaza estado).
    vi.useRealTimers()
    await __flushDismissForTests().catch(() => undefined)
  })

  it('1 call → 1 flush após 250ms', async () => {
    const p = dismissRule('rule-a')
    expect(dbRun).not.toHaveBeenCalled() // ainda não passou o debounce

    await vi.advanceTimersByTimeAsync(250)
    await p

    expect(dbRun).toHaveBeenCalledTimes(1)
    expect(dbGet).toHaveBeenCalledTimes(1)
  })

  it('flood de 100 calls da mesma rule → 1 flush único', async () => {
    const promises: Promise<void>[] = []
    for (let i = 0; i < 100; i++) {
      promises.push(dismissRule('rule-spammed'))
    }
    expect(dbRun).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)
    await Promise.all(promises)

    // db.run chamado UMA vez — buffer Set dedupou os 100 IDs idênticos.
    expect(dbRun).toHaveBeenCalledTimes(1)
  })

  it('flood de calls com IDs diferentes → 1 flush, todos persistidos', async () => {
    const promises = [
      dismissRule('rule-a'),
      dismissRule('rule-b'),
      dismissRule('rule-c'),
      dismissRules(['rule-d', 'rule-e']),
    ]
    await vi.advanceTimersByTimeAsync(250)
    await Promise.all(promises)

    expect(dbRun).toHaveBeenCalledTimes(1)
    // payload é serialized; inspeciona args
    const runArgs = dbRun.mock.calls[0]
    expect(runArgs).toBeDefined()
    const serialized = String(runArgs?.[1]?.[1] ?? '')
    expect(serialized).toContain('rule-a')
    expect(serialized).toContain('rule-b')
    expect(serialized).toContain('rule-c')
    expect(serialized).toContain('rule-d')
    expect(serialized).toContain('rule-e')
  })

  it('2 calls separadas por >250ms → 2 flushes independentes', async () => {
    const p1 = dismissRule('rule-x')
    await vi.advanceTimersByTimeAsync(300)
    await p1
    expect(dbRun).toHaveBeenCalledTimes(1)

    const p2 = dismissRule('rule-y')
    await vi.advanceTimersByTimeAsync(300)
    await p2
    expect(dbRun).toHaveBeenCalledTimes(2)
  })

  it('cada call dentro da janela RESETA o timer (trailing edge)', async () => {
    const p1 = dismissRule('rule-a')

    await vi.advanceTimersByTimeAsync(200) // ainda não disparou
    expect(dbRun).not.toHaveBeenCalled()

    const p2 = dismissRule('rule-b') // re-agenda timer pra +250ms

    await vi.advanceTimersByTimeAsync(200) // total 400ms desde p1, mas só 200ms desde p2
    expect(dbRun).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60) // agora passou 260ms desde p2
    await Promise.all([p1, p2])
    expect(dbRun).toHaveBeenCalledTimes(1)
  })

  it('erro no db.run propaga via promise compartilhada', async () => {
    dbRun.mockRejectedValueOnce(new Error('disk full'))
    const p = dismissRule('rule-err')
    // Anexa handler ANTES do advanceTimers pra evitar unhandled rejection
    // ser flagged enquanto o timer dispara.
    const assertion = expect(p).rejects.toThrow('disk full')
    await vi.advanceTimersByTimeAsync(250)
    await assertion
  })
})
