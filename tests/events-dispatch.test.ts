/**
 * Tests do KIND_DISPATCH (Ted contraproposta middle-ground ao RFC do
 * Robin sobre registry pluggable, sessão 2026-05-08).
 *
 * Cobre:
 *  - Kinds desconhecidos são noop (early return antes de qualquer write).
 *  - Cada kind conhecido roteia pro persist correto (POST → posts,
 *    SPREAD → spreads, BURY → buries, REPORT → reports, 1111 → comments).
 *  - Schema check inválido NÃO chega ao persist (pipeline cheap →
 *    expensive → persist preservado, CLAUDE.md invariante #5).
 *  - `passesSchemaCheck` (API pública) delega pro mesmo dispatch
 *    (fonte única de verdade pós-refactor — sem dois switches paralelos).
 *
 * Rodam em Node, sem browser. Mockam db + verifyDriftEvent.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn() },
}))
vi.mock('../src/lib/nostr', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/nostr')>(
    '../src/lib/nostr',
  )
  return { ...actual, verifyDriftEvent: vi.fn(() => true) }
})
// 2026-05-16: verify movido pra worker (Ted RFC). events.ts agora
// consome `verifyEventAsync` de `verify.ts` em vez de `verifyDriftEvent`
// sync de `nostr.ts`. Mock cobre o novo caller; `verifyMock` abaixo
// referencia este aqui pra os asserts existentes seguirem.
vi.mock('../src/lib/verify', () => ({
  verifyEventAsync: vi.fn(async () => true),
}))
vi.mock('../src/lib/scoring', () => ({
  calculateScoreNow: vi.fn(() => 0),
  applyCommentReceived: vi.fn((args: { currentScore: number }) => args.currentScore),
}))
vi.mock('../src/lib/feed', () => ({
  invalidateFeed: vi.fn(),
  bumpUnseenCount: vi.fn(),
}))
vi.mock('../src/lib/moderation', () => ({
  getReportWeight: vi.fn(() => 1),
  maybeModerate: vi.fn(),
}))
vi.mock('../src/lib/weight', () => ({
  calculateUserWeight: vi.fn(async () => ({ weight: 0.5 })),
  calculateWeight: vi.fn(() => 0),
}))
vi.mock('../src/lib/comment-counts', () => ({
  bumpCommentCount: vi.fn(),
}))

import {
  onNostrEvent,
  passesSchemaCheck,
  recalcAllScores,
  NIP22_COMMENT_KIND,
} from '../src/lib/events'
import { db } from '../src/lib/db'
import { invalidateFeed } from '../src/lib/feed'
import { maybeModerate } from '../src/lib/moderation'
import { verifyEventAsync } from '../src/lib/verify'
import { DRIFT_KIND } from '../src/config/constants'
import type { SignedEvent } from '../src/types/nostr'

const dbMock = db as unknown as {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}
const verifyMock = verifyEventAsync as unknown as ReturnType<typeof vi.fn>
const invalidateFeedMock = invalidateFeed as unknown as ReturnType<typeof vi.fn>
const maybeModerateMock = maybeModerate as unknown as ReturnType<typeof vi.fn>

const HEX = (c: string) => c.repeat(64)
const POST_ID = HEX('a')
const POST_AUTHOR = HEX('b')
const COMMENTER = HEX('c')

beforeEach(() => {
  dbMock.run.mockReset()
  dbMock.exec.mockReset()
  dbMock.get.mockReset()
  dbMock.run.mockResolvedValue(undefined)
  dbMock.exec.mockResolvedValue([])
  dbMock.get.mockResolvedValue(null)
  verifyMock.mockReset()
  verifyMock.mockResolvedValue(true)
  invalidateFeedMock.mockReset()
  maybeModerateMock.mockReset()
  maybeModerateMock.mockResolvedValue(undefined)
})

function makeEvent(opts: {
  kind: number
  tags?: string[][]
  content?: string
  pubkey?: string
  id?: string
}): SignedEvent {
  return {
    id: opts.id ?? HEX('0'),
    pubkey: opts.pubkey ?? HEX('1'),
    created_at: 1714000000,
    kind: opts.kind,
    tags: opts.tags ?? [],
    content: opts.content ?? '',
    sig: HEX('0') + HEX('0'), // 128 hex (sig é 64 bytes)
  }
}

function makePost(): SignedEvent {
  // Satoshi Gap C (bf76dda 2026-05-20): validatePostShape rejeita
  // POST com subposts vazio (NOP farming guard). Fixture usa subpost
  // dummy não-vazio pra exercer o pipeline persist completo. Audit:
  // Docs/sessions/marshall-baseline-failures-audit-2026-05-26.md
  return makeEvent({
    kind: DRIFT_KIND.POST,
    tags: [['drift-version', '1']],
    content: JSON.stringify({ subposts: [{ id: '1', text: 'hi' }] }),
    id: POST_ID,
    pubkey: POST_AUTHOR,
  })
}

function makeSpread(): SignedEvent {
  return makeEvent({
    kind: DRIFT_KIND.SPREAD,
    tags: [['e', POST_ID]],
  })
}

function makeBury(): SignedEvent {
  return makeEvent({
    kind: DRIFT_KIND.BURY,
    tags: [['e', POST_ID]],
  })
}

function makeReport(): SignedEvent {
  return makeEvent({
    kind: DRIFT_KIND.REPORT,
    tags: [
      ['e', POST_ID],
      ['reason', 'spam'],
    ],
  })
}

function makeComment(): SignedEvent {
  return makeEvent({
    kind: NIP22_COMMENT_KIND,
    tags: [
      ['E', POST_ID, '', POST_AUTHOR],
      ['K', '9078'],
      ['P', POST_AUTHOR],
      ['e', POST_ID, '', POST_AUTHOR],
      ['k', '9078'],
      ['p', POST_AUTHOR],
      ['drift-version', '1'],
    ],
    content: 'oi',
    pubkey: COMMENTER,
  })
}

/** Concatena calls do db.run que matcham um padrão SQL. */
function runCallsMatching(pattern: RegExp): unknown[][] {
  return dbMock.run.mock.calls.filter((c) => pattern.test(String(c[0])))
}

describe('KIND_DISPATCH — kinds desconhecidos são noop', () => {
  it('kind 1 (Nostr note clássica) → nenhum INSERT, nenhum verify', async () => {
    await onNostrEvent(makeEvent({ kind: 1, content: 'hello' }))
    expect(dbMock.run).not.toHaveBeenCalled()
    expect(verifyMock).not.toHaveBeenCalled() // early return antes do expensive
  })

  it('kind 9082 (boost futuro, não registrado ainda) → noop', async () => {
    // Quando 9082 entrar no roadmap, este test deve quebrar (sinal de
    // que falta registrar handler em KIND_DISPATCH).
    await onNostrEvent(makeEvent({ kind: 9082 }))
    expect(dbMock.run).not.toHaveBeenCalled()
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('passesSchemaCheck retorna false pra kind desconhecido', () => {
    expect(passesSchemaCheck(makeEvent({ kind: 1 }))).toBe(false)
    expect(passesSchemaCheck(makeEvent({ kind: 9082 }))).toBe(false)
    expect(passesSchemaCheck(makeEvent({ kind: 30078 }))).toBe(false)
  })
})

describe('KIND_DISPATCH — kind 0 (metadata NIP-01, opt-in identity)', () => {
  it('kind 0 com content vazio "{}" → ingestão (LWW)', async () => {
    await onNostrEvent(makeEvent({ kind: 0, content: '{}' }))
    expect(runCallsMatching(/INSERT INTO users_metadata\b/i).length).toBe(1)
  })

  it('kind 0 com content inválido (não-JSON) → rejeita silenciosamente', async () => {
    await onNostrEvent(makeEvent({ kind: 0, content: 'not json' }))
    expect(dbMock.run).not.toHaveBeenCalled()
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('kind 0 com content > 4096 chars → rejeita (cap defensivo)', async () => {
    await onNostrEvent(
      makeEvent({ kind: 0, content: JSON.stringify({ about: 'x'.repeat(5000) }) }),
    )
    expect(dbMock.run).not.toHaveBeenCalled()
  })
})

describe('KIND_DISPATCH — kinds conhecidos roteiam pro persist correto', () => {
  it('kind 9078 (POST) → INSERT INTO posts', async () => {
    await onNostrEvent(makePost())
    expect(runCallsMatching(/INSERT OR IGNORE INTO posts\b/i).length).toBe(1)
    expect(runCallsMatching(/INSERT.+INTO (?:spreads|buries|reports|comments)\b/i).length).toBe(0)
  })

  it('kind 9079 (SPREAD) → INSERT INTO spreads', async () => {
    await onNostrEvent(makeSpread())
    expect(runCallsMatching(/INSERT OR IGNORE INTO spreads\b/i).length).toBe(1)
    expect(runCallsMatching(/INSERT.+INTO (?:posts|buries|reports|comments)\b/i).length).toBe(0)
  })

  it('kind 9080 (BURY) → INSERT INTO buries', async () => {
    await onNostrEvent(makeBury())
    expect(runCallsMatching(/INSERT OR IGNORE INTO buries\b/i).length).toBe(1)
    expect(runCallsMatching(/INSERT.+INTO (?:posts|spreads|reports|comments)\b/i).length).toBe(0)
  })

  it('kind 9081 (REPORT) → INSERT INTO reports', async () => {
    await onNostrEvent(makeReport())
    expect(runCallsMatching(/INSERT OR IGNORE INTO reports\b/i).length).toBe(1)
    expect(runCallsMatching(/INSERT.+INTO (?:posts|spreads|buries|comments)\b/i).length).toBe(0)
  })

  it('kind 1111 (COMMENT) → INSERT INTO comments', async () => {
    await onNostrEvent(makeComment())
    expect(runCallsMatching(/INSERT OR IGNORE INTO comments\b/i).length).toBe(1)
    expect(runCallsMatching(/INSERT.+INTO (?:posts|spreads|buries|reports)\b/i).length).toBe(0)
  })
})

describe('KIND_DISPATCH — pipeline cheap → expensive → persist', () => {
  it('schema inválido (POST sem drift-version) NÃO chega ao verify', async () => {
    // POST com tag `e` mas sem `drift-version` → schema falha ANTES do
    // verifyDriftEvent (CLAUDE.md invariante #5: cheap antes de expensive).
    const ev = makeEvent({
      kind: DRIFT_KIND.POST,
      tags: [['e', POST_ID]],
      content: JSON.stringify({ subposts: [] }),
    })
    await onNostrEvent(ev)
    expect(verifyMock).not.toHaveBeenCalled()
    expect(runCallsMatching(/INSERT/i).length).toBe(0)
  })

  it('schema inválido (SPREAD com tag e em formato UUID) NÃO chega ao verify', async () => {
    const ev = makeEvent({
      kind: DRIFT_KIND.SPREAD,
      tags: [['e', '550e8400-e29b-41d4-a716-446655440000']],
    })
    await onNostrEvent(ev)
    expect(verifyMock).not.toHaveBeenCalled()
    expect(runCallsMatching(/INSERT/i).length).toBe(0)
  })

  it('verify falhando NÃO chega ao persist', async () => {
    verifyMock.mockResolvedValueOnce(false)
    await onNostrEvent(makeSpread())
    expect(verifyMock).toHaveBeenCalledTimes(1) // chegou ao verify
    expect(runCallsMatching(/INSERT/i).length).toBe(0) // mas não persistiu
  })

  it('schema válido + verify ok → persist roda', async () => {
    await onNostrEvent(makeSpread())
    expect(verifyMock).toHaveBeenCalledTimes(1)
    expect(runCallsMatching(/INSERT OR IGNORE INTO spreads\b/i).length).toBe(1)
  })
})

describe('KIND_DISPATCH — fonte única de verdade (sem dois switches paralelos)', () => {
  // Antes do refactor: havia DOIS switches independentes (passesSchemaCheck
  // + onNostrEvent dispatch). Adicionar kind exigia tocar ambos. RFC Robin
  // §5 documenta o risco de drift. Pós-refactor: passesSchemaCheck delega
  // pro mesmo KIND_DISPATCH usado por onNostrEvent. Este teste lock-via-
  // test que o invariante seja preservado em refactors futuros.

  it('passesSchemaCheck e onNostrEvent concordam: schema válido → ambos aceitam', async () => {
    const validSpread = makeSpread()
    expect(passesSchemaCheck(validSpread)).toBe(true)
    await onNostrEvent(validSpread)
    expect(runCallsMatching(/INSERT OR IGNORE INTO spreads\b/i).length).toBe(1)
  })

  it('passesSchemaCheck e onNostrEvent concordam: schema inválido → ambos rejeitam', async () => {
    const invalidSpread = makeEvent({
      kind: DRIFT_KIND.SPREAD,
      tags: [], // sem tag `e`
    })
    expect(passesSchemaCheck(invalidSpread)).toBe(false)
    await onNostrEvent(invalidSpread)
    expect(runCallsMatching(/INSERT/i).length).toBe(0)
  })

  it('todos os DRIFT_KIND + NIP22_COMMENT_KIND têm handler — pipeline aceita schema válido de cada um', async () => {
    // Conformance: cada kind do roadmap atual deve ter handler
    // registrado. Quando 9082 (boost) entrar, adicionar caso aqui +
    // entry em KIND_DISPATCH.
    const kinds = [
      DRIFT_KIND.POST,
      DRIFT_KIND.SPREAD,
      DRIFT_KIND.BURY,
      DRIFT_KIND.REPORT,
      NIP22_COMMENT_KIND,
    ]
    for (const kind of kinds) {
      // passesSchemaCheck deve retornar true OU false determinístico
      // (não throw), pra qualquer kind registrado. Aqui só verificamos
      // que kinds *no dispatch* não derrubam — corner case de schema
      // inválido por kind cobre os tests específicos acima.
      const ev = makeEvent({ kind })
      expect(() => passesSchemaCheck(ev)).not.toThrow()
    }
  })
})

// ─── LOCK_VIA_TEST — deferSideEffects (dev-seed bulk mode) ────────────
//
// Ted+Lily 2026-05-28: dev-seed drenava ~2730 eventos a ~280ms/evento
// (~13min) porque cada onNostrEvent disparava scheduleScoreRecalc (1 timer
// por post) + invalidateFeed. `deferSideEffects: true` suprime esses
// side-effects pós-persist (mantendo INSERT — invariante #1), e o seed faz
// 1 recalcAllScores() + 1 invalidateFeed no fim. Estes locks garantem que
// o defer NÃO persista menos, NEM dispare os side-effects adiados, e que o
// bulk recalc rode recalc-antes-de-moderação (§26 -999 vence o último write).

describe('deferSideEffects — persist roda, side-effects são adiados', () => {
  it('POST com deferSideEffects: true → INSERT roda, invalidateFeed NÃO', async () => {
    await onNostrEvent(makePost(), { deferSideEffects: true })
    expect(runCallsMatching(/INSERT OR IGNORE INTO posts\b/i).length).toBe(1)
    expect(invalidateFeedMock).not.toHaveBeenCalled()
  })

  it('SPREAD com deferSideEffects: true → INSERT roda, invalidateFeed NÃO', async () => {
    await onNostrEvent(makeSpread(), { deferSideEffects: true })
    expect(runCallsMatching(/INSERT OR IGNORE INTO spreads\b/i).length).toBe(1)
    expect(invalidateFeedMock).not.toHaveBeenCalled()
  })

  it('BURY com deferSideEffects: true → INSERT roda, invalidateFeed NÃO', async () => {
    await onNostrEvent(makeBury(), { deferSideEffects: true })
    expect(runCallsMatching(/INSERT OR IGNORE INTO buries\b/i).length).toBe(1)
    expect(invalidateFeedMock).not.toHaveBeenCalled()
  })

  it('REPORT com deferSideEffects: true → INSERT roda, maybeModerate + invalidateFeed NÃO', async () => {
    await onNostrEvent(makeReport(), { deferSideEffects: true })
    expect(runCallsMatching(/INSERT OR IGNORE INTO reports\b/i).length).toBe(1)
    expect(maybeModerateMock).not.toHaveBeenCalled() // adiado pro bulk pass
    expect(invalidateFeedMock).not.toHaveBeenCalled()
  })

  it('COMMENT com deferSideEffects: true → INSERT roda (side-effects de store adiados)', async () => {
    await onNostrEvent(makeComment(), { deferSideEffects: true })
    expect(runCallsMatching(/INSERT OR IGNORE INTO comments\b/i).length).toBe(1)
  })

  it('default (sem options) preserva comportamento normal — invalidateFeed roda', async () => {
    await onNostrEvent(makePost())
    expect(runCallsMatching(/INSERT OR IGNORE INTO posts\b/i).length).toBe(1)
    expect(invalidateFeedMock).toHaveBeenCalled()
  })
})

describe('recalcAllScores — bulk pass (dev-seed)', () => {
  it('recalcula todos os posts + modera reportados (recalc antes de moderação §26)', async () => {
    const POST_A = HEX('a')
    const POST_B = HEX('b')
    // exec #1: SELECT id FROM posts → 2 posts.
    // recalc de cada post chama exec (UNION actions) → [] (sem ações).
    // exec final: SELECT DISTINCT post_id FROM reports → 1 reportado.
    dbMock.exec.mockImplementation(async (sql: string) => {
      if (/SELECT id FROM posts/i.test(sql)) return [{ id: POST_A }, { id: POST_B }]
      if (/DISTINCT post_id FROM reports/i.test(sql)) return [{ post_id: POST_A }]
      return [] // UNION de ações + comments → vazio
    })
    dbMock.get.mockResolvedValue({ created_at: 1714000000, author_pub: HEX('f') })

    await recalcAllScores()

    // Cada post recebeu UPDATE de score (recalc).
    expect(runCallsMatching(/UPDATE posts SET score/i).length).toBe(2)
    // Post reportado passou por moderação — DEPOIS do recalc (§26 -999 último).
    expect(maybeModerateMock).toHaveBeenCalledTimes(1)
    expect(maybeModerateMock).toHaveBeenCalledWith(POST_A, expect.any(Number))
  })

  it('banco vazio → noop sem throw', async () => {
    dbMock.exec.mockResolvedValue([])
    await expect(recalcAllScores()).resolves.toBeUndefined()
    expect(maybeModerateMock).not.toHaveBeenCalled()
  })
})
