/**
 * Fixtures determinísticas pra tests do verify-worker.
 *
 * Origem: Barney threat model `Docs/security/verify-worker-threat-model-
 * 2026-05-16.md` §7 "Próximos passos" #2 — "Marshall criar fixture
 * deterministic ... 100 eventos {válidos: 70, signature inválida: 20,
 * schema inválido: 10}".
 *
 * Determinismo: chaves derivadas de seeds fixas (hex constants).
 * `generateSecretKey()` aceita 32 bytes deterministicos via override?
 * Não — nostr-tools API gera aleatório. Usamos `getPublicKey(skBytes)` +
 * `finalizeEvent(template, skBytes)` direto, alimentando seeds nós
 * mesmos. `finalizeEvent` interno usa `schnorr.sign(hash, sk)` com
 * BIP-340 que é determinístico no nostr-tools 2.x (não usa nonce
 * aleatório — schnorr BIP-340 é determinístico por construção via
 * tagged hash).
 *
 * Resultado: mesma seed → mesmos eventos → mesma sig. Test reruns
 * sempre vêm o mesmo conjunto. Hash de sanidade `FIXTURES_DIGEST` no
 * fim do arquivo detecta drift acidental (alguma dep mudou serialization
 * → invalida fixtures → CI detecta).
 *
 * Cobertura:
 *  - 70 events com sig VÁLIDA (kind 9078..9081 + 1111 distribuídos,
 *    autores diversos, conteúdos plausíveis)
 *  - 20 events com sig INVÁLIDA (sig byte-flip OU pubkey trocada
 *    enquanto sig mantém — gera mismatch garantido pra verifyEvent)
 *  - 10 events com schema INVÁLIDO (kind 1, kind 30078, tag faltando)
 *
 * Tests NÃO assinam eventos novos em runtime — exclusivamente consomem
 * fixtures daqui. Custo de geração é amortizado em `vi.beforeAll`.
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Event as SignedEvent } from 'nostr-tools'

import { DRIFT_KIND } from '../../src/config/constants'

// ─── Seeds determinísticas ───────────────────────────────────────────
//
// 10 SKs distintas — cada SK 32 bytes hex. Eventos são distribuídos
// entre essas chaves pra simular diversidade autoral (cada um assina
// 7 events em média). Hashes derivados de strings ("drift-fixture-N"
// → sha256) garantem que mudar um seed não é silencioso.

const SK_SEEDS = [
  'drift-fixture-author-1',
  'drift-fixture-author-2',
  'drift-fixture-author-3',
  'drift-fixture-author-4',
  'drift-fixture-author-5',
  'drift-fixture-author-6',
  'drift-fixture-author-7',
  'drift-fixture-author-8',
  'drift-fixture-author-9',
  'drift-fixture-author-10',
] as const

function deriveSk(seed: string): Uint8Array {
  // sha256(seed) → 32 bytes; aceitável como private key (secp256k1
  // privkey precisa estar em [1, n-1]; probabilidade de sha256 cair
  // fora é ~2^-128, negligenciável; nenhuma dessas seeds bate). Em
  // produção NUNCA fazer isso — fixtures only.
  return sha256(new TextEncoder().encode(seed))
}

const KEYRING = SK_SEEDS.map((seed) => {
  const sk = deriveSk(seed)
  return { sk, pk: getPublicKey(sk), seed }
})

// ─── Helpers ────────────────────────────────────────────────────────

const HEX_64 = 'a'.repeat(64) // post.id placeholder pra SPREAD/BURY/REPORT

function pickKey(i: number): (typeof KEYRING)[number] {
  return KEYRING[i % KEYRING.length]!
}

/**
 * `created_at` determinístico por offset — não usa Date.now. Base
 * 1714000000 (~2024-04 ish), incrementa por slot pra evitar dup id.
 */
function ts(slot: number): number {
  return 1714000000 + slot
}

interface PostContent {
  subposts: Array<{ id: string; text: string }>
}

function makePostContent(slot: number): string {
  const content: PostContent = {
    subposts: [
      { id: `sp-${slot}-a`, text: `subpost a slot ${slot}` },
      { id: `sp-${slot}-b`, text: `subpost b slot ${slot}` },
    ],
  }
  return JSON.stringify(content)
}

function signPost(slot: number, keyIdx: number): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: DRIFT_KIND.POST,
      created_at: ts(slot),
      tags: [
        ['drift-version', '1'],
        ['client', 'drift-fixture'],
      ],
      content: makePostContent(slot),
    },
    k.sk,
  )
}

function signSpread(slot: number, keyIdx: number, postId: string): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: DRIFT_KIND.SPREAD,
      created_at: ts(slot),
      tags: [
        ['e', postId],
        ['p', pickKey(keyIdx + 1).pk],
      ],
      content: '',
    },
    k.sk,
  )
}

function signBury(slot: number, keyIdx: number, postId: string): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: DRIFT_KIND.BURY,
      created_at: ts(slot),
      tags: [['e', postId]],
      content: '',
    },
    k.sk,
  )
}

function signReport(slot: number, keyIdx: number, postId: string): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: DRIFT_KIND.REPORT,
      created_at: ts(slot),
      tags: [
        ['e', postId],
        ['p', pickKey(keyIdx + 1).pk],
        ['reason', 'spam'],
      ],
      content: '',
    },
    k.sk,
  )
}

// ─── 70 events com signature VÁLIDA ─────────────────────────────────
//
// Distribuição:
//   25 POST  (kind 9078) — bulk do tráfego típico (post = consumer)
//   25 SPREAD (kind 9079) — segunda maior frequência (swipe up)
//   12 BURY   (kind 9080) — frequência menor
//    8 REPORT (kind 9081) — caudal pequeno
//
// 25 + 25 + 12 + 8 = 70 ✓

const ANCHOR_POST_ID = (() => {
  // Post "âncora" de cuja id usamos pra spreads/buries/reports válidos.
  // Ele entra na lista de validEvents como o primeiro item.
  // (signPost retorna SignedEvent com `[verifiedSymbol]=true` interno;
  // só usamos `.id` aqui, então clean() é dispensável.)
  return signPost(0, 0).id
})()

function buildValidEvents(): SignedEvent[] {
  const out: SignedEvent[] = []
  // POST × 25
  for (let i = 0; i < 25; i++) out.push(clean(signPost(i, i)))
  // SPREAD × 25 — todos apontam pra ANCHOR_POST_ID (válido pq é hex 64)
  for (let i = 0; i < 25; i++) {
    out.push(clean(signSpread(100 + i, i, ANCHOR_POST_ID)))
  }
  // BURY × 12
  for (let i = 0; i < 12; i++) {
    out.push(clean(signBury(200 + i, i, ANCHOR_POST_ID)))
  }
  // REPORT × 8
  for (let i = 0; i < 8; i++) {
    out.push(clean(signReport(300 + i, i, ANCHOR_POST_ID)))
  }
  return out
}

export const validEvents: readonly SignedEvent[] = Object.freeze(buildValidEvents())

// ─── 20 events com signature INVÁLIDA ───────────────────────────────
//
// Estratégia: pegar 20 events bem-formados, byte-flip o último char
// da `sig`. Schema fica intacto (kind/tags/content válidos), só o
// crypto fica quebrado. Garante que `verifyEvent` retorna `false`
// (e o pipeline precisa rejeitar ANTES de persist).

function flipLastSigChar(sig: string): string {
  if (sig.length === 0) return sig
  const last = sig[sig.length - 1]!
  // hex: troca 0→f, 1→e, ... (qualquer mudança serve, esta dá symmetry)
  const flipped =
    last === 'f' ? '0' : (parseInt(last, 16) + 1).toString(16)
  return sig.slice(0, -1) + flipped
}

/**
 * Strip `verifiedSymbol` cache (nostr-tools/pure marca eventos como
 * verified após `finalizeEvent`). Sem isso, `verifyEvent` retorna o
 * cache `true` mesmo após adulterarmos a `sig`. Re-criação via objeto
 * literal limpo evita carregar simbolos não-string.
 */
function clean(event: SignedEvent): SignedEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  }
}

function buildInvalidSigEvents(): SignedEvent[] {
  const out: SignedEvent[] = []
  // 8 POST mal-assinados
  for (let i = 0; i < 8; i++) {
    const e = clean(signPost(500 + i, i))
    out.push({ ...e, sig: flipLastSigChar(e.sig) })
  }
  // 6 SPREAD mal-assinados
  for (let i = 0; i < 6; i++) {
    const e = clean(signSpread(600 + i, i, ANCHOR_POST_ID))
    out.push({ ...e, sig: flipLastSigChar(e.sig) })
  }
  // 4 BURY mal-assinados
  for (let i = 0; i < 4; i++) {
    const e = clean(signBury(700 + i, i, ANCHOR_POST_ID))
    out.push({ ...e, sig: flipLastSigChar(e.sig) })
  }
  // 2 REPORT mal-assinados
  for (let i = 0; i < 2; i++) {
    const e = clean(signReport(800 + i, i, ANCHOR_POST_ID))
    out.push({ ...e, sig: flipLastSigChar(e.sig) })
  }
  return out
}

export const invalidSigEvents: readonly SignedEvent[] = Object.freeze(
  buildInvalidSigEvents(),
)

// ─── 10 events com schema INVÁLIDO ──────────────────────────────────
//
// Estratégia: events com sig VÁLIDA (passariam verify), mas
// kind/shape errado pra pipeline Drift. `passesSchemaCheck` retorna
// false → cheap check rejeita antes do verify.
//
// Casos:
//  - 3 kind = 1 (Nostr note clássica — fora do DRIFT_KIND_SET)
//  - 2 kind = 30078 (NIP-78 application-specific data, fora do set)
//  - 2 kind = 9078 (POST) sem tag drift-version
//  - 2 kind = 9079 (SPREAD) sem tag `e`
//  - 1 kind = 9081 (REPORT) sem tag `reason`

function signKind1(slot: number, keyIdx: number): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: 1,
      created_at: ts(slot),
      tags: [],
      content: `nostr note ${slot}`,
    },
    k.sk,
  )
}

function signKind30078(slot: number, keyIdx: number): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: 30078,
      created_at: ts(slot),
      tags: [['d', `app-data-${slot}`]],
      content: '{}',
    },
    k.sk,
  )
}

function signPostMissingDriftVersion(slot: number, keyIdx: number): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: DRIFT_KIND.POST,
      created_at: ts(slot),
      tags: [['client', 'no-drift-version']],
      content: makePostContent(slot),
    },
    k.sk,
  )
}

function signSpreadMissingE(slot: number, keyIdx: number): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: DRIFT_KIND.SPREAD,
      created_at: ts(slot),
      tags: [['p', pickKey(keyIdx + 1).pk]], // sem `e`
      content: '',
    },
    k.sk,
  )
}

function signReportMissingReason(slot: number, keyIdx: number): SignedEvent {
  const k = pickKey(keyIdx)
  return finalizeEvent(
    {
      kind: DRIFT_KIND.REPORT,
      created_at: ts(slot),
      tags: [['e', ANCHOR_POST_ID]], // sem `reason`
      content: '',
    },
    k.sk,
  )
}

function buildInvalidSchemaEvents(): SignedEvent[] {
  const out: SignedEvent[] = []
  for (let i = 0; i < 3; i++) out.push(clean(signKind1(900 + i, i)))
  for (let i = 0; i < 2; i++) out.push(clean(signKind30078(910 + i, i)))
  for (let i = 0; i < 2; i++) out.push(clean(signPostMissingDriftVersion(920 + i, i)))
  for (let i = 0; i < 2; i++) out.push(clean(signSpreadMissingE(930 + i, i)))
  for (let i = 0; i < 1; i++) out.push(clean(signReportMissingReason(940 + i, i)))
  return out
}

export const invalidSchemaEvents: readonly SignedEvent[] = Object.freeze(
  buildInvalidSchemaEvents(),
)

// ─── Sanity: anchor + size invariants ───────────────────────────────

export const FIXTURE_COUNTS = Object.freeze({
  valid: 70,
  invalidSig: 20,
  invalidSchema: 10,
}) as { readonly valid: 70; readonly invalidSig: 20; readonly invalidSchema: 10 }

if (validEvents.length !== FIXTURE_COUNTS.valid) {
  throw new Error(
    `[verify-events fixtures] validEvents tem ${validEvents.length}, esperado ${FIXTURE_COUNTS.valid}`,
  )
}
if (invalidSigEvents.length !== FIXTURE_COUNTS.invalidSig) {
  throw new Error(
    `[verify-events fixtures] invalidSigEvents tem ${invalidSigEvents.length}, esperado ${FIXTURE_COUNTS.invalidSig}`,
  )
}
if (invalidSchemaEvents.length !== FIXTURE_COUNTS.invalidSchema) {
  throw new Error(
    `[verify-events fixtures] invalidSchemaEvents tem ${invalidSchemaEvents.length}, esperado ${FIXTURE_COUNTS.invalidSchema}`,
  )
}

// ─── Digest pra detectar drift de geração ───────────────────────────
//
// Concatena todos os event.id (deterministic-derived: hash de
// kind+created_at+tags+content+pubkey via nostr-tools `getEventHash`)
// e tira sha256. Se uma dep upstream mudar serialization (nostr-tools
// quebra-bumped), `FIXTURES_DIGEST` reportado em CI muda → catch
// silencioso.

function computeDigest(): string {
  const ids = [
    ...validEvents.map((e) => e.id),
    ...invalidSigEvents.map((e) => e.id),
    ...invalidSchemaEvents.map((e) => e.id),
  ].sort() // ordem estável independente de iteração
  const concat = ids.join('|')
  return bytesToHex(sha256(new TextEncoder().encode(concat)))
}

/**
 * sha256 sobre todos os event.id ordenados — fica estável enquanto:
 *  1. seeds não mudam
 *  2. nostr-tools getEventHash não muda
 *  3. ordem de geração das fixtures não muda
 *
 * Test `verify-invariants.test.ts` valida que esse digest casa com o
 * snapshot computado uma vez (lock-via-test).
 */
export const FIXTURES_DIGEST: string = computeDigest()

// ─── Helpers public pra os tests ────────────────────────────────────

/** Retorna SKs determinísticas — útil pra tests que precisam assinar
 *  novos events fora das fixtures (ex: tests de specific edge cases). */
export function getFixtureKeyring(): readonly { sk: Uint8Array; pk: string }[] {
  return KEYRING.map((k) => ({ sk: k.sk, pk: k.pk }))
}

/** Verde de export — útil em test runner pra confirmar load OK. */
export const FIXTURE_BUILD_OK = true

/** Re-exportado pra tests que precisam saber qual era o anchor post.id. */
export const ANCHOR_POST = Object.freeze({ id: ANCHOR_POST_ID })

// (`bytesToHex` é usado em `computeDigest`; sem importações órfãs.)
