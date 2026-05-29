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

// ─── Hash determinístico [0,1) (§7 — sem RNG, sem Date.now) ──────────
//
// `fract(sin(n)·k)` clássico (GLSL): distribuição ~uniforme e reproduzível
// por índice. Usado pra geo (disco metropolitano) e timing (burst). Salts
// distintos por dimensão evitam correlação entre lat/lng/delay.

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return x - Math.floor(x)
}

// ─── 50 background seed identities ───────────────────────────────────
//
// Geo realista = usuários concentrados em METRÓPOLES reais distintas, com
// scatter intra-cidade de dezenas de km — NÃO um borrão continental que
// derrama pontos no oceano (bug do jitter ±6-10° anterior). Clusters:
// 10 Brasília (LPA — Local Privacy Aggregation / k-anon §K=1), 10 metros
// EU, 10 metros Ásia, 20 espalhado mundo (~30% GPS off, §27).

const KM_PER_DEG_LAT = 111

const BRASILIA: GeoPoint = geo(-15.79, -47.88, 'Brasília', 'BR')

/** Metrópoles reais por região (geo discreto plausível, não smear). */
const EU_CITIES: readonly GeoPoint[] = Object.freeze([
  geo(48.85, 2.35, 'Paris', 'FR'),
  geo(52.52, 13.4, 'Berlin', 'DE'),
  geo(40.42, -3.7, 'Madrid', 'ES'),
  geo(41.9, 12.5, 'Roma', 'IT'),
  geo(52.37, 4.9, 'Amsterdam', 'NL'),
  geo(38.72, -9.13, 'Lisboa', 'PT'),
  geo(52.23, 21.01, 'Varsóvia', 'PL'),
  geo(59.33, 18.06, 'Estocolmo', 'SE'),
  geo(48.21, 16.37, 'Viena', 'AT'),
  geo(53.35, -6.26, 'Dublin', 'IE'),
])

const ASIA_CITIES: readonly GeoPoint[] = Object.freeze([
  geo(35.68, 139.69, 'Tokyo', 'JP'),
  geo(37.57, 126.98, 'Seul', 'KR'),
  geo(1.35, 103.82, 'Singapura', 'SG'),
  geo(13.76, 100.5, 'Bangkok', 'TH'),
  geo(-6.21, 106.85, 'Jacarta', 'ID'),
  geo(14.6, 120.98, 'Manila', 'PH'),
  geo(19.08, 72.88, 'Mumbai', 'IN'),
  geo(25.03, 121.57, 'Taipé', 'TW'),
  geo(3.14, 101.69, 'Kuala Lumpur', 'MY'),
  geo(10.82, 106.63, 'Ho Chi Minh', 'VN'),
])

const WORLD_CITIES: readonly GeoPoint[] = Object.freeze([
  geo(40.71, -74.0, 'New York', 'US'),
  geo(51.51, -0.13, 'Londres', 'GB'),
  geo(-33.87, 151.21, 'Sydney', 'AU'),
  geo(19.43, -99.13, 'Cidade do México', 'MX'),
  geo(-34.6, -58.38, 'Buenos Aires', 'AR'),
  geo(28.61, 77.21, 'Nova Délhi', 'IN'),
  geo(6.52, 3.38, 'Lagos', 'NG'),
  geo(-26.2, 28.04, 'Joanesburgo', 'ZA'),
  geo(37.77, -122.42, 'San Francisco', 'US'),
  geo(43.65, -79.38, 'Toronto', 'CA'),
  geo(30.04, 31.24, 'Cairo', 'EG'),
  geo(41.01, 28.98, 'Istambul', 'TR'),
])

/**
 * Espalha um ponto dentro de um raio metropolitano (km) ao redor da cidade.
 * Disco UNIFORME via (ângulo, √raio) — não uma linha correlacionada como o
 * seno-de-índice anterior. Longitude escalada por cos(lat) pra manter o raio
 * métrico ~constante longe do equador. Raio pequeno (dezenas de km) → o ponto
 * fica dentro da metrópole e o label de cidade continua válido. Determinístico.
 */
function metroJitter(base: GeoPoint, radiusKm: number, i: number): GeoPoint {
  const ang = hash01(i * 2.17 + 0.5) * Math.PI * 2
  const rKm = Math.sqrt(hash01(i * 3.71 + 9.2)) * radiusKm
  const dLat = (rKm / KM_PER_DEG_LAT) * Math.sin(ang)
  const cosLat = Math.max(0.2, Math.cos((base.lat * Math.PI) / 180))
  const dLng = (rKm / (KM_PER_DEG_LAT * cosLat)) * Math.cos(ang)
  return {
    lat: Number((base.lat + dLat).toFixed(4)),
    lng: Number((base.lng + dLng).toFixed(4)),
    city: base.city,
    country: base.country,
  }
}

function seedGeo(i: number): GeoPoint | null {
  // 0..9 — cluster Brasília apertado (LPA / k-anon §K=1): ~18km (raio do DF).
  if (i < 10) return metroJitter(BRASILIA, 18, i)
  // 10..19 — metrópoles europeias distintas + jitter metro (~15km).
  if (i < 20) return metroJitter(EU_CITIES[(i - 10) % EU_CITIES.length]!, 15, i)
  // 20..29 — metrópoles asiáticas distintas + jitter metro (~15km).
  if (i < 30) return metroJitter(ASIA_CITIES[(i - 20) % ASIA_CITIES.length]!, 15, i)
  // 30..49 espalhado mundo. ~30% GPS off (anonimato §27 — geo opcional).
  if (i % 3 === 0) return null
  return metroJitter(WORLD_CITIES[(i - 30) % WORLD_CITIES.length]!, 12, i)
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
 * Modo de geração do seed.
 *  - `'full'` (default): ~2730 eventos — volume realista pra E2E/load.
 *  - `'lite'`: ~200 eventos — subset fixo pra boot em segundos, validação
 *    visual rápida dos 3 mapas. Preserva o que importa: cascata A→B→C→D,
 *    geo variado (BR/EU/Ásia), spreads espalhados no tempo (cascata
 *    temporal no scrubber), posts com imagem same-origin, buries + reports
 *    que cruzam threshold §26, follows pra Trust Lens/network.
 */
export type SeedMode = 'full' | 'lite'

/**
 * Caps de volume por modo. `lite` reduz os loops mantendo a MESMA lógica
 * de geração (§7: lite é subconjunto determinístico, reproduzível — os
 * primeiros N de cada categoria do build full). Counts lite escolhidos pra
 * drenar em <15s (~200 eventos × ~50ms INSERT roundtrip).
 */
interface SeedCaps {
  /** Identidades de conteúdo além das 8 named (full usa 50 seed). */
  seedIdentities: number
  /** Posts de conteúdo adicionais (full 442). */
  contentPosts: number
  /** Posts "hot" (cabeça da pareto de spreads). */
  hotPosts: number
  /** Total de spreads alvo (full 2000). */
  targetSpreads: number
  /** Total de buries alvo (full 200). */
  targetBuries: number
  /** Quantos posts distintos concentram buries (full 20). */
  buryPosts: number
}

const CAPS: Readonly<Record<SeedMode, SeedCaps>> = Object.freeze({
  full: {
    seedIdentities: SEED_COUNT,
    contentPosts: 442,
    hotPosts: 22,
    targetSpreads: 2000,
    targetBuries: 200,
    buryPosts: 20,
  },
  lite: {
    // 8 named + 12 seed = 20 identidades (mantém clusters BR/EU/Ásia: bg-0..9
    // Brasília LPA, bg-10/11 começo do cluster EU; named cobrem PT/DE/JP/US).
    seedIdentities: 12,
    // 40 posts de conteúdo (~geo variado p/ mapa global inflar). +20 genesis
    // +P1 ≈ 61 posts no total.
    contentPosts: 40,
    hotPosts: 6,
    // ~100 spreads espalhados no tempo (cascata temporal visível no scrubber).
    targetSpreads: 100,
    targetBuries: 20,
    buryPosts: 5,
  },
})

/**
 * Constrói o conjunto de eventos seed. Pura — sem I/O, sem `Date.now()`.
 * Chamada por `seedDatabase()`.
 *
 * Volume alvo:
 *  - `full` (default): ~500 posts, ~2000 spreads (pareto), ~200 buries
 *    (concentrado), ~50 reports (3 posts cruzam threshold §26).
 *  - `lite`: ~60 posts, ~100 spreads, ~20 buries, ~24 reports (3 alvos
 *    cruzam threshold). ~200 eventos totais → drena em <15s.
 *
 * `created_at` espalhado nas semanas (temporal decay) em ambos os modos.
 *
 * §7 determinismo: cada `mode` produz SEMPRE o mesmo conjunto (mesma seleção
 * fixa). lite = subconjunto reproduzível (primeiros N de cada categoria).
 */
/**
 * Delay realista (segundos) de uma reação (spread/bury/report) APÓS a criação
 * do post. Viralização real é um BURST: pico logo depois do post, cauda longa
 * que decai — não um chuvisco em intervalos regulares (bug anterior: spreads
 * distribuídos linearmente, independentes do post, podiam até PRECEDER o post).
 * Modelo = inversa da exponencial: `delay = -mean·ln(1-u)`, `u∈[0,1)` hash
 * determinístico. ~63% reage dentro de `meanHours`; cauda até `capDays`. NUNCA
 * negativo → causalidade preservada (a reação é sempre posterior ao post).
 */
function reactionDelaySec(n: number, meanHours: number, capDays: number): number {
  const u = hash01(n * 2.399 + 0.71) * 0.999 // *0.999 evita ln(0)
  const hours = -meanHours * Math.log(1 - u)
  return Math.floor(Math.min(hours, capDays * 24) * HOUR)
}

/**
 * Constrói o conjunto de eventos seed.
 *
 * Anchor de tempo (anti-staleness): TS_BASE é uma base ABSOLUTA congelada
 * (~mai/2024). Sem âncora, a timeline do seed envelhece com o relógio real →
 * em 2026 todo post tem ~745 dias, o temporal decay (§score) esmaga o score
 * pra 0.000 e o feed parece morto.
 *
 *  - SEM `nowAnchorSec` (default): forma §7-PURA — timeline em TS_BASE, ids
 *    determinísticos. Os LOCK_VIA_TEST chamam assim e re-derivam os MESMOS
 *    ids. NUNCA usa Date.now.
 *  - COM `nowAnchorSec` (seed.ts DEV, via Date.now): 2 passes. Pass 1 (puro)
 *    descobre o topo REAL da timeline — o tail do burst varia por modo, então
 *    estimar fixo erra (lite ~9h, full ~dias). Pass 2 desloca TODA a timeline
 *    por `delta` exato pra que o evento mais novo caia ~1h antes de agora →
 *    ages realistas, scores vivos. Determinístico POR âncora (mesma âncora →
 *    mesmos ids); re-assina 2× (lite ~4s; full raro).
 */
export function buildSeedEvents(mode: SeedMode = 'full', nowAnchorSec?: number): SeedEventSet {
  if (nowAnchorSec == null) return buildWithDelta(mode, 0)
  const pure = buildWithDelta(mode, 0)
  const maxTs = Math.max(
    ...pure.domain.map((e) => e.created_at),
    ...pure.contactLists.map((e) => e.created_at),
  )
  const delta = nowAnchorSec - maxTs - 3600 // newest ~1h antes de agora
  return buildWithDelta(mode, delta)
}

function buildWithDelta(mode: SeedMode, delta: number): SeedEventSet {
  const caps = CAPS[mode]
  // Identidades ativas neste modo: 8 named + os primeiros `seedIdentities`
  // dos seed (subconjunto fixo → cascata/clusters preservados). full = todos.
  const activeIdentities: readonly SeedIdentity[] =
    caps.seedIdentities >= SEED_COUNT
      ? ALL_IDENTITIES
      : Object.freeze([...NAMED_IDENTITIES, ...SEED_IDENTITIES.slice(0, caps.seedIdentities)])
  const domain: SignedEvent[] = []
  const contactLists: SignedEvent[] = []

  // 1. Genesis POST por identidade — fixa first-seen = createdAt.
  //    (Alice genesis NÃO é P1 — P1 vem depois com geo Brasília explícito.)
  for (const id of activeIdentities) {
    domain.push(signPost(id, id.createdAt + delta, { text: `genesis ${id.name}` }))
  }

  // 2. P1 — post de origem da cascata (Alice, Brasília, na base).
  const alice = NAMED_BY_NAME.alice!
  const p1 = signPost(alice, TS_BASE + delta, {
    category: 'noticias',
    text: 'cascata raiz — Alice em Brasília',
  })
  domain.push(p1)
  const cascadePostId = p1.id

  // 3. Cascata A→B→C→D pelo follow-graph (1 elo/hora). Bug #3 ground-truth.
  for (const step of CASCADE) {
    const spreader = NAMED_BY_NAME[step.spreaderName]!
    domain.push(signSpread(spreader, cascadePostId, alice.pub, step.createdAt + delta))
  }

  // 4. Posts de conteúdo (volume ~500): além dos 58 genesis, geramos
  //    ~442 posts adicionais distribuídos entre todos os autores, com
  //    created_at espalhado nas 4 semanas (base-28d .. base).
  //    Index global de post pra referência em spreads/buries/reports.
  const contentPosts: { event: SignedEvent; authorPub: string }[] = []
  const TOTAL_CONTENT_POSTS = caps.contentPosts
  // Drift é text-majority: só ~10 dos 442 posts carregam imagem (~2%),
  // o resto é texto. Determinístico (§7): post recebe imagem quando
  // `i % IMAGE_EVERY === 0`; qual das 9 imagens = `(i/IMAGE_EVERY) %
  // SEED_MEDIA_COUNT` (ciclo fixo, sem RNG). URL é same-origin relativa
  // (servida de public/dev-seed-media) — passa o COEP gate de dev-http.
  const SEED_MEDIA_COUNT = 9
  // ~1 imagem a cada (total/10) posts → ~10 posts com imagem em ambos os
  // modos (full 442/44≈10; lite 40/4=10). Mantém o validador de image-render
  // alimentado mesmo no subset lite. Mínimo 1 pra nunca dividir por zero.
  const IMAGE_EVERY = Math.max(1, Math.floor(TOTAL_CONTENT_POSTS / 10))
  for (let i = 0; i < TOTAL_CONTENT_POSTS; i++) {
    const author = activeIdentities[i % activeIdentities.length]!
    // created_at: últimos 28 dias. Base linear (fluxo de posts ao longo do
    // mês) + perturbação determinística ±~6h pra não virar um metrônomo
    // perfeito. Clamp na janela; o sort final reordena trocas locais.
    const baseAge = (i / TOTAL_CONTENT_POSTS) * 28 * DAY
    const wobble = (hash01(i * 5.13 + 2.9) - 0.5) * 12 * HOUR
    const ageSec = Math.max(0, Math.min(28 * DAY, Math.floor(baseAge + wobble)))
    const createdAt = TS_BASE - 28 * DAY + ageSec + delta
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
  const HOT_COUNT = caps.hotPosts
  let spreadCount = 0
  const TARGET_SPREADS = caps.targetSpreads
  // 80% pros hot posts, 20% pra long tail (mesma pareto em ambos os modos).
  const hotSpreads = Math.floor(TARGET_SPREADS * 0.8)
  const tailSpreads = TARGET_SPREADS - hotSpreads
  // Hot posts ESPALHADOS na timeline (não os primeiros = mais antigos). Posts
  // virais ocorrem ao longo do mês inteiro; cada um gera um burst de spreads
  // num momento distinto → bursts distribuídos no scrubber, não amontoados no
  // início (bug "tudo disparado logo no começo"). Índices uniformemente
  // espaçados no array de conteúdo.
  const hotPosts: { event: SignedEvent; authorPub: string }[] = []
  for (let h = 0; h < HOT_COUNT; h++) {
    hotPosts.push(contentPosts[Math.floor((h / HOT_COUNT) * TOTAL_CONTENT_POSTS)]!)
  }
  // Hot: round-robin de spreaders; cada spread cai num BURST após a criação
  // do seu post (causalidade + decaimento). mean 9h, cauda até 6 dias.
  for (let s = 0; s < hotSpreads; s++) {
    const post = hotPosts[s % HOT_COUNT]!
    const spreader = activeIdentities[(s * 7 + 3) % activeIdentities.length]!
    if (spreader.pub === post.authorPub) continue // sem self-spread útil
    const createdAt = post.event.created_at + reactionDelaySec(s * 1.3 + 11, 9, 6)
    domain.push(signSpread(spreader, post.event.id, post.authorPub, createdAt))
    spreadCount++
  }
  // Tail: posts além dos hot, poucos spreads cada. Burst mais lento (mean 14h)
  // — long tail engaja mais devagar que conteúdo viral.
  for (let s = 0; s < tailSpreads; s++) {
    const post = contentPosts[HOT_COUNT + (s % (TOTAL_CONTENT_POSTS - HOT_COUNT))]!
    const spreader = activeIdentities[(s * 11 + 5) % activeIdentities.length]!
    if (spreader.pub === post.authorPub) continue
    const createdAt = post.event.created_at + reactionDelaySec(s * 1.7 + 101, 14, 8)
    domain.push(signSpread(spreader, post.event.id, post.authorPub, createdAt))
    spreadCount++
  }

  // 6. Buries (~200) concentradas em ~20 posts (valida threshold de
  //    julgamento estético — bury NÃO penaliza autor, mas afeta score).
  const BURY_POSTS = caps.buryPosts
  const TARGET_BURIES = caps.targetBuries
  let buryCount = 0
  // Bloco de bury distinto do hot set (que ocupa os primeiros HOT_COUNT).
  // full: offset 100; lite: logo após o hot set (40 posts não chega a 100).
  const buryOffset = mode === 'full' ? 100 : HOT_COUNT
  for (let b = 0; b < TARGET_BURIES; b++) {
    const post = contentPosts[buryOffset + (b % BURY_POSTS)]!
    const burier = activeIdentities[(b * 13 + 9) % activeIdentities.length]!
    if (burier.pub === post.authorPub) continue
    // Burst após o post (antes: `b % (10*DAY)` = no-op, b≪864k → todas as
    // buries num cluster em TS_BASE-10d). Bury reage mais devagar (mean 18h).
    const createdAt = post.event.created_at + reactionDelaySec(b * 2.1 + 53, 18, 9)
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
  // Alvos: 3 posts distintos, fora do hot/bury (índices crescentes). full
  // usa 200/210/220; lite escolhe 3 posts perto do fim do bloco de conteúdo
  // (ainda dentro de 0..contentPosts-1), distintos entre si.
  const reportTargets =
    mode === 'full'
      ? [contentPosts[200]!, contentPosts[210]!, contentPosts[220]!]
      : [
          contentPosts[TOTAL_CONTENT_POSTS - 3]!,
          contentPosts[TOTAL_CONTENT_POSTS - 2]!,
          contentPosts[TOTAL_CONTENT_POSTS - 1]!,
        ]
  let reportCount = 0
  // Reporters preferencialmente "pesados" (named + seeds antigos) pra
  // garantir soma de pesos ≥ threshold. Os 8 named bastam pra cruzar
  // ('illegal'=3, 'spam'=5); seeds antigos só reforçam. lite usa só os
  // named (seeds 35/40 não estão no subset ativo).
  const heavyReporters: SeedIdentity[] =
    mode === 'full'
      ? [
          ...NAMED_IDENTITIES, // 8 named (antiguidade alta → peso ≥ 1.0)
          SEED_IDENTITIES[35]!, // bg-35 (weeksOld = (35*7)%41 = 8) — médio
          SEED_IDENTITIES[40]!, // bg-40 ((40*7)%41 = 28 wk) — alto
        ]
      : [...NAMED_IDENTITIES] // 8 named: spam(5) cruza com 8 reporters ≥0.5
  for (let t = 0; t < reportTargets.length; t++) {
    const target = reportTargets[t]!
    // alvo 0 + 1 usam 'illegal' (threshold 3, cruza fácil); alvo 2 'spam'.
    const reason: ReportReason = t < 2 ? 'illegal' : 'spam'
    const reportersForTarget = t < 2 ? 8 : heavyReporters.length
    for (let r = 0; r < reportersForTarget; r++) {
      const reporter = heavyReporters[r % heavyReporters.length]!
      if (reporter.pub === target.authorPub) continue
      // Reports chegam APÓS o post-alvo (causalidade), escalonados por hora
      // (denúncias pingam ao longo de ~1 dia, não num instante).
      const createdAt =
        target.event.created_at + reactionDelaySec(r * 4.1 + t * 31 + 17, 6, 3) + r * HOUR
      domain.push(signReport(reporter, target.event.id, target.authorPub, reason, createdAt))
      reportCount++
    }
  }

  // 8. Contact lists (NIP-02 kind 3) — follows de todas as identidades
  //    que TÊM follows. Aplicados fora do pipeline de score (§24).
  for (const id of activeIdentities) {
    if (id.follows.length === 0) continue
    contactLists.push(signContactList(id, id.createdAt + 60 + delta))
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
 * Conjunto materializado uma vez por modo (pure, cacheável).
 *
 * `full` (default): fast path — carrega o JSON committed se presente; senão
 * constrói em memória (assina ~2730 eventos, ~24s). Ambos bit-idênticos (§7).
 *
 * `lite`: SEMPRE constrói em memória (~200 eventos assinam em <2s; o artefato
 * pré-serializado só cobre full). Cacheado separadamente.
 */
let _cached: SeedEventSet | null = null
let _cachedLite: SeedEventSet | null = null
export function getSeedEvents(mode: SeedMode = 'full'): SeedEventSet {
  if (mode === 'lite') {
    if (!_cachedLite) _cachedLite = buildSeedEvents('lite')
    return _cachedLite
  }
  if (!_cached) _cached = loadGeneratedSeed() ?? buildSeedEvents('full')
  return _cached
}

// ─── Digest determinístico (LOCK_VIA_TEST anti-drift) ───────────────
//
// sha256 sobre todos os event.id ordenados. Muda se: seeds mudam,
// nostr-tools getEventHash muda, ou a composição dos eventos muda.

export function computeSeedDigest(mode: SeedMode = 'full'): string {
  const set = getSeedEvents(mode)
  const ids = [
    ...set.contactLists.map((e) => e.id),
    ...set.domain.map((e) => e.id),
  ].sort()
  return bytesToHex(sha256(new TextEncoder().encode(ids.join('|'))))
}
