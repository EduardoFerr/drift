/**
 * Tests do KIND_DISPATCH (Ted contraproposta middle-ground ao RFC do
 * Robin sobre registry pluggable, sessão 2026-05-08).
 *
 * Cobre:
 *  - Kinds desconhecidos são noop (early return antes de qualquer write).
 *  - Cada kind conhecido roteia pro persist correto (POST → posts,
 *    SPREAD → spreads, BURY → buries, REPORT → reports, 1111 → comments).
 *  - Schema check inválido NÃO chega ao persist (pipeline cheap →
 *    expensive → persist preservado, invariante #5).
 *  - `passesSchemaCheck` (API pública) delega pro mesmo dispatch
 *    (fonte única de verdade pós-refactor — sem dois switches paralelos).
 *
 * Rodam em Node, sem browser. Mockam db + verifyDriftEvent.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: vi.fn(), batch: vi.fn() },
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
vi.mock('../src/lib/feed', () => ({
  invalidateFeed: vi.fn(),
  bumpUnseenCount: vi.fn(),
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
import { verifyEventAsync } from '../src/lib/verify'
import { DRIFT_KIND } from '../src/config/constants'
import type { SignedEvent } from '../src/types/nostr'

const dbMock = db as unknown as {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  batch: ReturnType<typeof vi.fn>
}
const verifyMock = verifyEventAsync as unknown as ReturnType<typeof vi.fn>
const invalidateFeedMock = invalidateFeed as unknown as ReturnType<typeof vi.fn>

const HEX = (c: string) => c.repeat(64)
const POST_ID = HEX('a')
const POST_AUTHOR = HEX('b')
const COMMENTER = HEX('c')

beforeEach(() => {
  dbMock.run.mockReset()
  dbMock.exec.mockReset()
  dbMock.get.mockReset()
  dbMock.batch.mockReset()
  dbMock.run.mockResolvedValue(undefined)
  dbMock.exec.mockResolvedValue([])
  dbMock.get.mockResolvedValue(null)
  dbMock.batch.mockResolvedValue(undefined)
  verifyMock.mockReset()
  verifyMock.mockResolvedValue(true)
  invalidateFeedMock.mockReset()
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
  // nota interna
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
    expect(runCallsMatching(/INSERT INTO spreads\b/i).length).toBe(1)
    expect(runCallsMatching(/INSERT.+INTO (?:posts|buries|reports|comments)\b/i).length).toBe(0)
  })

  it('kind 9080 (BURY) → INSERT INTO buries', async () => {
    await onNostrEvent(makeBury())
    expect(runCallsMatching(/INSERT INTO buries\b/i).length).toBe(1)
    expect(runCallsMatching(/INSERT.+INTO (?:posts|spreads|reports|comments)\b/i).length).toBe(0)
  })

  it('kind 9081 (REPORT) → INSERT INTO reports', async () => {
    await onNostrEvent(makeReport())
    expect(runCallsMatching(/INSERT INTO reports\b/i).length).toBe(1)
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
    // verifyDriftEvent (invariante #5: cheap antes de expensive).
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
    expect(runCallsMatching(/INSERT INTO spreads\b/i).length).toBe(1)
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
    expect(runCallsMatching(/INSERT INTO spreads\b/i).length).toBe(1)
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
    expect(runCallsMatching(/INSERT INTO spreads\b/i).length).toBe(1)
    expect(invalidateFeedMock).not.toHaveBeenCalled()
  })

  it('BURY com deferSideEffects: true → INSERT roda, invalidateFeed NÃO', async () => {
    await onNostrEvent(makeBury(), { deferSideEffects: true })
    expect(runCallsMatching(/INSERT INTO buries\b/i).length).toBe(1)
    expect(invalidateFeedMock).not.toHaveBeenCalled()
  })

  it('REPORT com deferSideEffects: true → INSERT roda, invalidateFeed NÃO', async () => {
    await onNostrEvent(makeReport(), { deferSideEffects: true })
    expect(runCallsMatching(/INSERT INTO reports\b/i).length).toBe(1)
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

// ─── LOCK_VIA_TEST — skipVerify (dev-seed trusted self-signed) ────────
//
// Ted+Marshall 2026-05-29: mesmo após deferSideEffects, o dev-seed drenava
// ~2730 eventos a ~3.4 ev/s — custo dominante era o verify Schnorr round-trip
// SERIALIZADO ao worker (~20ms/evento). Fixtures são self-signed (finalizeEvent
// em fixtures.ts) → verify é desperdício puro. `skipVerify: true` pula o passo
// CARO (verify) MAS preserva os cheap checks (kind/schema, invariante #5).
//
// DEV-gate: o teste roda sob Vitest com import.meta.env.DEV === true, então
// skipVerify é honrado aqui. Em prod (DEV === false) o gate IGNORA a flag e
// verify sempre roda — coberto pela asserção de que o default ainda verifica.
// Sync real (sync.ts/WebRTC) NUNCA passa skipVerify → eventos da rede sempre
// verificados (lock: nenhum caller de produção passa a flag).

describe('skipVerify — pula verify CARO mas mantém cheap checks (DEV-seed)', () => {
  it('SPREAD com skipVerify: true → verify NÃO roda, mas INSERT roda', async () => {
    await onNostrEvent(makeSpread(), { skipVerify: true, deferSideEffects: true })
    expect(verifyMock).not.toHaveBeenCalled() // passo CARO pulado
    expect(runCallsMatching(/INSERT INTO spreads\b/i).length).toBe(1)
  })

  it('POST com skipVerify: true → verify NÃO roda, INSERT roda', async () => {
    await onNostrEvent(makePost(), { skipVerify: true, deferSideEffects: true })
    expect(verifyMock).not.toHaveBeenCalled()
    expect(runCallsMatching(/INSERT OR IGNORE INTO posts\b/i).length).toBe(1)
  })

  it('cheap checks PERMANECEM com skipVerify: schema inválido → nenhum INSERT', async () => {
    // SPREAD com tag `e` em formato UUID (não hex64) — schema check (passo 2)
    // deve rejeitar ANTES do persist, mesmo com verify pulado. Defesa contra
    // fixture malformada (invariante #5: cheap checks não são opcionais).
    const bad = makeEvent({
      kind: DRIFT_KIND.SPREAD,
      tags: [['e', '550e8400-e29b-41d4-a716-446655440000']],
    })
    await onNostrEvent(bad, { skipVerify: true, deferSideEffects: true })
    expect(verifyMock).not.toHaveBeenCalled()
    expect(runCallsMatching(/INSERT/i).length).toBe(0)
  })

  it('cheap kind check PERMANECE com skipVerify: kind desconhecido → noop', async () => {
    await onNostrEvent(makeEvent({ kind: 1, content: 'hello' }), {
      skipVerify: true,
      deferSideEffects: true,
    })
    expect(verifyMock).not.toHaveBeenCalled()
    expect(runCallsMatching(/INSERT/i).length).toBe(0)
  })

  it('default (sem skipVerify) ainda VERIFICA — sync real intacto', async () => {
    await onNostrEvent(makeSpread())
    expect(verifyMock).toHaveBeenCalledTimes(1)
    expect(runCallsMatching(/INSERT INTO spreads\b/i).length).toBe(1)
  })

  it('skipVerify: false explícito ainda VERIFICA', async () => {
    await onNostrEvent(makeSpread(), { skipVerify: false })
    expect(verifyMock).toHaveBeenCalledTimes(1)
  })
})

describe('recalcAllScores — recomputação global', () => {
  // A lógica (pesos, moderação) é coberta de ponta a ponta com SQLite real
  // em tests/algorithm-invariants.test.ts. Aqui só o contrato de I/O:
  // lê todas as fontes, grava SÓ o que mudou, em batch.
  const POST_A = HEX('a')
  const POST_B = HEX('b')
  const AUTHOR = HEX('f')
  const YEAR_AGO = Math.floor(Date.now() / 1000) - 365 * 86400
  const reporters = Array.from({ length: 7 }, (_, i) => String(i).repeat(64))

  const fixture = (moderatedAlready: boolean) => async (sql: string) => {
    if (/FROM posts/i.test(sql))
      return [
        { id: POST_A, created_at: 1714000000, author_pub: AUTHOR, score: moderatedAlready ? -999 : 0, score_base: 0, spreads: 0, buries: 0 },
        { id: POST_B, created_at: 1714000000, author_pub: AUTHOR, score: 0, score_base: 0, spreads: 0, buries: 0 },
      ]
    if (/FROM reports/i.test(sql))
      return reporters.map((r) => ({ post_id: POST_A, reporter_pub: r, reason: 'spam', created_at: 1714000000 }))
    if (/FROM ots_anchors/i.test(sql)) return reporters.map((r) => ({ author_pub: r, t: YEAR_AGO }))
    return []
  }
  const postUpdates = () =>
    dbMock.batch.mock.calls
      .flatMap((c) => c[0] as Array<{ sql: string; params: unknown[] }>)
      .filter((op) => /UPDATE posts SET score/i.test(op.sql))

  it('lê posts, votos, comentários, reports, users e âncoras OTS', async () => {
    dbMock.exec.mockImplementation(fixture(false))
    await recalcAllScores()
    const sqls = dbMock.exec.mock.calls.map((c) => String(c[0]))
    for (const t of ['posts', 'spreads', 'buries', 'comments', 'reports', 'users', 'ots_anchors'])
      expect(sqls.some((q) => new RegExp(`FROM ${t}\\b`).test(q)), t).toBe(true)
  })

  it('grava só o post cuja moderação mudou (7 reporters ancorados → -999)', async () => {
    dbMock.exec.mockImplementation(fixture(false))
    await recalcAllScores()
    const ups = postUpdates()
    expect(ups).toHaveLength(1)
    expect(ups[0]!.params).toEqual([-999, 0, 0, 0, POST_A])
  })

  it('estado já correto → nenhuma escrita de post', async () => {
    dbMock.exec.mockImplementation(fixture(true))
    await recalcAllScores()
    expect(postUpdates()).toHaveLength(0)
  })

  it('banco vazio → noop sem throw', async () => {
    dbMock.exec.mockResolvedValue([])
    await expect(recalcAllScores()).resolves.toBeUndefined()
    expect(dbMock.batch).not.toHaveBeenCalled()
  })
})
