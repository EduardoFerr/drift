/**
 * Dev-seed fixtures — eventos Drift determinísticos pra dev-seed mode + E2E.
 *
 * Sprint N+5 Batch B1 (Marshall). Plano: `Docs/sessions/
 * sprint-n5-e2e-validation-2026-05-29.md`.
 *
 * ─── Determinismo absoluto (manifesto §7) ───────────────────────────
 *
 * NADA aqui usa `Date.now()` nem `generateSecretKey()` aleatório:
 *  - nsec de cada identidade = `sha256("drift-seed-<nome>")` (mesma
 *    técnica de `tests/fixtures/verify-events.ts`). secp256k1 privkey
 *    precisa estar em [1, n-1]; sha256 cair fora é ~2^-128. Em produção
 *    NUNCA derivar nsec assim — fixtures/dev only.
 *  - Schnorr BIP-340 é determinístico por construção (tagged hash, sem
 *    nonce aleatório no nostr-tools 2.x) → mesma seed → mesma sig →
 *    mesmo event.id. Rerun do seed sempre produz os mesmos npubs/ids.
 *  - timestamps derivam de `TS_BASE` (1716000000) + offsets fixos.
 *
 * ─── Os eventos PASSAM pelo pipeline real ───────────────────────────
 *
 * `seed.ts:seedDatabase()` itera estes eventos e chama `onNostrEvent()`
 * pra cada um (CLAUDE.md invariante #1 — única porta de INSERT em
 * domínio). Cada evento é assinado de verdade; em dev-seed mode (browser)
 * o `verify.worker` valida a Schnorr normalmente. Follows (kind 3 NIP-02)
 * não passam por `onNostrEvent` (fora do ranking, §24) — vão por
 * `follows.ts:applyContactList`, tratado em `seed.ts`.
 *
 * ─── Cascata conhecida (valida bug #3 — modelo de propagação) ────────
 *
 * Alice publica P1 (Brasília). Bob→Carol→Dave espalham em sequência
 * pelo follow-graph (A→B→C→D, 4 elos). A suite `propagation-model.spec`
 * checa se o mapa desenha essa ÁRVORE social ou estrelas geográficas
 * erradas. `CASCADE` exporta a sequência esperada pra assert.
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Event as SignedEvent } from 'nostr-tools'

import { DRIFT_KIND, DRIFT_VERSION, CLIENT_ID } from '../../config/constants'
import type { GeoPoint, ContentWarning, ReportReason } from '../../types/drift'

// ─── Constantes de tempo (§7 determinismo) ──────────────────────────

/** Base de timestamp fixa (unix seconds) — ~2024-05-18. Manifesto §7. */
export const TS_BASE = 1716000000

const HOUR = 3600
const DAY = 24 * HOUR
const WEEK = 7 * DAY

// ─── Derivação determinística de identidade ─────────────────────────

export interface SeedIdentity {
  /** Nome legível (named) ou `bg-<n>` (background seed). */
  name: string
  /** Private key bytes (sha256 da seed string). NUNCA sai daqui em prod. */
  sk: Uint8Array
  /** Pubkey hex 64 (npub no formato interno Drift). */
  pub: string
  /** Geo da identidade (null = GPS off). */
  geo: GeoPoint | null
  /** Pubkeys que esta identidade segue (NIP-02). */
  follows: readonly string[]
  /**
   * `created_at` da identidade em unix seconds. Controla a antiguidade
   * (peso). O seed garante que o PRIMEIRO evento de cada user no pipeline
   * carrega este timestamp → `users.created_at` (first-seen) fica
   * conhecido → weight calculável.
   */
  createdAt: number
}

function deriveSk(seed: string): Uint8Array {
  return sha256(new TextEncoder().encode(`drift-seed-${seed}`))
}

function geo(lat: number, lng: number, city: string, country: string): GeoPoint {
  return { lat, lng, city, country }
}

// ─── 8 named identities ──────────────────────────────────────────────
//
// Geo + follow-graph conforme tabela do plano. `createdAt` espalhado pra
// dar antiguidades distintas (pesos distintos, valida #1 score).

// Pre-derivar pubs antes de montar follows (follows referenciam pubs).
function pubOf(seed: string): string {
  return getPublicKey(deriveSk(seed))
}

const NAMED_PUBS = {
  alice: pubOf('alice'),
  bob: pubOf('bob'),
  carol: pubOf('carol'),
  dave: pubOf('dave'),
  erin: pubOf('erin'),
  frank: pubOf('frank'),
  grace: pubOf('grace'),
  heidi: pubOf('heidi'),
} as const

function named(
  name: keyof typeof NAMED_PUBS,
  g: GeoPoint | null,
  follows: readonly string[],
  createdAt: number,
): SeedIdentity {
  const sk = deriveSk(name)
  return { name, sk, pub: NAMED_PUBS[name], geo: g, follows, createdAt }
}

/**
 * Identidades named. `createdAt` (antiguidade) escolhido pra dar pesos
 * espalhados e estáveis:
 *  - Alice criada 30 semanas antes da base → antiquity satura perto de 30.
 *  - Bob 12 semanas, Carol 6, Dave 2, etc.
 * Antiguidade (semanas, cap 40) + engagement (spreads recebidos × 10,
 * cap 60) determinam o weight. Ver `CASCADE_EXPECTED` pra os valores
 * calculados que a suite de score assere.
 */
export const NAMED_IDENTITIES: readonly SeedIdentity[] = Object.freeze([
  named('alice', geo(-15.79, -47.88, 'Brasília', 'BR'), [], TS_BASE - 30 * WEEK),
  named('bob', null, [NAMED_PUBS.alice], TS_BASE - 12 * WEEK),
  named('carol', geo(-23.55, -46.63, 'São Paulo', 'BR'), [NAMED_PUBS.bob], TS_BASE - 6 * WEEK),
  named('dave', geo(-22.9, -43.17, 'Rio de Janeiro', 'BR'), [NAMED_PUBS.carol], TS_BASE - 2 * WEEK),
  named(
    'erin',
    geo(38.72, -9.13, 'Lisboa', 'PT'),
    [NAMED_PUBS.alice, NAMED_PUBS.carol],
    TS_BASE - 20 * WEEK,
  ),
  named('frank', geo(52.52, 13.4, 'Berlin', 'DE'), [NAMED_PUBS.alice], TS_BASE - 16 * WEEK),
  named(
    'grace',
    geo(35.68, 139.69, 'Tokyo', 'JP'),
    [NAMED_PUBS.alice, NAMED_PUBS.bob, NAMED_PUBS.carol],
    TS_BASE - 24 * WEEK,
  ),
  named('heidi', geo(40.71, -74.0, 'New York', 'US'), [NAMED_PUBS.grace], TS_BASE - 8 * WEEK),
])

/** Lookup rápido por nome (Playwright `setupUser(name)` consome). */
export const NAMED_BY_NAME: Readonly<Record<string, SeedIdentity>> = Object.freeze(
  Object.fromEntries(NAMED_IDENTITIES.map((id) => [id.name, id])),
)

/**
 * nsec1 (bech32) determinístico dos 8 named users — chave = nome
 * lowercase (`'alice'`). Contrato com `e2e/fixtures/users.ts` (Lily) +
 * `bootstrap.ts` (`?as=<name>` → `setIdentityFromNsec(NAMED_NSECS[name])`).
 * Re-exportado por `seed.ts`. Mesma sk que assina os eventos seed → o
 * npub do user dirigido por Playwright bate com a autoria das fixtures.
 */
export const NAMED_NSECS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(NAMED_IDENTITIES.map((id) => [id.name, nip19.nsecEncode(id.sk)])),
)

// ─── 50 background seed identities ───────────────────────────────────
//
// Clusters geográficos: 10 Brasília (LPA — Local Privacy Aggregation),
// 10 EU, 10 Ásia, 20 espalhado. createdAt variado (antiguidade espalhada)
// pra pesos não-triviais no agregado.

interface GeoCluster {
  base: GeoPoint
  /** jitter determinístico aplicado por índice. */
  spread: number
}

const CLUSTER_BRASILIA: GeoCluster = { base: geo(-15.79, -47.88, 'Brasília', 'BR'), spread: 0.4 }
const CLUSTER_EU: GeoCluster = { base: geo(48.85, 2.35, 'Paris', 'FR'), spread: 6 }
const CLUSTER_ASIA: GeoCluster = { base: geo(35.68, 139.69, 'Tokyo', 'JP'), spread: 10 }

const WORLD_SPREAD: readonly GeoPoint[] = Object.freeze([
  geo(40.71, -74.0, 'New York', 'US'),
  geo(51.51, -0.13, 'London', 'GB'),
  geo(-33.87, 151.21, 'Sydney', 'AU'),
  geo(19.43, -99.13, 'Mexico City', 'MX'),
  geo(-34.6, -58.38, 'Buenos Aires', 'AR'),
  geo(28.61, 77.21, 'New Delhi', 'IN'),
  geo(55.75, 37.62, 'Moscow', 'RU'),
  geo(-26.2, 28.04, 'Johannesburg', 'ZA'),
  geo(1.35, 103.82, 'Singapore', 'SG'),
  geo(37.77, -122.42, 'San Francisco', 'US'),
])

/** Jitter determinístico pequeno (sem RNG) — espalha o cluster. */
function jitter(cluster: GeoCluster, i: number): GeoPoint {
  // offsets pseudo-espalhados mas determinísticos (seno de índice).
  const dLat = Math.sin(i * 12.9898) * cluster.spread
  const dLng = Math.cos(i * 78.233) * cluster.spread
  return {
    lat: Number((cluster.base.lat + dLat).toFixed(4)),
    lng: Number((cluster.base.lng + dLng).toFixed(4)),
    city: cluster.base.city,
    country: cluster.base.country,
  }
}

function seedGeo(i: number): GeoPoint | null {
  if (i < 10) return jitter(CLUSTER_BRASILIA, i) // 0..9 Brasília (LPA)
  if (i < 20) return jitter(CLUSTER_EU, i) // 10..19 EU
  if (i < 30) return jitter(CLUSTER_ASIA, i) // 20..29 Ásia
  // 30..49 espalhado mundo. ~30% GPS off (anonimato §27 — geo opcional).
  if (i % 3 === 0) return null
  return WORLD_SPREAD[i % WORLD_SPREAD.length]!
}

export const SEED_COUNT = 50

function buildSeedIdentities(): SeedIdentity[] {
  const out: SeedIdentity[] = []
  for (let i = 0; i < SEED_COUNT; i++) {
    const name = `bg-${i}`
    const sk = deriveSk(name)
    // Antiguidade espalhada: 0..40 semanas determinística por índice.
    const weeksOld = (i * 7) % 41
    out.push({
      name,
      sk,
      pub: getPublicKey(sk),
      geo: seedGeo(i),
      follows: [], // seed largo aplicado abaixo (precisa dos pubs prontos)
      createdAt: TS_BASE - weeksOld * WEEK,
    })
  }
  // Follows largos: cada seed segue ~3 outros (graph não-trivial pra
  // Trust Lens PPR). Determinístico: bg-i segue bg-(i+1), bg-(i+7),
  // bg-(i+13) mod SEED_COUNT + Alice (hub social).
  for (let i = 0; i < out.length; i++) {
    const f = new Set<string>([
      out[(i + 1) % SEED_COUNT]!.pub,
      out[(i + 7) % SEED_COUNT]!.pub,
      out[(i + 13) % SEED_COUNT]!.pub,
      NAMED_PUBS.alice,
    ])
    f.delete(out[i]!.pub) // não seguir a si mesmo
    out[i] = { ...out[i]!, follows: Array.from(f) }
  }
  return out
}

export const SEED_IDENTITIES: readonly SeedIdentity[] = Object.freeze(buildSeedIdentities())

/** Todas as 58 identidades (8 named + 50 seed). */
export const ALL_IDENTITIES: readonly SeedIdentity[] = Object.freeze([
  ...NAMED_IDENTITIES,
  ...SEED_IDENTITIES,
])

// ─── Geração de eventos assinados ────────────────────────────────────

function locationTag(loc: GeoPoint | null): string[] | null {
  if (!loc) return null
  return ['location', String(loc.lat), String(loc.lng), loc.city, loc.country]
}

interface PostOpts {
  category?: string
  contentWarning?: ContentWarning
  geoOverride?: GeoPoint | null
  text?: string
  /**
   * URL same-origin relativa (`/dev-seed-media/seed-N.jpg`) pra validar o
   * render path de imagem (Image.tsx + lightbox + blur de content-warning).
   * Same-origin é deliberado: COEP `require-corp` em dev-http bloqueia
   * fetch cross-origin (nostr.build https) → placeholder "indisponível".
   * Asset estático servido pelo mesmo host passa o gate. Só populado em
   * dev-seed (browser ?dev-seed=1); prod nunca referencia esses arquivos.
   * Quando presente, o subpost vira `layout:'landscape'` (as imagens
   * curadas HIMYM/Ted são wide 1400×800 / fotos).
   */
  imageUrl?: string
}

function signPost(author: SeedIdentity, createdAt: number, opts: PostOpts = {}): SignedEvent {
  const tags: string[][] = [
    ['drift-version', DRIFT_VERSION],
    ['client', CLIENT_ID],
  ]
  if (opts.category) tags.push(['category', opts.category])
  if (opts.contentWarning) tags.push(['content-warning', opts.contentWarning])
  const loc = locationTag(opts.geoOverride !== undefined ? opts.geoOverride : author.geo)
  if (loc) tags.push(loc)

  const text = opts.text ?? `seed post by ${author.name} @ ${createdAt}`
  const hasImage = opts.imageUrl != null
  const content = JSON.stringify({
    subposts: [
      {
        id: `${author.name}-${createdAt}`,
        type: hasImage ? 'text+image' : 'text',
        text,
        imageUrl: opts.imageUrl ?? null,
        order: 0,
        layout: hasImage ? 'landscape' : 'text',
      },
    ],
  })
  return finalizeEvent(
    { kind: DRIFT_KIND.POST, created_at: createdAt, tags, content },
    author.sk,
  )
}

function signSpread(
  spreader: SeedIdentity,
  postId: string,
  authorPub: string,
  createdAt: number,
  withGeo = true,
): SignedEvent {
  const tags: string[][] = [
    ['e', postId],
    ['p', authorPub],
  ]
  const loc = withGeo ? locationTag(spreader.geo) : null
  if (loc) tags.push(loc)
  return finalizeEvent(
    { kind: DRIFT_KIND.SPREAD, created_at: createdAt, tags, content: '' },
    spreader.sk,
  )
}

function signBury(burier: SeedIdentity, postId: string, createdAt: number): SignedEvent {
  return finalizeEvent(
    { kind: DRIFT_KIND.BURY, created_at: createdAt, tags: [['e', postId]], content: '' },
    burier.sk,
  )
}

function signReport(
  reporter: SeedIdentity,
  postId: string,
  authorPub: string,
  reason: ReportReason,
  createdAt: number,
): SignedEvent {
  return finalizeEvent(
    {
      kind: DRIFT_KIND.REPORT,
      created_at: createdAt,
      tags: [
        ['e', postId],
        ['p', authorPub],
        ['reason', reason],
      ],
      content: '',
    },
    reporter.sk,
  )
}

/** Evento NIP-02 (kind 3) com a lista de follows da identidade. */
function signContactList(id: SeedIdentity, createdAt: number): SignedEvent {
  const tags = id.follows.map((p) => ['p', p])
  return finalizeEvent({ kind: 3, created_at: createdAt, tags, content: '' }, id.sk)
}

// ─── Montagem do conjunto de eventos ────────────────────────────────
//
// ORDEM IMPORTA pro first-seen (`users.created_at`): emitimos primeiro,
// pra cada identidade, um POST "genesis" no seu `createdAt`. Isso fixa
// `users.created_at` no timestamp que escolhemos → antiguidade conhecida
// → weight calculável. Eventos posteriores só atualizam `last_active`.

export interface SeedEventSet {
  /** Kind 3 NIP-02 — aplicados via follows.ts:applyContactList. */
  contactLists: readonly SignedEvent[]
  /** Kinds 9078..9081 — passam por onNostrEvent. ORDENADOS por created_at. */
  domain: readonly SignedEvent[]
  /** P1 — post de origem da cascata Alice→Bob→Carol→Dave. */
  cascadePostId: string
}

/**
 * Cascata esperada (ground-truth pra `propagation-model.spec` + score).
 * Cada elo: quem espalhou, quando, e o peso esperado do spreader no
 * momento do recalc (computado em `dev-seed-fixtures.test.ts` e re-asserido
 * lá — aqui só os timestamps/atores, que são o contrato estável).
 */
export interface CascadeStep {
  spreaderName: string
  spreaderPub: string
  createdAt: number
}

export const CASCADE: readonly CascadeStep[] = Object.freeze([
  { spreaderName: 'bob', spreaderPub: NAMED_PUBS.bob, createdAt: TS_BASE + 1 * HOUR },
  { spreaderName: 'carol', spreaderPub: NAMED_PUBS.carol, createdAt: TS_BASE + 2 * HOUR },
  { spreaderName: 'dave', spreaderPub: NAMED_PUBS.dave, createdAt: TS_BASE + 3 * HOUR },
])

/**
 * Constrói o conjunto completo de eventos seed. Pura — sem I/O, sem
 * `Date.now()`. Chamada uma vez por `seedDatabase()`.
 *
 * Volume alvo (do plano):
 *  - ~500 posts, ~2000 spreads (pareto), ~200 buries (concentrado),
 *    ~50 reports (3 posts cruzam threshold §26).
 *  - created_at espalhado 4 semanas (temporal decay).
 */
export function buildSeedEvents(): SeedEventSet {
  const domain: SignedEvent[] = []
  const contactLists: SignedEvent[] = []

  // 1. Genesis POST por identidade — fixa first-seen = createdAt.
  //    (Alice genesis NÃO é P1 — P1 vem depois com geo Brasília explícito.)
  for (const id of ALL_IDENTITIES) {
    domain.push(signPost(id, id.createdAt, { text: `genesis ${id.name}` }))
  }

  // 2. P1 — post de origem da cascata (Alice, Brasília, na base).
  const alice = NAMED_BY_NAME.alice!
  const p1 = signPost(alice, TS_BASE, {
    category: 'noticias',
    text: 'cascata raiz — Alice em Brasília',
  })
  domain.push(p1)
  const cascadePostId = p1.id

  // 3. Cascata A→B→C→D pelo follow-graph (1 elo/hora). Bug #3 ground-truth.
  for (const step of CASCADE) {
    const spreader = NAMED_BY_NAME[step.spreaderName]!
    domain.push(signSpread(spreader, cascadePostId, alice.pub, step.createdAt))
  }

  // 4. Posts de conteúdo (volume ~500): além dos 58 genesis, geramos
  //    ~442 posts adicionais distribuídos entre todos os autores, com
  //    created_at espalhado nas 4 semanas (base-28d .. base).
  //    Index global de post pra referência em spreads/buries/reports.
  const contentPosts: { event: SignedEvent; authorPub: string }[] = []
  const TOTAL_CONTENT_POSTS = 442
  // Drift é text-majority: só ~10 dos 442 posts carregam imagem (~2%),
  // o resto é texto. Determinístico (§7): post recebe imagem quando
  // `i % IMAGE_EVERY === 0`; qual das 9 imagens = `(i/IMAGE_EVERY) %
  // SEED_MEDIA_COUNT` (ciclo fixo, sem RNG). URL é same-origin relativa
  // (servida de public/dev-seed-media) — passa o COEP gate de dev-http.
  const SEED_MEDIA_COUNT = 9
  const IMAGE_EVERY = 44 // 442/44 ≈ 10 posts com imagem
  for (let i = 0; i < TOTAL_CONTENT_POSTS; i++) {
    const author = ALL_IDENTITIES[i % ALL_IDENTITIES.length]!
    // created_at: 28 dias atrás .. base, espalhado determinístico.
    const ageSec = Math.floor((i / TOTAL_CONTENT_POSTS) * 28 * DAY)
    const createdAt = TS_BASE - 28 * DAY + ageSec
    const cw: ContentWarning | undefined =
      i % 17 === 0 ? 'nsfw' : i % 23 === 0 ? 'spoiler' : undefined
    const imageUrl =
      i % IMAGE_EVERY === 0
        ? `/dev-seed-media/seed-${(Math.floor(i / IMAGE_EVERY) % SEED_MEDIA_COUNT) + 1}.jpg`
        : undefined
    const ev = signPost(author, createdAt, {
      category: i % 5 === 0 ? 'arte' : i % 3 === 0 ? 'tech' : undefined,
      ...(cw ? { contentWarning: cw } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      text: `conteúdo #${i} por ${author.name}`,
    })
    contentPosts.push({ event: ev, authorPub: author.pub })
    domain.push(ev)
  }

  // 5. Spreads (~2000) com distribuição pareto: ~5% dos posts pegam 80%.
  //    Hot set = primeiros 22 content posts (~5% de 442). Cada hot post
  //    recebe muitos spreaders; long tail recebe poucos.
  const HOT_COUNT = 22
  let spreadCount = 0
  const TARGET_SPREADS = 2000
  // 80% (~1600) pros hot posts, 20% (~400) pra long tail.
  const hotSpreads = 1600
  const tailSpreads = TARGET_SPREADS - hotSpreads
  // Hot: distribui round-robin de spreaders entre os HOT_COUNT posts.
  for (let s = 0; s < hotSpreads; s++) {
    const post = contentPosts[s % HOT_COUNT]!
    const spreader = ALL_IDENTITIES[(s * 7 + 3) % ALL_IDENTITIES.length]!
    if (spreader.pub === post.authorPub) continue // sem self-spread útil
    // Distribui linear nos 20 dias (s/total × janela). Antes: `s % (20*DAY)`
    // = no-op pq s≪1.7M → todos spreads em ~27min cluster → rede "já feita"
    // no mapa. Agora espalha → cascata temporal visível no scrubber.
    const createdAt =
      TS_BASE - 20 * DAY + Math.floor((s / Math.max(1, hotSpreads)) * 20 * DAY)
    domain.push(signSpread(spreader, post.event.id, post.authorPub, createdAt))
    spreadCount++
  }
  // Tail: posts além dos hot, poucos spreads cada.
  for (let s = 0; s < tailSpreads; s++) {
    const post = contentPosts[HOT_COUNT + (s % (TOTAL_CONTENT_POSTS - HOT_COUNT))]!
    const spreader = ALL_IDENTITIES[(s * 11 + 5) % ALL_IDENTITIES.length]!
    if (spreader.pub === post.authorPub) continue
    // Idem hot: distribui linear nos 14 dias (era no-op `s % (14*DAY)`).
    const createdAt =
      TS_BASE - 14 * DAY + Math.floor((s / Math.max(1, tailSpreads)) * 14 * DAY)
    domain.push(signSpread(spreader, post.event.id, post.authorPub, createdAt))
    spreadCount++
  }

  // 6. Buries (~200) concentradas em ~20 posts (valida threshold de
  //    julgamento estético — bury NÃO penaliza autor, mas afeta score).
  const BURY_POSTS = 20
  const TARGET_BURIES = 200
  let buryCount = 0
  for (let b = 0; b < TARGET_BURIES; b++) {
    const post = contentPosts[100 + (b % BURY_POSTS)]! // bloco distinto do hot
    const burier = ALL_IDENTITIES[(b * 13 + 9) % ALL_IDENTITIES.length]!
    if (burier.pub === post.authorPub) continue
    const createdAt = TS_BASE - 10 * DAY + (b % (10 * DAY))
    domain.push(signBury(burier, post.event.id, createdAt))
    buryCount++
  }

  // 7. Reports (~50). 3 posts ALVO recebem reports suficientes pra cruzar
  //    o threshold §26 (score = -999). Base ativa do seed é pequena
  //    (~58 users ativos) → threshold dinâmico = max(5, floor(0.058)) = 5
  //    pra spam/harassment; 'illegal' = max(3, floor(5/2)) = 3.
  //    Damos 8 reporters distintos a cada alvo pra folga acima do
  //    threshold mesmo com pesos baixos de reporters (getReportWeight
  //    mínimo 0.5 → 8×0.5 = 4 < 5; por isso usamos reporters antigos +
  //    'illegal' nos primeiros, garantindo cruzamento — ver test).
  const reportTargets = [contentPosts[200]!, contentPosts[210]!, contentPosts[220]!]
  let reportCount = 0
  // Reporters preferencialmente "pesados" (named + seeds antigos) pra
  // garantir soma de pesos ≥ threshold. 10 reporters por alvo.
  const heavyReporters: SeedIdentity[] = [
    ...NAMED_IDENTITIES, // 8 named (antiguidade alta → peso ≥ 1.0)
    SEED_IDENTITIES[35]!, // bg-35 (weeksOld = (35*7)%41 = 8) — médio
    SEED_IDENTITIES[40]!, // bg-40 ((40*7)%41 = 28 wk) — alto
  ]
  for (let t = 0; t < reportTargets.length; t++) {
    const target = reportTargets[t]!
    // alvo 0 + 1 usam 'illegal' (threshold 3, cruza fácil); alvo 2 'spam'.
    const reason: ReportReason = t < 2 ? 'illegal' : 'spam'
    const reportersForTarget = t < 2 ? 8 : heavyReporters.length
    for (let r = 0; r < reportersForTarget; r++) {
      const reporter = heavyReporters[r % heavyReporters.length]!
      if (reporter.pub === target.authorPub) continue
      const createdAt = TS_BASE - 5 * DAY + r * HOUR + t * DAY
      domain.push(signReport(reporter, target.event.id, target.authorPub, reason, createdAt))
      reportCount++
    }
  }

  // 8. Contact lists (NIP-02 kind 3) — follows de todas as identidades
  //    que TÊM follows. Aplicados fora do pipeline de score (§24).
  for (const id of ALL_IDENTITIES) {
    if (id.follows.length === 0) continue
    contactLists.push(signContactList(id, id.createdAt + 60))
  }

  // ORDENAR domain por created_at ASC garante first-seen estável: o
  // genesis (no createdAt da identidade) é processado ANTES de qualquer
  // evento futuro daquele autor. Empate por id (estável, determinístico).
  const domainSorted = [...domain].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at - b.created_at
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  // Marcador silencioso (lint) — counts usados em test, não em runtime.
  void spreadCount
  void buryCount
  void reportCount

  return {
    contactLists: Object.freeze(contactLists),
    domain: Object.freeze(domainSorted),
    cascadePostId,
  }
}

// ─── Fast path opt-in: artefato JSON pré-serializado ────────────────
//
// Gerar ~3000 eventos via finalizeEvent custa ~24s (signing ~8ms/evento).
// A suite E2E (Sprint N+5) sobe 8 BrowserContexts isolados, cada um
// navega `?dev-seed=1` → 8×24s de CPU re-assinando o MESMO conjunto.
//
// `npm run gen:seed` (scripts/gen-seed.mjs) chama `buildSeedEvents()` e
// serializa o SignedEvent[] + cascadePostId pra `seed-events.generated.json`.
// Artefato committed + determinístico (§7) → CONFIAMOS nele (sem re-assinar,
// sem re-verificar): mesma seed string → mesma Schnorr → mesmos ids. O test
// `dev-seed-fixtures.test.ts` re-deriva tudo e falha se o JSON divergir do
// código (guard anti-drift — regenerar após mexer nas fixtures).
//
// `import.meta.glob` é estático (browser + vitest + ssrLoadModule), e
// retorna `{}` quando o arquivo não existe — sem gerar, cai pro build
// in-memory. Sem erro de build na ausência do artefato.

interface SerializedSeedEventSet {
  contactLists: SignedEvent[]
  domain: SignedEvent[]
  cascadePostId: string
}

const _generatedModules = import.meta.glob('./seed-events.generated.json', {
  eager: true,
}) as Record<string, { default: SerializedSeedEventSet }>

/** Carrega o artefato pré-serializado, ou `null` se não foi gerado. */
function loadGeneratedSeed(): SeedEventSet | null {
  const mod = _generatedModules['./seed-events.generated.json']
  if (!mod) return null
  const { contactLists, domain, cascadePostId } = mod.default
  return {
    contactLists: Object.freeze(contactLists),
    domain: Object.freeze(domain),
    cascadePostId,
  }
}

/**
 * Conjunto materializado uma vez (pure, cacheável). Fast path: carrega o
 * JSON committed se presente; senão constrói em memória (assina ~3000
 * eventos). Ambos os caminhos são bit-idênticos (§7 determinismo).
 */
let _cached: SeedEventSet | null = null
export function getSeedEvents(): SeedEventSet {
  if (!_cached) _cached = loadGeneratedSeed() ?? buildSeedEvents()
  return _cached
}

// ─── Digest determinístico (LOCK_VIA_TEST anti-drift) ───────────────
//
// sha256 sobre todos os event.id ordenados. Muda se: seeds mudam,
// nostr-tools getEventHash muda, ou a composição dos eventos muda.

export function computeSeedDigest(): string {
  const set = getSeedEvents()
  const ids = [
    ...set.contactLists.map((e) => e.id),
    ...set.domain.map((e) => e.id),
  ].sort()
  return bytesToHex(sha256(new TextEncoder().encode(ids.join('|'))))
}
