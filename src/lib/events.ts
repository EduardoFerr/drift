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
 *   4. Persist (handler.persist — INSERT OR IGNORE + invalidateFeed + scheduleScoreRecalc)
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
import { DRIFT_KIND, SCORE_RECALC_DEBOUNCE_MS, VIRAL_PIN_THRESHOLD } from '../config/constants'
import { applyCommentReceived, calculateScoreNow } from './scoring'
import { bumpUnseenCount, invalidateFeed } from './feed'
import { getReportWeight, maybeModerate } from './moderation'
import { calculateUserWeight, calculateWeight } from './weight'
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
 *    CLAUDE.md invariante #1 (única porta SQLite domínio) + conformance
 *    test em `tests/manifesto-conformance.test.ts:655-679` validam path
 *    literal — extrair handler pra outro arquivo viola conformance.
 *  - Pipeline cheap→expensive→persist→recalc→invalidate (CLAUDE.md
 *    invariante #5) preservado em `onNostrEvent`. Handler só implementa
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
   * (CLAUDE.md invariante #5 — manter ordem cheap→expensive). Pode ler
   * tags + `JSON.parse(content)`. Retorna `false` pra rejeitar
   * silenciosamente (manifesto §29 — cliente não fala com atacante).
   */
  validate(event: SignedEvent): boolean
  /**
   * Persiste no SQLite. Roda APÓS `verifyEventAsync` ter passado.
   * DEVE ser idempotente (`INSERT OR IGNORE`). Responsável por chamar
   * `invalidateFeed()` e `scheduleScoreRecalc(postId)` quando aplicável
   * (cada handler decide a semântica — REPORT chama `maybeModerate`,
   * COMMENT propaga score do post recebedor, etc.).
   *
   * `deferSideEffects` (default false): quando true, o handler PERSISTE
   * normalmente (INSERT + updateUserActivity) mas SUPRIME os side-effects
   * pós-persist `scheduleScoreRecalc(postId)` + `invalidateFeed()`. Usado
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
// CUIDADO: persist* que LEEM antes de escrever (ex: persistReport →
// calculateUserWeight) dependem dos writes anteriores já estarem flushados.
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
  //    Pipeline preservado: invariantes #1, #5, #6 do CLAUDE.md.
  //    `deferSideEffects` (default false) adia recalc/invalidate pós-persist
  //    — caller bulk-aware (dev-seed) consolida no fim.
  await handler.persist(event, options?.deferSideEffects ?? false)
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
  scheduleScoreRecalc(postId)
}

async function persistSpread(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  const postId = getTag(event, 'e')!
  await runWrite(
    `INSERT OR IGNORE INTO spreads
     (post_id, spreader_pub, created_at, location, event_id, raw_event)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [postId, event.pubkey, event.created_at, serializeLocation(event), event.id, JSON.stringify(event)],
  )
  await updateUserActivity(event.pubkey, event.created_at)
  // invalidateFeed direto + recalc agendado.
  //
  // Por que invalidar AQUI também (e não só após recalc): se este
  // cliente recebeu o spread ANTES de receber o post (race comum em
  // feeds que sincronizam de relays diferentes), recalculateScore
  // dá early-return porque `posts WHERE id = postId` retorna null —
  // não roda UPDATE, não chama invalidateFeed. UI fica desatualizada
  // até o post chegar (eventualmente). Invalidar aqui garante que
  // quando o getMyAction do useEffect roda, encontra o spread persistido
  // e limpa o pending optimistic. Manifesto §6 (Verdade por Eventos).
  if (deferSideEffects) return // dev-seed: bulk recalc + invalidate no fim
  invalidateFeed()
  scheduleScoreRecalc(postId)
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
    `INSERT OR IGNORE INTO buries
     (post_id, burier_pub, created_at, event_id, raw_event)
     VALUES (?, ?, ?, ?, ?)`,
    [postId, event.pubkey, event.created_at, event.id, JSON.stringify(event)],
  )
  await updateUserActivity(event.pubkey, event.created_at)
  if (deferSideEffects) return // dev-seed: bulk recalc + invalidate no fim
  invalidateFeed() // mesmo motivo de persistSpread — race spread-antes-do-post
  scheduleScoreRecalc(postId)
  // bury NÃO penaliza o autor — diferença filosófica central
}

/**
 * Persiste comment NIP-22 (kind 1111). PRIVADO — única porta de INSERT
 * da tabela `comments` é `onNostrEvent` via este helper (CLAUDE.md
 * invariante #1).
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
  // Track C.5: comments alimentam score do post recebedor via
  // `applyCommentReceived` em `recalculateScore`. Igual spreads/buries,
  // usa debounce de SCORE_RECALC_DEBOUNCE_MS pra rajadas (post viral
  // recebendo dezenas de replies em sequência → 1 recálculo no fim).
  // Self-comments e moderation (score = -999) são filtrados na query
  // SQL dentro de recalculateScore (Barney HIGH #3).
  scheduleScoreRecalc(parsed.rootEventId)
}

async function persistReport(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  const postId = getTag(event, 'e')!
  const reasonTag = getTag(event, 'reason')
  const reason = isValidReason(reasonTag) ? reasonTag : 'spam'

  // Peso do reporter: anti-sybil. Identidade nova vale menos (manifesto §26).
  // O peso pode ser 0 se o reporter é desconhecido pra este cliente — nesse
  // caso `getReportWeight` aplica o tier mais baixo (0.5).
  const reporterWeightCalc = await calculateUserWeight(event.pubkey, Date.now())
  const reporterWeight = getReportWeight(reporterWeightCalc.weight)

  try {
    await runWrite(
      `INSERT OR IGNORE INTO reports
       (post_id, reporter_pub, reason, weight, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [postId, event.pubkey, reason, reporterWeight, event.created_at],
    )
  } catch (err) {
    // Fallback resiliente: banco velho cuja migração `reason` ainda
    // não foi aplicada (acontece em devices que mantiveram a aba
    // aberta com worker antigo carregado, ou cache agressivo). Insere
    // sem reason — perde a categorização específica deste report mas
    // o fluxo de moderação continua. Cliente vai acabar atualizando
    // schema na próxima boot completa.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('no such column') && msg.includes('reason')) {
      console.warn(
        '[events] persistReport sem coluna reason — banco em schema antigo. ' +
          'Recarregue a página com cache limpo pra aplicar migração.',
      )
      await db.run(
        `INSERT OR IGNORE INTO reports
         (post_id, reporter_pub, weight, created_at)
         VALUES (?, ?, ?, ?)`,
        [postId, event.pubkey, reporterWeight, event.created_at],
      )
    } else {
      throw err
    }
  }

  await updateUserActivity(event.pubkey, event.created_at)

  // dev-seed: a moderação §26 (maybeModerate) e o invalidateFeed são
  // adiados pro bulk pass (`recalcAllScores`), que aplica recalc DEPOIS
  // o threshold de moderação na ordem correta (-999 vence o último write).
  if (deferSideEffects) return

  // Após inserir, verifica threshold. Se atingido, post.score = -999 e
  // some do feed default. Manifesto §26.
  try {
    await maybeModerate(postId, Date.now())
  } catch (err) {
    // Mesmo fallback — moderation.ts:aggregateReports lê coluna reason.
    // Em banco velho, falha. Logamos e seguimos — moderação fica
    // reativa quando schema atualizar.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('no such column') && msg.includes('reason')) {
      console.warn('[events] maybeModerate skip — banco em schema antigo.')
    } else {
      throw err
    }
  }
  invalidateFeed()
}

const VALID_REASONS: ReadonlySet<ReportReason> = new Set<ReportReason>([
  'illegal',
  'spam',
  'harassment',
])

function isValidReason(v: string | null): v is ReportReason {
  return v !== null && (VALID_REASONS as ReadonlySet<string>).has(v)
}

// ─── NIP-56 kind 1984 — report cross-cliente Nostr ────────────────
//
// Manifesto §29 (compat Nostr): Drift agora emite + ingere kind 1984
// junto com 9081 nativo. NIP-56 reason space (7 valores) é mapeado pro
// bucket Drift (3) via `lib/nip56-mapping.ts` antes do INSERT.
//
// Dedup LWW cross-kind: UNIQUE (post_id, reporter_pub) garante 1 row
// por par; INSERT OR IGNORE preserva o primeiro report. Marshall
// recomendou trocar pra ON CONFLICT...WHERE excluded.created_at >
// reports.created_at (LWW real); deixei como INSERT OR IGNORE por
// agora pra ficar simétrico com persistReport. Trade-off documentado
// em Docs/sessions/relay-moderation-himym-research-2026-05-17.md.

async function persistNip56Report(event: SignedEvent, deferSideEffects: boolean): Promise<void> {
  const { mapNip56ToDrift } = await import('./nip56-mapping')

  const postId = getTag(event, 'e')!
  const reportType = extractNip56ReportType(event)
  if (reportType === null) return // Defensive — validate já cobriu mas trust no path

  const driftReason = mapNip56ToDrift(reportType)
  if (driftReason === null) return // report_type fora do whitelist NIP-56

  // Mesmo cálculo de peso do reporter — anti-sybil §26. NIP-56 emitido
  // por cliente externo não traz weight; calculamos local.
  const reporterWeightCalc = await calculateUserWeight(event.pubkey, Date.now())
  const reporterWeight = getReportWeight(reporterWeightCalc.weight)

  try {
    await db.run(
      `INSERT OR IGNORE INTO reports
       (post_id, reporter_pub, reason, weight, created_at, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [postId, event.pubkey, driftReason, reporterWeight, event.created_at, 1984],
    )
  } catch (err) {
    // Fallback: banco sem coluna `kind` (migration ainda não aplicada).
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('no such column') && msg.includes('kind')) {
      console.warn(
        '[events] persistNip56Report sem coluna kind — banco em schema antigo. ' +
          'Recarregue a página com cache limpo pra aplicar migração.',
      )
      await db.run(
        `INSERT OR IGNORE INTO reports
         (post_id, reporter_pub, reason, weight, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [postId, event.pubkey, driftReason, reporterWeight, event.created_at],
      )
    } else {
      throw err
    }
  }

  await updateUserActivity(event.pubkey, event.created_at)

  // dev-seed: moderação + invalidate adiados pro bulk pass (ver persistReport).
  if (deferSideEffects) return

  try {
    await maybeModerate(postId, Date.now())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('no such column') && msg.includes('reason')) {
      console.warn('[events] maybeModerate skip — banco em schema antigo.')
    } else {
      throw err
    }
  }
  invalidateFeed()
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

// ─── Recalc de score com debounce por postId ─────────────────────────
//
// Cenário motivador: 50 spreads chegam pro mesmo post em rajada
// (cliente reconectando após offline, post viral). Sem debounce, são
// 50 recálculos sequenciais. Com debounce 100ms, vira 1 recálculo no
// fim da rajada — ~50× menos round-trips ao worker SQLite.

const pendingRecalcs = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleScoreRecalc(postId: string): void {
  const existing = pendingRecalcs.get(postId)
  if (existing) clearTimeout(existing)
  pendingRecalcs.set(
    postId,
    setTimeout(() => {
      pendingRecalcs.delete(postId)
      recalculateScore(postId).catch((err) =>
        console.error('[recalcScore]', postId, err),
      )
    }, SCORE_RECALC_DEBOUNCE_MS),
  )
}

/**
 * Recalc bulk — recalcula o score de TODOS os posts em um único loop
 * sequencial, sem o debounce-per-postId de `scheduleScoreRecalc`. Pensado
 * pro dev-seed (`lib/dev-seed/seed.ts`), que ingere milhares de eventos
 * com `deferSideEffects: true` e precisa materializar scores UMA vez no
 * fim em vez de disparar uma storm de N timers + N recalcs avulsos.
 *
 * Determinismo (manifesto §7): `recalculateScore` é puro em cima do estado
 * SQLite — rodar 1× por post no fim do drain dá EXATAMENTE o mesmo score
 * que o caminho normal (recalc incremental por evento), porque scoring é
 * agregação idempotente das ações persistidas, não acumulação incremental.
 *
 * Ordem crítica (manifesto §26): recalc PRIMEIRO, moderação DEPOIS. Posts
 * que cruzam o threshold de reports recebem `score = -999` via
 * `maybeModerate` — esse write precisa ser o ÚLTIMO, senão o recalc
 * sobrescreveria o -999 com um score real. Por isso a moderação roda num
 * segundo passo, após todos os recalcs.
 *
 * Cede o main thread a cada `yieldEvery` posts (default igual ao boot
 * batch) pra não travar o paint durante o bulk. `recalculateScore` chama
 * `invalidateFeed()` internamente, mas ele é debounced (early-return se já
 * há timer) — durante o bulk vira no máximo 1 refresh, e o caller
 * (`seedDatabase`) garante 1 invalidate final consistente após o bulk.
 */
export async function recalcAllScores(yieldEvery: number = 50): Promise<void> {
  const postRows = await db.exec<{ id: string }>(`SELECT id FROM posts`)
  let processed = 0
  for (const { id } of postRows) {
    await recalculateScore(id)
    processed++
    if (processed % yieldEvery === 0) await yieldToMain()
  }
  // 2º passo — moderação §26 por post reportado. Roda DEPOIS do recalc pra
  // que o -999 (quando threshold é cruzado) seja o último write e vença.
  const reportedRows = await db.exec<{ post_id: string }>(
    `SELECT DISTINCT post_id FROM reports`,
  )
  const moderationNow = Date.now()
  processed = 0
  for (const { post_id } of reportedRows) {
    try {
      await maybeModerate(post_id, moderationNow)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('no such column') && msg.includes('reason')) {
        console.warn('[events] recalcAllScores: maybeModerate skip — schema antigo.')
      } else {
        throw err
      }
    }
    processed++
    if (processed % yieldEvery === 0) await yieldToMain()
  }
}

interface PostRow {
  created_at: number
  /** Pubkey do autor — usado pra excluir self-comments (Barney HIGH #3). */
  author_pub: string
}

interface CommenterRow {
  author_pub: string
}

export interface ActionRow {
  kind: 'spread' | 'bury'
  user_pub: string
  created_at: number
}

/**
 * Seleciona a ação líquida (cronologicamente mais recente) de cada user
 * a partir do conjunto bruto de spreads+buries. Função pura — sem db,
 * sem `Date.now()`. Exportada principalmente pra tests de regressão da
 * semântica "última ação vale" (consolidado.md §4.6 + manifesto §23).
 *
 * **Regras**:
 *  1. Pra cada `user_pub`, retorna a ação com maior `created_at`.
 *  2. Empate de `created_at`: tie-break por `kind` ASC — `'bury'` < `'spread'`
 *     em lex order, então em empate `'bury'` ganha. Determinístico.
 *  3. Order independence: o resultado NÃO depende da ordem do array de
 *     entrada (mesmo conjunto de ações → mesmo resultado). Tests cobrem.
 *
 * **Por que esta função existe**: sem ela, dois clientes Drift com
 * mesmos eventos publicados podem chegar a scores diferentes se
 * processarem em ordem distinta. Manifesto §7 (determinismo global)
 * exige convergência. Esta função é a peça que garante isso pro
 * sub-problema "user mudou de opinião N vezes".
 */
export function selectLatestActionByUser(
  actions: readonly ActionRow[],
): Map<string, 'spread' | 'bury'> {
  const latestActionByUser = new Map<string, 'spread' | 'bury'>()
  const latestTsByUser = new Map<string, number>()
  for (const row of actions) {
    const prevTs = latestTsByUser.get(row.user_pub)
    if (prevTs === undefined || row.created_at > prevTs) {
      latestTsByUser.set(row.user_pub, row.created_at)
      latestActionByUser.set(row.user_pub, row.kind)
    } else if (row.created_at === prevTs) {
      // Tie: kind ASC (`'bury'` lex < `'spread'`). Mantém o que vem
      // primeiro alfabeticamente — determinístico cross-cliente.
      const prev = latestActionByUser.get(row.user_pub)!
      if (row.kind < prev) {
        latestActionByUser.set(row.user_pub, row.kind)
      }
    }
  }
  return latestActionByUser
}

interface UserAggRow {
  npub: string
  user_created_at: number
  last_active: number | null
  spreads_received: number
}

/**
 * Recalcula score de um post agregando ações líquidas com pesos.
 *
 * **Semântica "última ação vale"** (manifesto §23, `Docs/sessions/
 * conversa-29-04-analise.md` §Seção 2): cada (post_id, user_pub)
 * contribui com APENAS sua ação cronologicamente mais recente entre
 * seus spreads e buries. Pessoas mudam de opinião — eventos imutáveis
 * preservam histórico, mas o score líquido só conta a última.
 *
 * **Score weighted by spreader weight** (`Docs/sessions/conformance-
 * conversa-29-04.md` §Recomendação central, papel: revisão de
 * conformance): cada ação contribui com o `weight` da identidade Drift
 * do user (0..100). Sybil novo tem weight ~0 → spread vale ~0.
 * Determinístico, função pura — preserva §22 (sem reputação subjetiva)
 * e §11 (sem afinidade no feed).
 *
 * Pipeline:
 *   1. Buscar created_at do post.
 *   2. Buscar TODAS as ações (spreads + buries) do post via UNION.
 *   3. Pra cada user, achar ação líquida (MAX created_at; tie-break
 *      por kind ASC determinístico).
 *   4. Batch-fetch dados de peso pra todos users únicos com ação.
 *   5. Aplicar `calculateUserWeight` puro pra cada um.
 *   6. Somar pesos por kind → spreadWeight, buryWeight.
 *   7. UPDATE posts.score = calculateScore(...).
 *   8. UPDATE posts.spreads/buries = COUNT(distinct users com ação
 *      líquida) — preserva semântica UI ("3 espalharam").
 */
async function recalculateScore(postId: string): Promise<void> {
  // 1. Post info (existência + created_at + author_pub pra Barney HIGH #3)
  const postRow = await db.get<PostRow>(
    `SELECT created_at, author_pub FROM posts WHERE id = ?`,
    [postId],
  )
  if (!postRow) return

  // 2. Todas as ações do post (spreads + buries) ordenadas por tempo
  const actions = await db.exec<ActionRow>(
    `SELECT 'spread' AS kind, spreader_pub AS user_pub, created_at FROM spreads WHERE post_id = ?
     UNION ALL
     SELECT 'bury' AS kind, burier_pub AS user_pub, created_at FROM buries WHERE post_id = ?
     ORDER BY created_at ASC`,
    [postId, postId],
  )

  // 3. Pra cada user, fica com ação mais recente. Lógica pura
  // extraída em `selectLatestActionByUser` pra ser testável
  // isolada sem mockar SQLite. Manifesto §7 (determinismo).
  const latestActionByUser = selectLatestActionByUser(actions)

  if (latestActionByUser.size === 0) {
    // Nenhuma ação — score puro por idade + contribuição de comments
    // (post pode ter comments mas zero spread/bury ainda — C.5).
    const baseScore = calculateScoreNow(0, 0, postRow.created_at)
    const withComments = await applyCommentsContribution(
      postId,
      postRow.author_pub,
      baseScore,
      Date.now(),
    )
    await db.run(
      `UPDATE posts SET score = ?, spreads = 0, buries = 0 WHERE id = ?`,
      [withComments, postId],
    )
    invalidateFeed()
    return
  }

  // 4. Batch-fetch dados de peso pra todos users únicos com ação.
  // Chunking: SQLite WASM 3.51 tem SQLITE_MAX_VARIABLE_NUMBER 32766
  // mas alguns builds antigos limitam em 999. Posts virais (>5k spreaders)
  // estourariam parser sem chunk. CHUNK_SIZE conservador (500) cobre todos
  // os builds + bom balanço entre número de queries e tamanho de cada uma.
  // Ted follow-up #2 (sessão 29-04, alta prioridade).
  const userPubs = Array.from(latestActionByUser.keys())
  const userRows = await fetchUserAggsInChunks(userPubs)

  // 5+6. Aplicar fórmula pura de weight a cada user e somar por kind.
  // Capturamos `now` UMA vez antes do loop (Marshall peer review):
  // todos os users do mesmo recalc usam o mesmo timestamp, fortalecendo
  // determinismo intra-execução. Cross-execution ainda varia naturalmente.
  const recalcNow = Date.now()
  const userWeightMap = new Map<string, number>()
  for (const row of userRows) {
    const weight = calculateWeight({
      createdAt: row.user_created_at * 1000, // unix seconds → ms
      spreadsReceived: row.spreads_received,
      lastActive: row.last_active !== null ? row.last_active * 1000 : null,
      now: recalcNow,
    })
    userWeightMap.set(row.npub, weight)
  }

  let spreadWeight = 0
  let buryWeight = 0
  let spreadCount = 0
  let buryCount = 0
  for (const [userPub, action] of latestActionByUser) {
    // User sem entry em `users` (raro — possível em flush race) → weight 0
    const weight = userWeightMap.get(userPub) ?? 0
    if (action === 'spread') {
      spreadWeight += weight
      spreadCount++
    } else {
      buryWeight += weight
      buryCount++
    }
  }

  // 7+8. Persistir. UI conta pessoas (count); score usa pesos somados.
  // Track C.5: aplicar contribuição de comments ANTES de persistir.
  // Reaproveita `userWeightMap` pra comenters que também são spreaders/
  // buriers — evita double-fetch de weight.
  const baseScore = calculateScoreNow(spreadWeight, buryWeight, postRow.created_at)
  const score = await applyCommentsContribution(
    postId,
    postRow.author_pub,
    baseScore,
    recalcNow,
    userWeightMap,
  )
  await db.run(
    `UPDATE posts SET score = ?, spreads = ?, buries = ? WHERE id = ?`,
    [score, spreadCount, buryCount, postId],
  )
  invalidateFeed()
  // Satoshi audit redundância 2026-05-21 — auto-pin IPFS de posts virais.
  // Hook fire-and-forget: quando score cruza VIRAL_PIN_THRESHOLD E user
  // habilitou `auto_pin_enabled`, dispara pinBlob(cid) pra cada blob do
  // post. Idempotente em Helia (pinar 2× não duplica). Lazy import pra
  // evitar dep cycle events → helia → ... + manter Helia fora do bundle
  // inicial (helia.ts §lazy-load).
  void maybeAutoPinViralBlobs(postId, score)
}

/**
 * Track B.2 (Satoshi audit 2026-05-21) — auto-pin de blobs em posts
 * virais. Disparado por `recalculateScore` quando score cruza
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

/**
 * Track C.5 — agrega contribuição de comments ao score base.
 *
 * Issue Barney HIGH #3: SELECT exclui self-comments (`author_pub !=
 * post.author_pub`) e comments moderados (`score > -999`).
 *
 * Issue Ted #3: weight é current (no `now` passado), espelhando o
 * pipeline de spreads. Se commenter já estava no `userWeightMap`
 * (pré-calculado pra spread/bury do mesmo recalc), reusa — evita
 * fetch duplicado.
 *
 * Distinct commenters: dedup por `author_pub`. 100 comments do mesmo
 * user contam 1× weight (manifesto §22 anti-Sybil; design-comments §15).
 */
async function applyCommentsContribution(
  postId: string,
  postAuthorPub: string,
  baseScore: number,
  recalcNow: number,
  prefetchedWeights?: Map<string, number>,
): Promise<number> {
  // SELECT DISTINCT author_pub: já dedup. Filtros: !=author (Barney H#3)
  // e score > -999 (moderação esconde commenter inteiro do agregado).
  const commenterRows = await db.exec<CommenterRow>(
    `SELECT DISTINCT author_pub FROM comments
     WHERE post_id = ? AND author_pub != ? AND score > -999`,
    [postId, postAuthorPub],
  )
  if (commenterRows.length === 0) return baseScore

  // Buscar weights de commenters que ainda não estão no map prefetched.
  const missing: string[] = []
  for (const row of commenterRows) {
    if (!prefetchedWeights || !prefetchedWeights.has(row.author_pub)) {
      missing.push(row.author_pub)
    }
  }
  const commenterWeights = new Map<string, number>(prefetchedWeights ?? [])
  if (missing.length > 0) {
    const userRows = await fetchUserAggsInChunks(missing)
    for (const row of userRows) {
      const weight = calculateWeight({
        createdAt: row.user_created_at * 1000,
        spreadsReceived: row.spreads_received,
        lastActive: row.last_active !== null ? row.last_active * 1000 : null,
        now: recalcNow,
      })
      commenterWeights.set(row.npub, weight)
    }
  }

  let weightedTotal = 0
  for (const row of commenterRows) {
    weightedTotal += commenterWeights.get(row.author_pub) ?? 0
  }

  return applyCommentReceived({
    distinctCommenters: commenterRows.length,
    weightedTotal,
    currentScore: baseScore,
  })
}

/**
 * Tamanho máximo de chunk em queries com `IN (?, ?, ...)`. SQLite WASM
 * tem limite de bound params (default 32766 nas builds modernas, 999
 * em builds antigas). 500 é conservador — cobre todos os builds e dá
 * bom balanço: poucos round-trips ao worker pra posts médios, sem
 * estourar limite em posts virais (>5k spreaders).
 *
 * Exportado pra teste — permite verificar comportamento de chunking
 * com sample sizes que cruzam o limite.
 */
export const RECALC_USER_CHUNK_SIZE = 500

/**
 * Busca dados agregados de um conjunto de users em chunks (evita
 * estourar limite de bound params do SQLite). Idempotente — chunks
 * disjuntos (sem dedup necessário porque user_pubs é Set originalmente).
 */
async function fetchUserAggsInChunks(userPubs: string[]): Promise<UserAggRow[]> {
  const all: UserAggRow[] = []
  for (let i = 0; i < userPubs.length; i += RECALC_USER_CHUNK_SIZE) {
    const chunk = userPubs.slice(i, i + RECALC_USER_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db.exec<UserAggRow>(
      `SELECT
         u.npub AS npub,
         u.created_at AS user_created_at,
         u.last_active AS last_active,
         (SELECT COUNT(*) FROM spreads s
            INNER JOIN posts p ON p.id = s.post_id
            WHERE p.author_pub = u.npub) AS spreads_received
       FROM users u
       WHERE u.npub IN (${placeholders})`,
      chunk,
    )
    all.push(...rows)
  }
  return all
}
