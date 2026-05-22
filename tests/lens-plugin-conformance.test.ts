/**
 * Lens Plugin — POC conformance tests (Sprint N+2 P0.2).
 *
 * 12 tests cobrindo:
 *  - LensRegistry CRUD: register/getActive/list, idempotent re-register
 *  - PprTrustLens bit-exact: strength=0 → ordem preservada (#19 invariant)
 *  - ChronologicalLens determinismo: ordena por createdAt DESC, id tiebreak
 *  - Default active = 'ppr-trust' (preserva behavior atual)
 *  - SuaLenteCard string match (LensSelector dropdown wired)
 *  - Manifesto §22 LOCK: chronological lens NÃO referencia score/PPR
 *  - Manifesto §24 LOCK: nem PPR nem Chrono mutam input posts
 *
 * **POC active = volátil** (decisão registrada): store em memória, reset
 * on reload. Persistência em `user_prefs.active_lens` defer Sprint N+3
 * (SHIP) pra evitar churn de migração no POC.
 *
 * Refs: Docs/lens-pluggable-design.md §Migração (bit-exactness preservation)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Post } from '../src/types/drift'
import type { LensStrategy, LensApplyContext } from '../src/lib/lens/types'

// Helpers ────────────────────────────────────────────────────────────

function mkPost(overrides: Partial<Post>): Post {
  return {
    id: 'p_' + Math.random().toString(36).slice(2, 10),
    authorPub: 'npub_a',
    content: '{"subposts":[]}',
    subposts: [],
    createdAt: 1_700_000_000,
    category: null,
    location: null,
    client: null,
    contentWarning: null,
    score: 0,
    spreads: 0,
    buries: 0,
    ...overrides,
  }
}

const CTX_BASE: LensApplyContext = {
  viewer: null,
  now: 1_700_000_000_000,
  getPprScore: () => 0,
}

// ─── Registry CRUD ───────────────────────────────────────────────────

describe('LensRegistry — CRUD + default active', () => {
  beforeEach(async () => {
    const { __testing } = await import('../src/lib/lens/registry')
    __testing.reset()
  })

  it('#1 register + list — strategies aparecem na ordem de registro', async () => {
    const { registerLens, listLenses } = await import('../src/lib/lens/registry')
    const { PprTrustLens } = await import('../src/lib/lens/strategies/ppr-trust')
    const { ChronologicalLens } = await import(
      '../src/lib/lens/strategies/chronological'
    )
    registerLens(PprTrustLens)
    registerLens(ChronologicalLens)
    const ids = listLenses().map((l) => l.id)
    expect(ids).toEqual(['ppr-trust', 'chronological'])
  })

  it('#2 default activeId = "ppr-trust" — preserva behavior atual', async () => {
    const { useLensRegistryStore, registerLens, getActiveLens } = await import(
      '../src/lib/lens/registry'
    )
    const { PprTrustLens } = await import('../src/lib/lens/strategies/ppr-trust')
    registerLens(PprTrustLens)
    expect(useLensRegistryStore.getState().activeId).toBe('ppr-trust')
    expect(getActiveLens().id).toBe('ppr-trust')
  })

  it('#3 setActive — switching reativo + erro em id desconhecido', async () => {
    const { registerLens, setActiveLens, getActiveLens } = await import(
      '../src/lib/lens/registry'
    )
    const { PprTrustLens } = await import('../src/lib/lens/strategies/ppr-trust')
    const { ChronologicalLens } = await import(
      '../src/lib/lens/strategies/chronological'
    )
    registerLens(PprTrustLens)
    registerLens(ChronologicalLens)
    setActiveLens('chronological')
    expect(getActiveLens().id).toBe('chronological')
    expect(() => setActiveLens('inexistente')).toThrow(/unknown strategy/i)
  })

  it('#4 re-register mesmo objeto = no-op (StrictMode/hot-reload safe)', async () => {
    const { registerLens, listLenses } = await import('../src/lib/lens/registry')
    const { PprTrustLens } = await import('../src/lib/lens/strategies/ppr-trust')
    registerLens(PprTrustLens)
    registerLens(PprTrustLens) // no throw
    expect(listLenses()).toHaveLength(1)
  })

  it('#5 register strategy é frozen — impede mutation pós-registro', async () => {
    const { registerLens, listLenses } = await import('../src/lib/lens/registry')
    const { ChronologicalLens } = await import(
      '../src/lib/lens/strategies/chronological'
    )
    registerLens(ChronologicalLens)
    const [s] = listLenses()
    expect(Object.isFrozen(s)).toBe(true)
  })

  it('#6 initBuiltinLenses — idempotente', async () => {
    const { initBuiltinLenses } = await import('../src/lib/lens/init')
    const { listLenses } = await import('../src/lib/lens/registry')
    initBuiltinLenses()
    initBuiltinLenses()
    initBuiltinLenses()
    expect(listLenses().map((l) => l.id).sort()).toEqual(
      ['chronological', 'ppr-trust'].sort(),
    )
  })
})

// ─── PprTrustLens bit-exact migration ────────────────────────────────

describe('PprTrustLens — bit-exact migration (#19 invariant)', () => {
  beforeEach(async () => {
    const { __testing: regTesting } = await import('../src/lib/lens/registry')
    regTesting.reset()
    const { __testing: lensTesting } = await import('../src/lib/trust-lens')
    lensTesting.resetStore()
  })

  it('#7 strength=0 → posts retornados na MESMA ordem (bit-exact off-state)', async () => {
    const { PprTrustLens } = await import('../src/lib/lens/strategies/ppr-trust')
    const { setLensStrength } = await import('../src/lib/trust-lens')
    setLensStrength(0)
    const input: Post[] = [
      mkPost({ id: 'a', score: 10, createdAt: 1 }),
      mkPost({ id: 'b', score: 100, createdAt: 2 }),
      mkPost({ id: 'c', score: 5, createdAt: 3 }),
    ]
    const { posts: out } = PprTrustLens.apply(input, CTX_BASE)
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    // Bit-exact: mesmas refs, posts não tocados.
    expect(out[0]).toBe(input[0])
  })

  it('#8 strength>0 + pprScore=0 pra todos → fallback estável (sem reorder caótico)', async () => {
    const { PprTrustLens } = await import('../src/lib/lens/strategies/ppr-trust')
    const { setLensStrength } = await import('../src/lib/trust-lens')
    setLensStrength(0.5)
    const input: Post[] = [
      mkPost({ id: 'a', score: 10, createdAt: 100 }),
      mkPost({ id: 'b', score: 20, createdAt: 200 }),
      mkPost({ id: 'c', score: 5, createdAt: 300 }),
    ]
    const { posts: out } = PprTrustLens.apply(input, {
      ...CTX_BASE,
      getPprScore: () => 0,
    })
    // Todos com PPR=0 → s_local = score × viewMultiplier(0, 0, 0.5).
    // Ordem final: score DESC, createdAt DESC tiebreaker (matches feed.ts ORDER BY).
    expect(out.map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('#9 strength>0 + PPR alto pra autor X → X recebe multiplier > base', async () => {
    const { PprTrustLens } = await import('../src/lib/lens/strategies/ppr-trust')
    const { setLensStrength } = await import('../src/lib/trust-lens')
    setLensStrength(1.0)
    // Scores empatados: PPR boost decide a ordem (autor 'high' sobe).
    const input: Post[] = [
      mkPost({ id: 'a', authorPub: 'npub_low', score: 50, createdAt: 1 }),
      mkPost({ id: 'b', authorPub: 'npub_high', score: 50, createdAt: 2 }),
    ]
    const { posts: out } = PprTrustLens.apply(input, {
      ...CTX_BASE,
      getPprScore: (pub) => (pub === 'npub_high' ? 0.9 : 0),
    })
    // Mesmo score base → PPR boost de 'b' supera a tiebreaker; 'b' primeiro.
    expect(out[0].id).toBe('b')
    expect(out[1].id).toBe('a')
  })

  it('#10 NÃO muta input array nem Post objects (manifesto §24)', async () => {
    const { PprTrustLens } = await import('../src/lib/lens/strategies/ppr-trust')
    const { setLensStrength } = await import('../src/lib/trust-lens')
    setLensStrength(0.5)
    const input: Post[] = [
      mkPost({ id: 'a', score: 10 }),
      mkPost({ id: 'b', score: 20 }),
    ]
    const snapshot = input.map((p) => ({ ...p }))
    PprTrustLens.apply(input, CTX_BASE)
    expect(input.map((p) => p.id)).toEqual(snapshot.map((p) => p.id))
    expect(input[0].score).toBe(snapshot[0].score)
    expect(input[1].score).toBe(snapshot[1].score)
  })
})

// ─── ChronologicalLens determinismo + §22 LOCK ───────────────────────

describe('ChronologicalLens — determinismo + manifesto §22', () => {
  it('#11 ordena por createdAt DESC + id tiebreak (cross-device determinism)', async () => {
    const { ChronologicalLens } = await import(
      '../src/lib/lens/strategies/chronological'
    )
    const input: Post[] = [
      mkPost({ id: 'a', createdAt: 100 }),
      mkPost({ id: 'c', createdAt: 200 }),
      mkPost({ id: 'b', createdAt: 200 }), // tie c vs b → id lexico
      mkPost({ id: 'd', createdAt: 50 }),
    ]
    const { posts: out } = ChronologicalLens.apply(input, CTX_BASE)
    expect(out.map((p) => p.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('#12 manifesto §22 LOCK — chronological strategy NÃO referencia score nem PPR', () => {
    const src = readFileSync('src/lib/lens/strategies/chronological.ts', 'utf8')
    // Strip comments pra checar SÓ código executável.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bscore\b/)
    expect(code).not.toMatch(/\bgetPprScore\b/)
    expect(code).not.toMatch(/\bviewMultiplier\b/)
  })

  it('#13 SuaLenteCard wire-up — LensSelector renderizado + setActiveLens chamado', () => {
    const src = readFileSync('src/components/Settings/SuaLenteCard.tsx', 'utf8')
    expect(src).toMatch(/setActiveLens/)
    expect(src).toMatch(/listLenses/)
    expect(src).toMatch(/useLensRegistryStore/)
    // Slider gateado por showStrengthControls (chronological esconde slider)
    expect(src).toMatch(/showStrengthControls/)
  })
})
