/**
 * onNostrEvent — o ÚNICO ponto de escrita em tabelas de domínio
 * (posts, spreads, buries, reports, comments).
 *
 * Recebe eventos do subscribe (que inclui os próprios eventos publicados
 * pelo cliente, devolvidos pelos relays) e materializa estado local.
 *
 * Idempotente: INSERT OR IGNORE garante que processar o mesmo evento
 * N vezes não duplica linhas.
 *
 * ─── Pipeline (ordem importa para performance) ──────────────────────
 *
 *   1. Cheap kind check       (KIND_DISPATCH lookup, O(1))
 *   2. Cheap schema check     (handler.validate — tag lookup, JSON.parse só p/ POST)
 *   3. Caro: verify Schnorr   (~1ms/evento — só rodar no que vai ficar)
 *   4. Persist (handler.persist — upsert idempotente + invalidateFeed + scheduleRankingRecompute)
 *
 * Em situações onde N% do tráfego é não-Drift, descartamos antes do
 * verify — economia significativa.
 *
 * Despacho via `KIND_DISPATCH` (lookup table estática). Adicionar kind
 * novo: registra entry em `KIND_DISPATCH` + escreve `validate*` +
 * `persist*` corresponding (todos neste arquivo, invariante #1).
 */

import type { SignedEvent } from '../types/nostr'
import { db } from './db'
import { getTag } from './nostr'
import { verifyEventAsync } from './verify'
import {
  DRIFT_KIND,
  MAX_FUTURE_SKEW_SECONDS,
  MODERATED_SCORE,
  MS_PER_DAY,
  REPORT_DECAY_HALF_LIFE_MS,
  SCORE_RECALC_DEBOUNCE_MS,
  VIRAL_PIN_THRESHOLD,
} from '../config/constants'
import { bumpUnseenCount, invalidateFeed } from './feed'
import { computeRanking, type RankingAction, type RankingReport } from './ranking'
import { requestAnchorsFor, requestMissingEvents } from './orphans'
import { bumpCommentCount } from './comment-counts'
import { addCommentToStore } from './comments'
import { parseImetaTags } from './nip94'
import { bumpProfileVersion } from './profiles'
import { yieldToMain } from './scheduler'
import type { CommentRecord, ContentWarning, ReportReason } from '../types/drift'

/**
 * Kind 1111 — NIP-22 comments. Não vive em DRIFT_KIND porque não é
 * proprietário; Drift reusa pra threads (Track C, manifesto §29).
 */
export const NIP22_COMMENT_KIND = 1111

/**
 * NIP-03 — prova OpenTimestamps de um evento (content = arquivo .ots em
 * base64, tag `e` = evento carimbado, tag `k` = kind dele). É a âncora de
 * antiguidade das identidades (`ranking.ts`): Bitcoin prova que o evento
 * existia no bloco H, então a chave existia desde então.
 */
export const OTS_ATTESTATION_KIND = 1040

/** Kinds cujas provas OTS interessam ao Drift (filtro `#k` do sync). */
export const OTS_TARGET_KINDS: string[] = ['9078', '9079', '9080', '9081', '1111']

/** Teto do content base64 de uma prova (provas reais têm ~1-5 KB). */
const OTS_PROOF_MAX_B64 = 16_384

/**
 * KIND_DISPATCH — lookup table que separa "qual handler usar" de
 * "código do handler" (Ted contraproposta middle-ground ao RFC do
 * Robin sobre registry pluggable, sessão 2026-05-08).
 *
 * Ganho central: elimina os DOIS switches paralelos (`passesSchemaCheck`
 * + `switch` no `onNostrEvent`) que precisavam ficar em sync. Adicionar
 * kind novo agora exige tocar 1 entrada nesta tabela em vez de 2 cases
 * em arquivos diferentes do mesmo módulo. Drift entre máquinas de
 * dispatch desaparece por construção.
 *
 * Restrições deliberadas (NÃO é registry pluggable):
 *  - Tabela ESTÁTICA. Sem `register()` em runtime. Sem hot-loading.
 *    Manifesto §17 (sem chave mestra disfarçada): cliente oficial não
 *    aceita plugin de moderação/scan; por extensão, dispatcher é
 *    fechado.
 *  - Handlers vivem TODOS dentro deste arquivo (`src/lib/events.ts`).
 *    invariante #1 (única porta SQLite domínio) + conformance
 *    test em `tests/manifesto-conformance.test.ts:655-679` validam path
 *    literal — extrair handler pra outro arquivo viola conformance.
 *  - Pipeline cheap→expensive→persist→recalc→invalidate (*    invariante #5) preservado em `onNostrEvent`. Handler só implementa
 *    seus passos; pipeline é centralizado.
 *
 * Migração futura pra registry full (RFC Robin §2): trivial. Quando
 * kind 9082 (boost pago, manifesto §18) entrar e a tabela tiver 6+
 * entries com pipeline idêntico, trocar `Record<number, KindHandler>`
 * por `new Map<number, KindHandler>` + `register()` é alteração local
 * sem tocar handlers ou pipeline. Primeira separação ("qual handler"
 * vs "código do handler") já está feita aqui.
 */
interface KindHandler {
  /** Nome legível pra debugging — corresponde ao kind do protocolo. */
  name: string
  /**
   * Validação cheap, ANTES de `verifyEventAsync`. Sem db, sem await
   * (invariante #5 — manter ordem cheap→expensive). Pode ler
   * tags + `JSON.parse(content)`. Retorna `false` pra rejeitar
   * silenciosamente (manifesto §29 — cliente não fala com atacante).
   */
  validate(event: SignedEvent): boolean
  /**
   * Persiste no SQLite. Roda APÓS `verifyEventAsync` ter passado.
   * DEVE ser idempotente (`INSERT OR IGNORE`). Responsável por chamar
   * `invalidateFeed()` e `scheduleRankingRecompute()` quando o evento
   * afeta ranking (post, spread, bury, comment, report, prova OTS).
   *
   * `deferSideEffects` (default false): quando true, o handler PERSISTE
   * normalmente (INSERT + updateUserActivity) mas SUPRIME os side-effects
   * pós-persist `scheduleRankingRecompute()` + `invalidateFeed()`. Usado
   * pelo dev-seed (`lib/dev-seed/seed.ts`) pra drenar milhares de eventos
   * sem disparar uma storm de recalc/invalidate por evento — o caller faz
   * 1 `recalcAllScores()` + 1 `invalidateFeed()` no fim. Determinismo §7
   * preservado: bulk recalc no fim = mesmo score (scoring puro + INSERT OR
   * IGNORE idempotente). O persist em si (invariante #1) NUNCA é adiado.
   */
  persist(event: SignedEvent, deferSideEffects: boolean): Promise<void>
}

/**
 * Opções de `onNostrEvent`. `deferSideEffects` adia recalc + invalidate
 * (ver `KindHandler.persist`). Default false — sync real intacto.
 *
 * `skipVerify` (default false) — pula APENAS o passo 3 do pipeline
 * (verify Schnorr, o ÚNICO passo caro). Os cheap checks (kind/schema,
 * passos 1-2) PERMANECEM como defesa contra fixture malformada. Usado
 * EXCLUSIVAMENTE pelo dev-seed (`lib/dev-seed/seed.ts`): seus eventos são
 * self-signed por `finalizeEvent` nos próprios fixtures — verificar
 * Schnorr de evento que NÓS acabamos de assinar é desperdício puro
 * (cada verify = postMessage round-trip ao verify.worker ~20ms; ×2730
 * eventos seriais ≈ minutos de boot dev). Invariante #5 existe pra
 * proteger contra eventos UNTRUSTED da rede; seed DEV é trusted input.
 *
 * **DEV-gate duro (segurança)**: `skipVerify` só é honrado se
 * `import.meta.env.DEV`. Em produção é IGNORADO — verify SEMPRE roda,
 * mesmo que algum caller passe `skipVerify: true`. Sync real (relays,
 * WebRTC) NUNCA passa skipVerify → eventos da rede são sempre
 * verificados. LOCK_VIA_TEST em `tests/events-dispatch.test.ts`.
 *
 * Determinismo §7 intacto: verify não toca os dados persistidos —
 * skip = mesmo resultado materializado, só sem o round-trip.
 */
export interface OnNostrEventOptions {
  deferSideEffects?: boolean
  skipVerify?: boolean
}

const KIND_DISPATCH: Readonly<Record<number, KindHandler>> = {
  [DRIFT_KIND.POST]: {
    name: 'POST',
    validate: validatePostShape,
    persist: persistPost,
  },
  [DRIFT_KIND.SPREAD]: {
    name: 'SPREAD',
    validate: validateSpreadShape,
    persist: persistSpread,
  },
  [DRIFT_KIND.BURY]: {
    name: 'BURY',
    validate: validateBuryShape,
    persist: persistBury,
  },
  [DRIFT_KIND.REPORT]: {
    name: 'REPORT',
    validate: validateReportShape,
    persist: persistReport,
  },
  [NIP22_COMMENT_KIND]: {
    name: 'COMMENT',
    validate: validateCommentShape,
    persist: persistCommentRow,
  },
  // NIP-03 — prova OpenTimestamps (âncora de antiguidade, auditoria
  // 2026-11-03). Persistida como 'pending'; a verificação contra headers
  // Bitcoin é assíncrona (`ots-anchors.ts`) porque precisa de rede.
  [OTS_ATTESTATION_KIND]: {
    name: 'OTS_ATTESTATION',
    validate: validateOtsAttestationShape,
    persist: persistOtsAttestation,
  },
  // Kind 0 NIP-01 — profile metadata (opt-in identity).
  // Replaceable event: ingestão LWW por created_at. NUNCA participa de
  // score/weight (LOCK_VIA_TEST). Manifesto §5.3 / §28.
  0: {
    name: 'METADATA',
    validate: validateKind0Shape,
    persist: persistUserMetadata,
  },
  // Kind 1984 NIP-56 — report (compat Damus/Snort/Iris). Espelha
  // semântica do 9081 Drift native. Dedup LWW cross-kind por
  // (post_id, reporter_pub). Mapeamento de reason via
  // `lib/nip56-mapping.ts`. Manifesto §29 compat Nostr.
  1984: {
    name: 'NIP56_REPORT',
    validate: validateNip56ReportShape,
    persist: persistNip56Report,
  },
}

// ─── Write sink (dev-seed batch) ─────────────────────────────────────
//
// Por default, cada write de domínio (`runWrite`) vai DIRETO ao worker via
// `db.run` (1 postMessage/roundtrip). O dev-seed drena ~2730 eventos × ~2
// writes = ~5500 roundtrips serializados → minutos (drain floor). Quando
// `writeSink` é setado (só pelo seed, DEV), os writes são DESVIADOS pra um
// buffer; o seed os flusha em lotes via `db.batch` (1 transação, 1 roundtrip
// por lote). Mesmas statements, mesma ordem → estado idêntico (invariante #1
// preservado: writes ainda nascem de onNostrEvent→persist*). Sync real
// (relays/WebRTC) NUNCA seta sink → comportamento direto intacto.
//
// Nenhum persist* lê o banco antes de escrever desde a recomputação global
// (ranking.ts) — pesos/moderação são derivados no fim, sobre o conjunto.
// O seed flusha no boundary de cada batch; como o domain é ordenado por
// created_at ASC e reports vêm por último, os users dos reporters (genesis,
// primeiros) já foram flushados quando os reports são processados.
let writeSink: ((sql: string, params: unknown[]) => void) | null = null

/** Liga/desliga o desvio de writes pro buffer do seed (DEV). null = direto. */
export function setWriteSink(fn: ((sql: string, params: unknown[]) => void) | null): void {
  writeSink = fn
}

/** Write de domínio: bufferiza (seed) ou vai direto ao worker (default). */
function runWrite(sql: string, params: unknown[]): Promise<void> {
  if (writeSink) {
    writeSink(sql, params)
    return Promise.resolve()
  }
  return db.run(sql, params)
}

export async function onNostrEvent(
  event: SignedEvent,
  options?: OnNostrEventOptions,
): Promise<void> {
  // 1. Cheap: kind check (Record lookup, O(1)). Kinds desconhecidos
  //    (incluindo qualquer non-Drift, non-NIP-22-comment) são noop.
  //    SYNC — antes do primeiro `await` pra preservar invariante #5
  //    (cheap antes de qualquer round-trip caro).
  const handler = KIND_DISPATCH[event.kind]
  if (!handler) return

  // 1b. Cheap: teto de relógio. `created_at` no futuro além da tolerância
  //     é descartado — ver `MAX_FUTURE_SKEW_SECONDS`. Também rejeita
  //     não-inteiros/NaN, que propagariam NaN pro score e pro cursor.
  if (!isAcceptableCreatedAt(event.created_at, Math.floor(Date.now() / 1000))) return

  // 2. Cheap: schema check (sem db, sem crypto). SYNC pela mesma razão.
  if (!handler.validate(event)) return

  // 3. Expensive: signature check (~1ms NO WORKER + ~0.1-0.3ms postMessage
  //    round-trip). Off-main-thread via `verify.worker.ts` — Ted RFC
  //    2026-05 + Barney threat model 2026-05-16. Pipeline cheap→caro
  //    preservado: o `await` aqui só dispara após kind+schema sync.
  //    Worker init falha lança Error (Barney P1.5, sem fallback sync).
  //
  //    EXCEÇÃO DEV-seed-only (Ted+Marshall 2026-05-28): `skipVerify`
  //    pula este passo CARO pra fixtures self-signed do dev-seed. DEV-gate
  //    DURO `import.meta.env.DEV` — em prod o skip é IGNORADO e verify
  //    SEMPRE roda, mesmo se o caller passar a flag. Eventos da rede
  //    (sync.ts/WebRTC) NUNCA passam skipVerify → sempre verificados.
  //    Os cheap checks (kind/schema, passos 1-2) acima PERMANECEM mesmo
  //    com skip — defesa contra fixture malformada. Invariante #5.
  const skipVerify = (options?.skipVerify ?? false) && import.meta.env.DEV
  if (!skipVerify && !(await verifyEventAsync(event))) return

  // 4. Persist (handler decide INSERT + invalidateFeed + recalc).
  //    Pipeline preservado: invariantes #1, #5, #6.
  //    `deferSideEffects` (default false) adia recalc/invalidate pós-persist
  //    — caller bulk-aware (dev-seed) consolida no fim.
  await handler.persist(event, options?.deferSideEffects ?? false)
}

/**
 * `created_at` aceitável: inteiro não-negativo e no máximo
 * `MAX_FUTURE_SKEW_SECONDS` à frente de `nowSec`. Pura — exportada pra
 * teste e pra `sync.ts` aplicar a mesma regra ao cursor.
 */
export function isAcceptableCreatedAt(createdAt: number, nowSec: number): boolean {
  return (
    Number.isSafeInteger(createdAt) &&
    createdAt >= 0 &&
    createdAt <= nowSec + MAX_FUTURE_SKEW_SECONDS
  )
}

// ─── Schema check (cheap, before verify) ─────────────────────────────

const HEX_64 = /^[0-9a-f]{64}$/i

function isHex64(v: string | null): boolean {
  return v !== null && HEX_64.test(v)
}

/**
 * Cheap schema check antes de verify. Exportado pra teste — em runtime
 * só `onNostrEvent` usa (via `KIND_DISPATCH[kind].validate`).
 *
 * Mantida como API pública pra preservar tests existentes (`tests/
 * schemaCheck.test.ts` + `tests/comments-persist.test.ts`). Internamente
 * delega pra `KIND_DISPATCH` — fonte única de verdade pós-refactor.
 */
export function passesSchemaCheck(event: SignedEvent): boolean {
  return KIND_DISPATCH[event.kind]?.validate(event) ?? false
}

// ─── Validators (cheap, sync, sem db nem crypto) ────────────────────

/**
 * NIP-01: kind 9078 é regular event (faixa 1..9999). `d` tag não tem
 * semântica protocolar aqui — identificador é `event.id`. Drift exige
 * apenas `drift-version` pra distinguir do resto do tráfego Nostr.
 */
function validatePostShape(event: SignedEvent): boolean {
  if (!getTag(event, 'drift-version')) return false
  try {
    const parsed = JSON.parse(event.content) as { subposts?: unknown }
    if (!Array.isArray(parsed.subposts)) return false
    // Satoshi devsec audit 2026-05-20 (Gap C — NOP event filtering):
    // POST com subposts=[] é NOP — sem payload útil, mas atualiza
    // `users.last_active` via persistPost→updateUserActivity. Vetor de
    // Sybil farming pra resetar inactivity decay. Rejeitar no schema
    // gate impede o evento de chegar no pipeline (sem persist row, sem
    // updateUserActivity, sem ruído). Cliente Drift oficial nunca cria
    // POST sem subposts; atacante que tenta é detectado aqui.
    if (parsed.subposts.length === 0) return false
  } catch {
    return false
  }
  return true
}

/**
 * NIP-01: tag `e` é event.id em hex 64. nostr-tools rejeita formato
 * errado já no _onmessage do relay; descartamos aqui também por
 * defesa-em-profundidade (relay sem validação não derruba o cliente).
 */
function validateSpreadShape(event: SignedEvent): boolean {
  return isHex64(getTag(event, 'e'))
}

/** Mesma regra de SPREAD — kind 9080 também referencia post via tag `e`. */
function validateBuryShape(event: SignedEvent): boolean {
  return isHex64(getTag(event, 'e'))
}

/**
 * REPORT exige `e` hex 64 + tag `reason`. Reason inválida cai no
 * fallback `'spam'` em `persistReport` — schema só rejeita se ausente.
 */
function validateReportShape(event: SignedEvent): boolean {
  return isHex64(getTag(event, 'e')) && getTag(event, 'reason') !== null
}

/**
 * NIP-03: `e` hex 64 + content base64 não-vazio e limitado. A prova em
 * si (parse + Bitcoin) só é checada depois, fora do caminho quente.
 */
function validateOtsAttestationShape(event: SignedEvent): boolean {
  if (!isHex64(getTag(event, 'e'))) return false
  const c = event.content
  return (
    typeof c === 'string' &&
    c.length > 0 &&
    c.length <= OTS_PROOF_MAX_B64 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(c)
  )
}

/**
 * NIP-22 exige: tag E maiúscula (root) + e minúscula (parent direto)
 * ambas com event.id hex 64. content é texto plain (NIP-22 não exige
 * formato; cap de 1000 chars é convenção Drift — comentário maior é
 * rejeitado pra evitar inflar relays e atacar UI).
 */
function validateCommentShape(event: SignedEvent): boolean {
  return passesNip22SchemaCheck(event)
}

/**
 * NIP-01 kind 0: content é JSON com campos opcionais. Drift aceita o
 * subset whitelisted (KIND_0_ALLOWED_KEYS). Cap defensivo de 4 KB no
 * content cru pra evitar payloads ridículos.
 *
 * Rejeita silenciosamente (manifesto §29) se:
 * - content não é JSON válido
 * - parsed não é objeto
 * - content > 4096 chars
 */
function validateKind0Shape(event: SignedEvent): boolean {
  if (event.content.length > 4096) return false
  try {
    const parsed = JSON.parse(event.content)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * NIP-56 kind 1984 report: spec exige tag `e` (event_id hex 64) com
 * report_type opcional no index [3] OU tag separada. Drift parsing
 * extrai do `e` (preferido) ou `p`. Tag `drift-version` opcional —
 * marca emit pelo cliente Drift; ingestão remota (Damus etc.) não
 * precisa dela.
 *
 * Rejeita se:
 * - falta tag `e` válida
 * - report_type extraído não está no whitelist NIP-56 (7 valores)
 */
function validateNip56ReportShape(event: SignedEvent): boolean {
  const e = getTag(event, 'e')
  if (!isHex64(e)) return false
  const reportType = extractNip56ReportType(event)
  return reportType !== null
}

/**
 * Extrai NIP-56 report_type de um event 1984.
 * NIP-56 spec: report_type é index [3] de `e` ou `p` tag.
 * Returns null se não found ou inválido.
 */
function extractNip56ReportType(event: SignedEvent): string | null {
  for (const tag of event.tags) {
    if ((tag[0] === 'e' || tag[0] === 'p') && tag.length >= 4 && typeof tag[3] === 'string') {
      return tag[3]
    }
  }
  return null
}

// ─── NIP-22 schema/parse (puro, testável) ───────────────────────────

/** Cap em chars de content de comment (Drift convention, NIP-22 não exige). */
export const COMMENT_MAX_CHARS = 1000

/**
 * Parsing puro de tags NIP-22. Retorna estrutura normalizada ou `null`
 * se faltar tag obrigatória / hex inválido. SEM I/O — testável sem db.
 *
 * Tags maiúsculas (`E`/`K`/`P`) = root marker (NIP-22). Tags minúsculas
 * (`e`/`k`/`p`) = direct parent. Drift exige ambos os pares; se cliente
 * NIP-22 emite reply top-level com root === parent, repetir as duas
 * variants (E + e ambas iguais ao post.id) é a forma compliant.
 */
export interface ParsedNip22Comment {
  /** root post.id (E) — kind 9078 do post Drift */
  rootEventId: string
  /** root kind (K) — esperamos '9078' pra Drift */
  rootKind: string
  /** root author pubkey (P) */
  rootPubkey: string
  /** direct parent id (e). Se top-level reply, igual a rootEventId. */
  parentEventId: string
  /** direct parent kind (k). '9078' top-level, '1111' nested. */
  parentKind: string
  /** direct parent author pubkey (p) */
  parentPubkey: string
}

export function parseNip22Comment(event: SignedEvent): ParsedNip22Comment | null {
  let E: string[] | null = null
  let K: string[] | null = null
  let P: string[] | null = null
  let e: string[] | null = null
  let k: string[] | null = null
  let p: string[] | null = null
  for (const tag of event.tags) {
    if (tag[0] === 'E' && E === null) E = tag
    else if (tag[0] === 'K' && K === null) K = tag
    else if (tag[0] === 'P' && P === null) P = tag
    else if (tag[0] === 'e' && e === null) e = tag
    else if (tag[0] === 'k' && k === null) k = tag
    else if (tag[0] === 'p' && p === null) p = tag
  }
  if (!E || !K || !P || !e || !k || !p) return null
  const rootEventId = E[1] ?? ''
  const rootKind = K[1] ?? ''
  const rootPubkey = P[1] ?? ''
  const parentEventId = e[1] ?? ''
  const parentKind = k[1] ?? ''
  const parentPubkey = p[1] ?? ''
  if (!isHex64(rootEventId)) return null
  if (!isHex64(rootPubkey)) return null
  if (!isHex64(parentEventId)) return null
  if (!isHex64(parentPubkey)) return null
  if (rootKind.length === 0 || parentKind.length === 0) return null
  return {
    rootEventId,
    rootKind,
    rootPubkey,
    parentEventId,
    parentKind,
    parentPubkey,
  }
}

/**
 * Schema check NIP-22 (puro). Cobre:
 * - Estrutura mínima (parser não-null)
 * - Drift extensions exigidas (drift-version)
 * - Sanity: rootKind == '9078' (Drift só aceita comments em posts Drift —
 *   reply em outros kinds Nostr ainda é NIP-22 válido mas fora do escopo
 *   deste cliente; será descartado silenciosamente)
 * - content non-empty + ≤ COMMENT_MAX_CHARS
 */
export function passesNip22SchemaCheck(event: SignedEvent): boolean {
  if (!getTag(event, 'drift-version')) return false
  if (typeof event.content !== 'string') return false
  if (event.content.length === 0) return false
  if (event.content.length > COMMENT_MAX_CHARS) return false
  const parsed = parseNip22Comment(event)
  if (!parsed) return false
  if (parsed.rootKind !== String(DRIFT_KIND.POST)) return false
  return true
}

// ─── Persist handlers ────────────────────────────────────────────────

/**
 * Set de event.id de POSTs já vistos pelo onNostrEvent — usado pra
 * detectar insert genuíno (cross-relay dedup) sem requerer change-count
 * do db.run. INSERT OR IGNORE não expõe se realmente inseriu, então
 * gate-amos o `bumpUnseenCount` por este set local.
 *
 * Cresce monotonicamente durante a sessão. Em cenário típico (1k posts
 * por sessão), ~64 bytes × 1000 = 64KB — desprezível. Reset implícito
 * em reload da app (`location.reload()`).
 *
 * Cap defensivo de 10k entries: posts além disso são raros mas
 * possíveis em rebuild full; limit evita crescimento ilimitado em
 * sessions de horas. FIFO drop quando atinge cap (re-incrementa OK).
 */
const SEEN_POST_IDS_CAP = 10_000
const seenPostIds = new Set<string>()

async function persistPost(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  // posts.id = event.id (hex 64). Antes usávamos uma UUID na tag `d`,
  // mas isso violava NIP-01 quando o id era referenciado em `e` por
  // SPREAD/BURY/REPORT (tag `e` exige hex 64). Agora `event.id` é a
  // identidade canônica do post — local e na rede.
  const postId = event.id
  const isFirstSeen = !seenPostIds.has(postId)
  await runWrite(
    `INSERT OR IGNORE INTO posts
     (id, author_pub, content, created_at, category, location, client, content_warning, raw_event, score, spreads, buries)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
    [
      postId,
      event.pubkey,
      event.content,
      event.created_at,
      getTag(event, 'category'),
      serializeLocation(event),
      getTag(event, 'client'),
      getTag(event, 'content-warning'),
      JSON.stringify(event),
    ],
  )
  if (isFirstSeen) {
    if (seenPostIds.size >= SEEN_POST_IDS_CAP) {
      // FIFO drop — Set preserva ordem de inserção
      const oldest = seenPostIds.values().next().value
      if (oldest) seenPostIds.delete(oldest)
    }
    seenPostIds.add(postId)
    bumpUnseenCount()
  }
  await updateUserActivity(event.pubkey, event.created_at)
  // post novo: feed precisa aparecer no topo (score 0 + recente)
  if (deferSideEffects) return // dev-seed: bulk recalc + invalidate no fim
  invalidateFeed()
  scheduleRankingRecompute()
}

async function persistSpread(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  const postId = getTag(event, 'e')!
  await runWrite(
    // LWW por (post_id, spreader_pub): guarda o spread MAIS RECENTE.
    // Antes era `INSERT OR IGNORE`, que guardava o PRIMEIRO a chegar —
    // spread→bury→spread contava bury, e a mesma rede de eventos dava
    // scores diferentes conforme a ordem de chegada (auditoria
    // 2026-11-03, A1/A2). Empate de created_at: menor event_id vence,
    // determinístico entre clientes.
    `INSERT INTO spreads
     (post_id, spreader_pub, created_at, location, event_id, raw_event)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(post_id, spreader_pub) DO UPDATE SET
       created_at = excluded.created_at,
       location   = excluded.location,
       event_id   = excluded.event_id,
       raw_event  = excluded.raw_event
     WHERE excluded.created_at > spreads.created_at
        OR (excluded.created_at = spreads.created_at AND excluded.event_id < spreads.event_id)`,
    [postId, event.pubkey, event.created_at, serializeLocation(event), event.id, JSON.stringify(event)],
  )
  await updateUserActivity(event.pubkey, event.created_at)
  // invalidateFeed direto + recomputação agendada.
  //
  // Por que invalidar AQUI também (e não só após a recomputação): se
  // este cliente recebeu o spread ANTES do post (race comum em feeds que
  // sincronizam de relays diferentes), a recomputação não tem linha de
  // post pra atualizar (e pede o post por id, `orphans.ts`). UI ficaria desatualizada
  // até o post chegar (eventualmente). Invalidar aqui garante que
  // quando o getMyAction do useEffect roda, encontra o spread persistido
  // e limpa o pending optimistic. Manifesto §6 (Verdade por Eventos).
  if (deferSideEffects) return // dev-seed: bulk recalc + invalidate no fim
  invalidateFeed()
  scheduleRankingRecompute()
  // Track B.2 — "favorito = mirror automático" (RFC §5.3, manifesto §16).
  // Quando o user atual emite SPREAD em um post, cliente pina o blob
  // local. Best-effort, fire-and-forget — falha não derruba o spread.
  void maybeAutoPinBlobs(event.pubkey, postId)
}

/**
 * Track B.2.d — auto-pin de blobs quando o user atual espalha um post.
 * RFC §5.3: "Espalhar = mirror" é semântica Drift (não NIP-94). Disparado
 * só quando `spreaderPub === active identity`; spreads de outros usuários
 * não nos forçam a hospedar.
 *
 * Best-effort: se o post ainda não chegou (race spread-antes-do-post),
 * sem imeta tags ou Helia indisponível, log e segue. Pin é opt-in via
 * ação social explícita (manifesto §22 — pin não é score-driven).
 */
async function maybeAutoPinBlobs(spreaderPub: string, postId: string): Promise<void> {
  try {
    const { getCurrentNpub } = await import('./identity')
    const myNpub = await getCurrentNpub()
    if (!myNpub || myNpub !== spreaderPub) return // não fui eu — não pino

    // Lookup do raw_event do post pra extrair tags `imeta`. Se o post
    // ainda não chegou (race), `row` é undefined → silently skip.
    const row = await db.get<{ raw_event: string }>(
      `SELECT raw_event FROM posts WHERE id = ?`,
      [postId],
    )
    if (!row) return

    const parsedEvent = JSON.parse(row.raw_event) as SignedEvent
    const { parseImetaTags } = await import('./nip94')
    const metas = parseImetaTags(parsedEvent)
    if (metas.length === 0) return // post sem blobs ou pré-RFC (sem imeta)

    const { pinBlobsFromMeta } = await import('./blobs')
    await pinBlobsFromMeta(metas)
  } catch (err) {
    console.warn('[events] auto-pin falhou (degraded):', err)
  }
}

async function persistBury(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  const postId = getTag(event, 'e')!
  await runWrite(
    // LWW — mesma regra de `persistSpread`.
    `INSERT INTO buries
     (post_id, burier_pub, created_at, event_id, raw_event)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(post_id, burier_pub) DO UPDATE SET
       created_at = excluded.created_at,
       event_id   = excluded.event_id,
       raw_event  = excluded.raw_event
     WHERE excluded.created_at > buries.created_at
        OR (excluded.created_at = buries.created_at AND excluded.event_id < buries.event_id)`,
    [postId, event.pubkey, event.created_at, event.id, JSON.stringify(event)],
  )
  await updateUserActivity(event.pubkey, event.created_at)
  if (deferSideEffects) return // dev-seed: bulk recalc + invalidate no fim
  invalidateFeed() // mesmo motivo de persistSpread — race spread-antes-do-post
  scheduleRankingRecompute()
  // bury NÃO penaliza o autor — diferença filosófica central
}

/**
 * Persiste comment NIP-22 (kind 1111). PRIVADO — única porta de INSERT
 * da tabela `comments` é `onNostrEvent` via este helper (* invariante #1).
 *
 * Sanity check (Barney HIGH #1): apesar do parser NIP-22 dar uma
 * estrutura aparentemente válida, atacante pode forjar pares onde
 * `E` (root) ≠ `e` (parent direto) **resolvido**. Aqui resolvemos a
 * raiz da thread:
 *
 *  - parent `k === '9078'` ⇒ reply top-level; `e` deve apontar pro
 *    mesmo post.id da tag `E` (caso contrário, atacante anexa reply
 *    cross-post pra free-ride visibilidade do post X reportando
 *    como root o post Y).
 *  - parent `k === '1111'` ⇒ reply nested; `e` aponta pra outro
 *    comment, mas esse comment DEVE pertencer ao mesmo `post_id`
 *    declarado em `E`. Se ainda não chegou (race), aceitamos
 *    optimistically — buildThread (futuro) trata órfãos. Atacante
 *    que envia comment com parent inexistente fica preso ao post_id
 *    declarado; quando real parent chegar, ou bate ou atacante já
 *    falhou.
 *
 * Reject silently (não lança) — manifesto §29 (cliente não fala com
 * atacante; só descarta).
 */
async function persistCommentRow(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  const parsed = parseNip22Comment(event)
  if (!parsed) return // schema check já rejeitou, defesa em camada

  // Sanity #1: top-level reply (parent kind = post kind) — `e` DEVE === `E`
  // Sem isso, atacante anexa replies cross-post free-riding visibilidade.
  if (parsed.parentKind === String(DRIFT_KIND.POST)) {
    if (parsed.parentEventId !== parsed.rootEventId) return
    if (parsed.parentPubkey !== parsed.rootPubkey) return
  }
  // (Para parent kind=1111, deferimos: parent comment pode não ter chegado
  // ainda — Drift aceita órfãos. buildThread no read path resolve.)

  // C.6.2 — content-warning declarado pelo autor (manifesto §27, NIP-36
  // reuse). Persistido pra UI aplicar blur/hide via applyContentFilters
  // sem reparsing do raw_event. imeta tags ficam só no raw_event — read
  // path (loadThread/addCommentToStore) parseia uma vez.
  await db.run(
    `INSERT OR IGNORE INTO comments
     (id, post_id, reply_to, author_pub, content, created_at, raw_event, score, content_warning)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      event.id,
      parsed.rootEventId,
      parsed.parentEventId,
      event.pubkey,
      event.content,
      event.created_at,
      JSON.stringify(event),
      getTag(event, 'content-warning'),
    ],
  )
  await updateUserActivity(event.pubkey, event.created_at)
  if (deferSideEffects) return // dev-seed: bulk recalc + invalidate no fim
  // Track C.6.1: count prefetch. Idempotente cross-relay via dedup
  // interno por commentId. UI consome via `useCommentCountsStore`.
  bumpCommentCount(parsed.rootEventId, event.id)
  // V9.11 (user report 2026-05-09: "quando eu comento, tenho que
  // fechar e abrir pra ver"): addCommentToStore estava documentado
  // mas NUNCA chamado. Comments persistiam no SQLite via INSERT mas
  // o useThreadStore ficava stale até loadThread re-query (que só
  // dispara em mount do ThreadView). Wire-up direto aqui — única
  // porta de domínio também é a única que mexe na store reativa.
  // Idempotente: addCommentToStore dedup por id; ignora se thread
  // não está carregada.
  try {
    const metas = parseImetaTags(event)
    const cwTag = getTag(event, 'content-warning')
    const record: CommentRecord = {
      id: event.id,
      postId: parsed.rootEventId,
      replyTo: parsed.parentEventId,
      authorPub: event.pubkey,
      content: event.content,
      createdAt: event.created_at,
      score: 0,
      contentWarning: (cwTag as ContentWarning | null | undefined) ?? null,
      ...(metas.length > 0 && metas[0] ? { meta: metas[0] } : {}),
    }
    addCommentToStore(parsed.rootEventId, record)
  } catch (err) {
    console.warn('[events] addCommentToStore failed (non-fatal):', err)
  }
  // Track C.5: comments entram no NUMERADOR do score do post recebedor
  // (`ranking.ts`, ponderados pelo peso do commenter, cap
  // COMMENTS_SCORE_CAP) — e portanto na ordem do feed. Self-comments e
  // comments moderados não contam (Barney HIGH #3).
  scheduleRankingRecompute()
}

/**
 * Upsert LWW de report por (post_id, reporter_pub). Comum a 9081 e 1984
 * (dedup cross-kind). Guarda o report MAIS RECENTE — reporter pode mudar
 * o motivo. Empate de created_at: menor `kind` (9081 nativo antes de 1984
 * só por ordem numérica) — determinístico.
 *
 * `weight` é gravado 0: a coluna é legado. Os pontos do report são
 * derivados do peso ATUAL do reporter dentro de `ranking.ts` a cada
 * recomputação — antes eram congelados no instante da ingestão, com o
 * peso que ESTE cliente achava que o reporter tinha naquele momento.
 */
async function upsertReport(
  postId: string,
  reporterPub: string,
  reason: ReportReason,
  createdAt: number,
  kind: number,
): Promise<void> {
  await runWrite(
    `INSERT INTO reports (post_id, reporter_pub, reason, weight, created_at, kind)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(post_id, reporter_pub) DO UPDATE SET
       reason     = excluded.reason,
       created_at = excluded.created_at,
       kind       = excluded.kind
     WHERE excluded.created_at > reports.created_at
        OR (excluded.created_at = reports.created_at AND excluded.kind < reports.kind)`,
    [postId, reporterPub, reason, createdAt, kind],
  )
}

async function persistReport(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  const postId = getTag(event, 'e')!
  const reasonTag = getTag(event, 'reason')
  const reason = isValidReason(reasonTag) ? reasonTag : 'spam'
  await upsertReport(postId, event.pubkey, reason, event.created_at, DRIFT_KIND.REPORT)
  await updateUserActivity(event.pubkey, event.created_at)
  if (deferSideEffects) return // dev-seed: bulk recompute no fim
  // Moderação é derivada na recomputação global (ranking.ts).
  scheduleRankingRecompute()
}

const VALID_REASONS: ReadonlySet<ReportReason> = new Set<ReportReason>([
  'illegal',
  'spam',
  'harassment',
])

function isValidReason(v: string | null): v is ReportReason {
  return v !== null && (VALID_REASONS as ReadonlySet<string>).has(v)
}

/**
 * Persiste prova OTS como pendente e agenda verificação. NÃO toca
 * `users.last_active`: qualquer um pode publicar a prova de um evento
 * alheio — ela não é atividade de ninguém. Quem é ancorado é o AUTOR do
 * evento carimbado, resolvido na verificação.
 */
async function persistOtsAttestation(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  await runWrite(
    `INSERT OR IGNORE INTO ots_proofs
     (proof_event_id, target_event_id, proof_b64, raw_event, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [event.id, getTag(event, 'e')!, event.content, JSON.stringify(event)],
  )
  if (deferSideEffects) return
  const { scheduleOtsVerification } = await import('./ots-anchors')
  scheduleOtsVerification()
}

// ─── NIP-56 kind 1984 — report cross-cliente Nostr ────────────────
//
// Manifesto §29 (compat Nostr): Drift agora emite + ingere kind 1984
// junto com 9081 nativo. NIP-56 reason space (7 valores) é mapeado pro
// bucket Drift (3) via `lib/nip56-mapping.ts` antes do INSERT.
//
// Dedup LWW cross-kind: UNIQUE (post_id, reporter_pub) garante 1 row
// por par; `upsertReport` guarda o report mais recente (LWW real, como
// spreads/buries — auditoria 2026-11-03).

async function persistNip56Report(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  const { mapNip56ToDrift } = await import('./nip56-mapping')

  const postId = getTag(event, 'e')!
  const reportType = extractNip56ReportType(event)
  if (reportType === null) return // Defensive — validate já cobriu mas trust no path

  const driftReason = mapNip56ToDrift(reportType)
  if (driftReason === null) return // report_type fora do whitelist NIP-56

  await upsertReport(postId, event.pubkey, driftReason, event.created_at, 1984)
  await updateUserActivity(event.pubkey, event.created_at)
  if (deferSideEffects) return
  scheduleRankingRecompute()
}

// ─── User metadata kind 0 (NIP-01) — opt-in identity ──────────────
//
// Replaceable event: LWW por `created_at`. Não invalida feed nem
// dispara recálculo de score (manifesto §22 / §24 — metadata NÃO afeta
// ranking). UI consome via `useUserMetadata` hook.
//
// Whitelist NIP-01 puro na ingestão: apenas extrai chaves conhecidas
// do content JSON. Chaves não-listadas são silenciosamente ignoradas
// — defesa contra eventos kind 0 mal-formados ou de clientes que
// inventam campos. raw_event preservado pra re-broadcast §16.

async function persistUserMetadata(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(event.content) as Record<string, unknown>
  } catch {
    return
  }
  const str = (k: string): string | null => {
    const v = parsed[k]
    return typeof v === 'string' && v.length > 0 ? v : null
  }
  const now = Math.floor(Date.now() / 1000)
  await db.run(
    `INSERT INTO users_metadata
     (npub, name, display_name, about, picture, banner, website, nip05, lud16, raw_event, event_created_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(npub) DO UPDATE SET
       name             = excluded.name,
       display_name     = excluded.display_name,
       about            = excluded.about,
       picture          = excluded.picture,
       banner           = excluded.banner,
       website          = excluded.website,
       nip05            = excluded.nip05,
       lud16            = excluded.lud16,
       raw_event        = excluded.raw_event,
       event_created_at = excluded.event_created_at,
       fetched_at       = excluded.fetched_at
     WHERE excluded.event_created_at > users_metadata.event_created_at`,
    [
      event.pubkey,
      str('name'),
      str('display_name'),
      str('about'),
      str('picture'),
      str('banner'),
      str('website'),
      str('nip05'),
      str('lud16'),
      JSON.stringify(event),
      event.created_at,
      now,
    ],
  )
  if (deferSideEffects) return // dev-seed: bulk invalidate no fim re-query o JOIN
  // Notify reactive consumers (useUserMetadata hook) — re-query.
  bumpProfileVersion(event.pubkey)
  // D3 Sprint N+3 Batch A — kind 0 metadata feeds `users_metadata` JOIN
  // que popula `authorAvatar`/`authorAlias` em `feed.ts:rowToPost`. Sem
  // invalidateFeed aqui, a store Zustand mantém o array materializado
  // de um refresh anterior (avatares = undefined) até o próximo evento
  // de domínio (POST/SPREAD/BURY) chegar e disparar refresh — pode
  // levar minutos. Resultado: avatares só apareciam ao abrir Profile
  // page (que faz query própria). Invalidar aqui re-query o feed e
  // atualiza os campos decorativos. Manifesto §22 LOCK_VIA_TEST OK:
  // refresh re-aplica o mesmo ranking determinístico, só joga os
  // campos decorativos extras na shape do Post.
  invalidateFeed()
}

// ─── Users — atividade agregada (Fase 4) ─────────────────────────────
//
// Alimenta `weight.ts:calculateEngagement` (DAILY_INACTIVE penalidade)
// e `moderation.ts:countActiveUsers` (threshold dinâmico de moderação).
//
// Cada evento Drift assinado é "sinal de vida" do autor. Atualizamos
// `users.last_active` no maior `created_at` visto por aquele author.
// Idempotente: ON CONFLICT atualiza só se o evento é mais recente.
//
// Insere row se primeiro contato com este npub. `created_at`
// representa "first seen" — pode estar errado se o user existia antes
// do nosso cliente conhecer ele, mas é aproximação aceitável.

async function updateUserActivity(authorPub: string, eventCreatedAt: number): Promise<void> {
  await runWrite(
    `INSERT INTO users (npub, created_at, last_active)
     VALUES (?, ?, ?)
     ON CONFLICT(npub) DO UPDATE SET
       last_active = MAX(COALESCE(last_active, 0), excluded.last_active)`,
    [authorPub, eventCreatedAt, eventCreatedAt],
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function serializeLocation(event: SignedEvent): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'location') continue
    const lat = parseFloat(tag[1] ?? '')
    const lng = parseFloat(tag[2] ?? '')
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return JSON.stringify({
      lat,
      lng,
      city: tag[3] ?? '',
      country: tag[4] ?? '',
    })
  }
  return null
}

// ─── Recomputação global do ranking ──────────────────────────────────
//
// Antes: recálculo POR POST (debounce por postId), com o peso de cada
// spreader lido no instante daquele recálculo, e moderação como UPDATE
// avulso disparado por report. Isso tornava o score função da ordem de
// chegada e do histórico de recálculos, e deixava o recálculo seguinte
// apagar o `-999` (auditoria 2026-11-03, A2/S4/M1/M2).
//
// Agora: qualquer evento de domínio agenda UMA recomputação global
// (debounce + teto de espera), que carrega o conjunto inteiro, roda o
// motor puro `ranking.ts:computeRanking` e grava só as linhas que
// mudaram. Mesmo conjunto de eventos → mesmo resultado, sempre.

const RANKING_MAX_WAIT_MS = 2_000
const RANKING_WRITE_CHUNK = 800

let rankingTimer: ReturnType<typeof setTimeout> | null = null
let rankingFirstRequestAt = 0
let rankingRun: Promise<void> | null = null
let rankingRerun = false
let dayRolloverTimer: ReturnType<typeof setTimeout> | null = null
let dayRolloverEpoch = -1

/**
 * Agenda recomputação global. Debounce de `SCORE_RECALC_DEBOUNCE_MS`
 * por evento, mas nunca adia mais que `RANKING_MAX_WAIT_MS` desde o
 * primeiro pedido — tráfego contínuo não congela o ranking.
 */
function scheduleRankingRecompute(): void {
  const now = Date.now()
  if (rankingTimer === null) rankingFirstRequestAt = now
  else clearTimeout(rankingTimer)
  const wait = Math.max(
    0,
    Math.min(SCORE_RECALC_DEBOUNCE_MS, rankingFirstRequestAt + RANKING_MAX_WAIT_MS - now),
  )
  rankingTimer = setTimeout(() => {
    rankingTimer = null
    recalcAllScores().catch((err) => console.error('[ranking]', err))
  }, wait)
}

/**
 * Recomputa pesos, scores e moderação de TUDO a partir do SQLite.
 *
 * Nome mantido por compat (bootstrap, dev-seed). Serializado: chamadas
 * concorrentes esperam a corrente e disparam no máximo 1 rodada extra.
 *
 * Determinismo (§7): a saída é função de (conjunto de eventos, âncoras
 * OTS verificadas, dia UTC, prefs locais de moderação). Não depende de
 * ordem de chegada nem de quando cada post foi recalculado pela última vez.
 */
export async function recalcAllScores(_yieldEvery?: number): Promise<void> {
  if (rankingRun) {
    rankingRerun = true
    return rankingRun
  }
  rankingRun = (async () => {
    try {
      do {
        rankingRerun = false
        await recomputeRankingOnce()
      } while (rankingRerun)
    } finally {
      rankingRun = null
    }
  })()
  return rankingRun
}

interface StoredPostRow {
  id: string
  author_pub: string
  created_at: number
  score: number | null
  score_base: number | null
  spreads: number | null
  buries: number | null
}

async function recomputeRankingOnce(): Promise<void> {
  const nowMs = Date.now()
  const posts = await db.exec<StoredPostRow>(
    `SELECT id, author_pub, created_at, score, score_base, spreads, buries FROM posts`,
  )
  const spreads = await db.exec<RankingAction>(
    `SELECT post_id, spreader_pub AS user_pub, created_at, event_id FROM spreads`,
  )
  const buries = await db.exec<RankingAction>(
    `SELECT post_id, burier_pub AS user_pub, created_at, event_id FROM buries`,
  )
  const comments = await db.exec<{ post_id: string; author_pub: string; score: number | null }>(
    `SELECT post_id, author_pub, score FROM comments`,
  )
  const reports = await db.exec<RankingReport>(
    `SELECT post_id, reporter_pub, reason, created_at FROM reports`,
  )
  const users = await db.exec<{
    npub: string
    last_active: number | null
    weight: number | null
    engagement: number | null
  }>(`SELECT npub, last_active, weight, engagement FROM users`)
  const anchorRows = await db.exec<{ author_pub: string; t: number }>(
    `SELECT author_pub, MIN(block_time) AS t FROM ots_anchors GROUP BY author_pub`,
  )

  const { getPrefs } = await import('./prefs')
  const prefs = getPrefs()

  const out = computeRanking({
    nowMs,
    posts,
    spreads,
    buries,
    comments: comments.map((c) => ({
      post_id: c.post_id,
      author_pub: c.author_pub,
      hidden: (c.score ?? 0) <= MODERATED_SCORE,
    })),
    reports,
    users,
    anchors: new Map(anchorRows.map((r) => [r.author_pub, r.t])),
    moderation: {
      thresholdOverride: prefs.report_threshold_override,
      reportDecayHalfLifeMs: prefs.report_decay_enabled ? REPORT_DECAY_HALF_LIFE_MS : undefined,
    },
  })

  // Só grava o que mudou — recomputação frequente não reescreve a tabela.
  const ops: Array<{ sql: string; params: unknown[] }> = []
  const viral: Array<[string, number]> = []
  for (const row of posts) {
    const r = out.posts.get(row.id)
    if (!r) continue
    const wasModerated = row.score === MODERATED_SCORE
    const changed =
      wasModerated !== r.moderated ||
      Math.abs((row.score_base ?? 0) - r.scoreBase) > 1e-9 ||
      (row.spreads ?? 0) !== r.spreads ||
      (row.buries ?? 0) !== r.buries
    if (changed) {
      ops.push({
        sql: `UPDATE posts SET score = ?, score_base = ?, spreads = ?, buries = ? WHERE id = ?`,
        params: [r.score, r.scoreBase, r.spreads, r.buries, row.id],
      })
    }
    if (r.score > VIRAL_PIN_THRESHOLD && (row.score ?? 0) <= VIRAL_PIN_THRESHOLD) {
      viral.push([row.id, r.score])
    }
  }
  for (const u of users) {
    const w = out.weights.get(u.npub) ?? 0
    const e = w - (out.antiquity.get(u.npub) ?? 0)
    if (Math.abs((u.weight ?? 0) - w) > 1e-9 || Math.abs((u.engagement ?? 0) - e) > 1e-9) {
      ops.push({ sql: `UPDATE users SET weight = ?, engagement = ? WHERE npub = ?`, params: [w, e, u.npub] })
    }
  }
  for (let i = 0; i < ops.length; i += RANKING_WRITE_CHUNK) {
    await db.batch(ops.slice(i, i + RANKING_WRITE_CHUNK))
    if (i + RANKING_WRITE_CHUNK < ops.length) await yieldToMain()
  }
  if (ops.length > 0) invalidateFeed()

  for (const [postId, score] of viral) void maybeAutoPinViralBlobs(postId, score)

  // Votos e comentários sobre posts que não temos → pedir o post por id.
  const known = new Set(posts.map((p) => p.id))
  const missing = new Set<string>()
  for (const a of spreads) if (!known.has(a.post_id)) missing.add(a.post_id)
  for (const a of buries) if (!known.has(a.post_id)) missing.add(a.post_id)
  for (const c of comments) if (!known.has(c.post_id)) missing.add(c.post_id)
  if (missing.size > 0) requestMissingEvents([...missing], nowMs)

  // Autores ativos sem âncora OTS → pedir as provas que eles publicaram.
  const anchored = new Set(anchorRows.map((r) => r.author_pub))
  const actors = new Set<string>()
  for (const p of posts) actors.add(p.author_pub)
  for (const a of spreads) actors.add(a.user_pub)
  for (const a of buries) actors.add(a.user_pub)
  for (const r of reports) actors.add(r.reporter_pub)
  const unanchored = [...actors].filter((n) => !anchored.has(n))
  if (unanchored.length > 0) requestAnchorsFor(unanchored, nowMs)

  scheduleDayRollover(out.epochMs)
}

/**
 * Pesos mudam na virada do dia UTC (antiguidade, inatividade). Sem evento
 * novo nada recomputaria — então agenda 1 recomputação logo após a virada.
 */
function scheduleDayRollover(epochMs: number): void {
  if (dayRolloverEpoch === epochMs && dayRolloverTimer !== null) return
  if (dayRolloverTimer !== null) clearTimeout(dayRolloverTimer)
  dayRolloverEpoch = epochMs
  const delay = Math.max(1_000, epochMs + MS_PER_DAY + 1_000 - Date.now())
  dayRolloverTimer = setTimeout(() => {
    dayRolloverTimer = null
    scheduleRankingRecompute()
  }, delay)
}

/**
 * Re-export da regra "última ação vale" (vive em `ranking.ts`, pura).
 * Mantido aqui por compat de import dos testes e de callers antigos.
 */
export { selectLatestActionByUser, type ActionRow } from './ranking'

/**
 * Track B.2 (Satoshi audit 2026-05-21) — auto-pin de blobs em posts
 * virais. Disparado por `recalcAllScores` quando o score cruza
 * `VIRAL_PIN_THRESHOLD`. Manifesto §16 (disponibilidade distribuída):
 * user power que opta-in ajuda a rede a hospedar conteúdo viral sem
 * chave mestra central.
 *
 * Best-effort:
 *  - Pref OFF (default) → no-op silencioso
 *  - Score abaixo do threshold → no-op
 *  - Post sem imeta tags (legacy ou só-texto) → no-op
 *  - Helia indisponível → log e segue
 *
 * Lazy imports pra evitar cycle events ← prefs ← ... + manter Helia
 * fora do bundle inicial (helia.ts §lazy-load — só baixa quando user
 * efetivamente usa IPFS).
 */
async function maybeAutoPinViralBlobs(postId: string, score: number): Promise<void> {
  try {
    if (score <= VIRAL_PIN_THRESHOLD) return
    const { getPrefs } = await import('./prefs')
    if (!getPrefs().auto_pin_enabled) return

    const row = await db.get<{ raw_event: string }>(
      `SELECT raw_event FROM posts WHERE id = ?`,
      [postId],
    )
    if (!row) return

    const parsedEvent = JSON.parse(row.raw_event) as SignedEvent
    const metas = parseImetaTags(parsedEvent)
    if (metas.length === 0) return

    // Dedup CIDs (post pode ter o mesmo blob em múltiplos subposts).
    const cids = new Set<string>()
    for (const meta of metas) {
      if (meta.cid) cids.add(meta.cid)
    }
    if (cids.size === 0) return

    const { pinBlob, cidFromString } = await import('./helia')
    for (const cidStr of cids) {
      void (async () => {
        try {
          const cid = await cidFromString(cidStr)
          await pinBlob(cid)
        } catch (err) {
          console.warn('[events] auto-pin viral falhou pra cid', cidStr, err)
        }
      })()
    }
  } catch (err) {
    console.warn('[events] maybeAutoPinViralBlobs falhou (degraded):', err)
  }
}
