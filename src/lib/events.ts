/**
 * onNostrEvent — o ÚNICO ponto de escrita em tabelas de domínio
 * (posts, spreads, buries, reports).
 *
 * Recebe eventos do subscribe (que inclui os próprios eventos publicados
 * pelo cliente, devolvidos pelos relays) e materializa estado local.
 *
 * Idempotente: INSERT OR IGNORE garante que processar o mesmo evento
 * N vezes não duplica linhas.
 *
 * ─── Pipeline (ordem importa para performance) ──────────────────────
 *
 *   1. Cheap kind check       (Set lookup)
 *   2. Cheap schema check     (tag lookup, JSON.parse só para POST)
 *   3. Caro: verify Schnorr   (~1ms/evento — só rodar no que vai ficar)
 *   4. Persist (INSERT OR IGNORE)
 *   5. Schedule recalc        (debounced, fire-and-forget)
 *   6. Invalidar feed         (debounced, dispara re-query do SQLite)
 *
 * Em situações onde N% do tráfego é não-Drift, descartamos antes do
 * verify — economia significativa.
 */

import type { SignedEvent } from '../types/nostr'
import { db } from './db'
import { verifyDriftEvent, getTag } from './nostr'
import { DRIFT_KIND, DRIFT_KIND_SET, SCORE_RECALC_DEBOUNCE_MS } from '../config/constants'
import { calculateScoreNow } from './scoring'
import { invalidateFeed } from './feed'
import { getReportWeight, maybeModerate } from './moderation'
import { calculateUserWeight, calculateWeight } from './weight'
import type { ReportReason } from '../types/drift'

export async function onNostrEvent(event: SignedEvent): Promise<void> {
  // 1. Kind check (cheapest)
  if (!DRIFT_KIND_SET.has(event.kind)) return

  // 2. Schema check (cheap)
  if (!passesSchemaCheck(event)) return

  // 3. Signature check (expensive — only after schema check passes)
  if (!verifyDriftEvent(event)) return

  // 4. Persist
  switch (event.kind) {
    case DRIFT_KIND.POST:
      await persistPost(event)
      return
    case DRIFT_KIND.SPREAD:
      await persistSpread(event)
      return
    case DRIFT_KIND.BURY:
      await persistBury(event)
      return
    case DRIFT_KIND.REPORT:
      await persistReport(event)
      return
  }
}

// ─── Schema check (cheap, before verify) ─────────────────────────────

const HEX_64 = /^[0-9a-f]{64}$/i

function isHex64(v: string | null): boolean {
  return v !== null && HEX_64.test(v)
}

/**
 * Cheap schema check antes de verify. Exportado pra teste — em runtime
 * só `onNostrEvent` usa.
 */
export function passesSchemaCheck(event: SignedEvent): boolean {
  switch (event.kind) {
    case DRIFT_KIND.POST: {
      // NIP-01: kind 9078 é regular event (faixa 1..9999). `d` tag não tem
      // semântica protocolar aqui — identificador é `event.id`. Drift exige
      // apenas `drift-version` pra distinguir do resto do tráfego Nostr.
      if (!getTag(event, 'drift-version')) return false
      try {
        const parsed = JSON.parse(event.content) as { subposts?: unknown }
        if (!Array.isArray(parsed.subposts)) return false
      } catch {
        return false
      }
      return true
    }
    case DRIFT_KIND.SPREAD:
    case DRIFT_KIND.BURY:
      // NIP-01: tag `e` é event.id em hex 64. nostr-tools rejeita formato
      // errado já no _onmessage do relay; descartamos aqui também por
      // defesa-em-profundidade (relay sem validação não derruba o cliente).
      return isHex64(getTag(event, 'e'))
    case DRIFT_KIND.REPORT:
      return isHex64(getTag(event, 'e')) && getTag(event, 'reason') !== null
    default:
      return false
  }
}

// ─── Persist handlers ────────────────────────────────────────────────

async function persistPost(event: SignedEvent): Promise<void> {
  // posts.id = event.id (hex 64). Antes usávamos uma UUID na tag `d`,
  // mas isso violava NIP-01 quando o id era referenciado em `e` por
  // SPREAD/BURY/REPORT (tag `e` exige hex 64). Agora `event.id` é a
  // identidade canônica do post — local e na rede.
  const postId = event.id
  await db.run(
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
  await updateUserActivity(event.pubkey, event.created_at)
  // post novo: feed precisa aparecer no topo (score 0 + recente)
  invalidateFeed()
  scheduleScoreRecalc(postId)
}

async function persistSpread(event: SignedEvent): Promise<void> {
  const postId = getTag(event, 'e')!
  await db.run(
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

async function persistBury(event: SignedEvent): Promise<void> {
  const postId = getTag(event, 'e')!
  await db.run(
    `INSERT OR IGNORE INTO buries
     (post_id, burier_pub, created_at, event_id, raw_event)
     VALUES (?, ?, ?, ?, ?)`,
    [postId, event.pubkey, event.created_at, event.id, JSON.stringify(event)],
  )
  await updateUserActivity(event.pubkey, event.created_at)
  invalidateFeed() // mesmo motivo de persistSpread — race spread-antes-do-post
  scheduleScoreRecalc(postId)
  // bury NÃO penaliza o autor — diferença filosófica central
}

async function persistReport(event: SignedEvent): Promise<void> {
  const postId = getTag(event, 'e')!
  const reasonTag = getTag(event, 'reason')
  const reason = isValidReason(reasonTag) ? reasonTag : 'spam'

  // Peso do reporter: anti-sybil. Identidade nova vale menos (manifesto §26).
  // O peso pode ser 0 se o reporter é desconhecido pra este cliente — nesse
  // caso `getReportWeight` aplica o tier mais baixo (0.5).
  const reporterWeightCalc = await calculateUserWeight(event.pubkey, Date.now())
  const reporterWeight = getReportWeight(reporterWeightCalc.weight)

  try {
    await db.run(
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
  await db.run(
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

interface PostRow {
  created_at: number
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
  // 1. Post info (existência + created_at)
  const postRow = await db.get<PostRow>(
    `SELECT created_at FROM posts WHERE id = ?`,
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
    // Nenhuma ação — score puro por idade.
    const score = calculateScoreNow(0, 0, postRow.created_at)
    await db.run(
      `UPDATE posts SET score = ?, spreads = 0, buries = 0 WHERE id = ?`,
      [score, postId],
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
  const score = calculateScoreNow(spreadWeight, buryWeight, postRow.created_at)
  await db.run(
    `UPDATE posts SET score = ?, spreads = ?, buries = ? WHERE id = ?`,
    [score, spreadCount, buryCount, postId],
  )
  invalidateFeed()
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
