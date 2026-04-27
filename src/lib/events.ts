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
import { calculateUserWeight } from './weight'
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

interface RecalcRow {
  created_at: number
  spreads: number
  buries: number
}

async function recalculateScore(postId: string): Promise<void> {
  const row = await db.get<RecalcRow>(
    `SELECT
       p.created_at,
       (SELECT COUNT(*) FROM spreads WHERE post_id = p.id) AS spreads,
       (SELECT COUNT(*) FROM buries  WHERE post_id = p.id) AS buries
     FROM posts p
     WHERE p.id = ?`,
    [postId],
  )
  if (!row) return

  const score = calculateScoreNow(row.spreads, row.buries, row.created_at)
  await db.run(
    `UPDATE posts SET score = ?, spreads = ?, buries = ? WHERE id = ?`,
    [score, row.spreads, row.buries, postId],
  )
  // score mudou: feed precisa reordenar
  invalidateFeed()
}
