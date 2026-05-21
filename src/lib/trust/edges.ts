/**
 * Trust Lens — edge influence formula + validation + persistence.
 *
 * Pure parts (testable sem DB):
 *   - `computeInfluence(components)` — sigmoid formula
 *   - `validateComponents(input)` — type guard
 *   - `sanitizeComponents(input)` — NaN guards (Marshall BUG-7)
 *
 * DB part:
 *   - `upsertEdge(source, target, components)` — write to lens_edges
 *
 * Formula (Stage 3 HIMYM locked, ver constants.ts):
 *
 *   influence = sigmoid(
 *       W_BIAS                                       // -2.0 anti-Sybil base
 *     + W_FOLLOW · follow_edge                       // 1.5 follow forte
 *     + W_MUTUAL · log(1 + min(mutual, MUTUAL_CAP))  // 1.0 mutuais cap 20
 *     + W_MY_SPREAD · log(1 + my_spreads)            // 1.2 atestação +
 *     − W_MY_BURY · log(1 + my_buries)               // 1.5 atestação −
 *   )
 *
 * Razão direct:FoF ≈ 7x (Robin/Barney call) — anti-Sybil em cold-start
 * hostile (1 follow + 100 FoF² vazios).
 *
 * Output range: (0, 1) por construção do sigmoid. CHECK constraint
 * em schema valida storage; aqui validamos antes de write pra defesa
 * em camada.
 *
 * Determinismo: mesmo input → mesmo output, bit-exact. Manifesto §7
 * + Stage 3 BUG-7 NaN guard.
 *
 * Conformance tests:
 *   - tests/trust-lens-math.test.ts #10 (influence ∈ [0,1])
 *   - tests/trust-lens-math.test.ts #11 (monotonia follow)
 *   - tests/trust-lens-math.test.ts #12 (monotonia my_bury)
 *   - tests/trust-lens-math.test.ts #17 (NaN guard upsertEdge)
 */

import { db } from '../db'
import { EDGE_WEIGHT } from './constants'
import type { LensEdgeComponentsV1 } from '../../types/drift'

// ─── Sigmoid (pure helper) ────────────────────────────────────────

/**
 * Logistic sigmoid: σ(x) = 1 / (1 + e^-x). Output ∈ (0, 1).
 *
 * Estabilidade numérica: pra |x| > ~700 dá overflow em ambos lados.
 * Em Drift, inputs vêm bounded por sigmoid coefs × log(small numbers),
 * raramente passam de ±10. Não tratamos overflow extremo.
 */
function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x)
    return 1 / (1 + z)
  }
  // x < 0: forma numericamente estável pra evitar overflow em exp(-x grande)
  const z = Math.exp(x)
  return z / (1 + z)
}

// ─── Pure: validation + sanitization ──────────────────────────────

/**
 * Type guard estrito. Rejeita objetos malformados (v != 1, fields
 * ausentes, tipos errados).
 *
 * NÃO sanitiza — rejeita. Use `sanitizeComponents` se quer recovery.
 */
export function isValidComponents(c: unknown): c is LensEdgeComponentsV1 {
  if (c === null || typeof c !== 'object') return false
  const o = c as Record<string, unknown>
  if (o.v !== 1) return false
  if (o.follow !== 0 && o.follow !== 1) return false
  for (const key of ['mutual_spread', 'my_spread', 'my_bury', 'fof_paths'] as const) {
    const v = o[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false
  }
  return true
}

/**
 * NaN guard + clamp pra zero (Marshall BUG-7 fix).
 *
 * Edge cases tratados:
 *   - input null/undefined → defaults zerados
 *   - NaN / Infinity → 0
 *   - negativos → 0
 *   - non-integers → floor
 *   - follow não-binário → coerced pra 0|1
 *
 * Returns componente sempre válido pra `computeInfluence`. NÃO falha.
 */
export function sanitizeComponents(input: Partial<LensEdgeComponentsV1> | null | undefined): LensEdgeComponentsV1 {
  const i = input ?? {}
  const safeCount = (x: unknown): number => {
    if (typeof x !== 'number' || !Number.isFinite(x)) return 0
    return Math.max(0, Math.floor(x))
  }
  const follow: 0 | 1 = i.follow === 1 ? 1 : 0
  return {
    v: 1,
    follow,
    mutual_spread: safeCount(i.mutual_spread),
    my_spread: safeCount(i.my_spread),
    my_bury: safeCount(i.my_bury),
    fof_paths: safeCount(i.fof_paths),
  }
}

// ─── Pure: edge influence formula ─────────────────────────────────

/**
 * Compute influence ∈ (0, 1) de um edge dado seus componentes.
 *
 * Pure function — mesmo input → mesmo output bit-exact. Testável em
 * Vitest sem browser.
 *
 * Assumes componente já válido — caller deve `sanitizeComponents` se
 * input vem de fonte não-confiável. CHECK em SQL adiciona defesa
 * final em camada.
 */
export function computeInfluence(c: LensEdgeComponentsV1): number {
  const cappedMutual = Math.min(c.mutual_spread, EDGE_WEIGHT.MUTUAL_CAP)
  const x =
    EDGE_WEIGHT.W_BIAS +
    EDGE_WEIGHT.W_FOLLOW * c.follow +
    EDGE_WEIGHT.W_MUTUAL * Math.log(1 + cappedMutual) +
    EDGE_WEIGHT.W_MY_SPREAD * Math.log(1 + c.my_spread) -
    EDGE_WEIGHT.W_MY_BURY * Math.log(1 + c.my_bury)
  return sigmoid(x)
}

// ─── DB write boundary ────────────────────────────────────────────

/**
 * Upsert edge em `lens_edges`. Sanitiza components antes do write
 * (BUG-7 NaN guard). NÃO assume input válido.
 *
 * Source SEMPRE = active identity npub (multi-id invariante #15).
 *
 * Idempotent: ON CONFLICT(source, target) UPDATE — re-call seguro.
 */
export async function upsertEdge(
  sourceNpub: string,
  targetNpub: string,
  rawComponents: Partial<LensEdgeComponentsV1> | null | undefined,
): Promise<void> {
  const components = sanitizeComponents(rawComponents)
  const influence = computeInfluence(components)
  const now = Date.now()
  await db.run(
    // Satoshi devsec 2026-05-20 Gap B: created_at IMUTÁVEL após primeiro
    // INSERT. ON CONFLICT NÃO toca em created_at (não está no SET clause).
    // Mantém defesa anti-Sybil edge-refresh — re-upsert do mesmo edge não
    // rejuvenesce o age usado em temporalDecay. NOTE: este upsertEdge é
    // duplicado em trust-lens.ts:upsertLensEdge — mudanças aqui DEVEM
    // refletir lá. TODO refactor: delegar pra um único writer.
    `INSERT INTO lens_edges (source_npub, target_npub, influence, components, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_npub, target_npub) DO UPDATE SET
       influence = excluded.influence,
       components = excluded.components,
       updated_at = excluded.updated_at`,
    [sourceNpub, targetNpub, influence, JSON.stringify(components), now, now],
  )
}
