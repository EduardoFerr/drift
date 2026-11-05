/**
 * Dados da aba Contágio: lê do SQLite o que `computeContagion` precisa e
 * guarda as experiências ruins do leitor. Tudo local — nada disto é
 * publicado nem sai do dispositivo (manifesto §28).
 *
 * "Quem trouxe" (via) é inferido na hora, a partir dos vínculos do próprio
 * leitor, e fica só em memória: o protocolo não registra proveniência
 * (cascade.ts), e esta camada não muda isso.
 */

import { db } from './db'
import {
  CONTAGION,
  computeContagion,
  type ContagionAction,
  type ContagionInput,
  type ContagionPost,
  type ContagionReport,
  type ContagionVerdict,
} from './contagion'

/** Folga confortável abaixo do limite de parâmetros do SQLite. */
const IN_CHUNK = 500

async function selectIn<T>(values: readonly string[], run: (placeholders: string, chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const chunk = values.slice(i, i + IN_CHUNK)
    out.push(...(await run(chunk.map(() => '?').join(','), chunk)))
  }
  return out
}

/** Contato de maior vínculo que trouxe cada post na última leitura da aba. */
const lastVia = new Map<string, string>()

export async function loadContagionInput(viewer: string, follows: ReadonlySet<string>, nowSec: number): Promise<ContagionInput> {
  const contacts = [...follows].filter((p) => p !== viewer).sort()

  // Vínculo conquistado: autores de posts que o leitor impulsionou, contando
  // só a ação líquida (DRIFT não desfeito por SINK posterior).
  const earnedRows = await db.exec<{ author: string; n: number }>(
    `SELECT p.author_pub AS author, COUNT(*) AS n
       FROM spreads s JOIN posts p ON p.id = s.post_id
      WHERE s.spreader_pub = ?
        AND NOT EXISTS (SELECT 1 FROM buries b
                         WHERE b.post_id = s.post_id AND b.burier_pub = s.spreader_pub
                           AND b.created_at > s.created_at)
      GROUP BY p.author_pub`,
    [viewer],
  )
  const strikeRows = await db.exec<{ pub: string; n: number }>(
    `SELECT subject_pub AS pub, COUNT(*) AS n FROM contagion_strikes GROUP BY subject_pub`,
  )

  const actionSince = nowSec - CONTAGION.SPREAD_WINDOW_S
  const spreads = await selectIn(contacts, (ph, chunk) =>
    db.exec<{ postId: string; actor: string; createdAt: number }>(
      `SELECT post_id AS postId, spreader_pub AS actor, created_at AS createdAt
         FROM spreads WHERE created_at >= ? AND spreader_pub IN (${ph})`,
      [actionSince, ...chunk],
    ),
  )
  const buries = await selectIn(contacts, (ph, chunk) =>
    db.exec<{ postId: string; actor: string; createdAt: number }>(
      `SELECT post_id AS postId, burier_pub AS actor, created_at AS createdAt
         FROM buries WHERE created_at >= ? AND burier_pub IN (${ph})`,
      [actionSince, ...chunk],
    ),
  )
  const reports = await selectIn(contacts, (ph, chunk) =>
    db.exec<ContagionReport>(
      `SELECT post_id AS postId, reporter_pub AS reporter, created_at AS createdAt
         FROM reports WHERE created_at >= ? AND reporter_pub IN (${ph})`,
      [nowSec - CONTAGION.REPORT_WINDOW_S, ...chunk],
    ),
  )
  const direct = await selectIn(contacts, (ph, chunk) =>
    db.exec<ContagionPost>(
      `SELECT id, author_pub AS author, created_at AS createdAt
         FROM posts WHERE created_at >= ? AND author_pub IN (${ph})`,
      [nowSec - CONTAGION.DIRECT_WINDOW_S, ...chunk],
    ),
  )

  const actions: ContagionAction[] = [
    ...spreads.map((a) => ({ ...a, kind: 'spread' as const })),
    ...buries.map((a) => ({ ...a, kind: 'bury' as const })),
  ]
  const known = new Set(direct.map((p) => p.id))
  const missing = [...new Set([...actions.map((a) => a.postId), ...reports.map((r) => r.postId)])].filter((id) => !known.has(id)).sort()
  const targets = await selectIn(missing, (ph, chunk) =>
    db.exec<ContagionPost>(`SELECT id, author_pub AS author, created_at AS createdAt FROM posts WHERE id IN (${ph})`, chunk),
  )

  return {
    viewer,
    nowSec,
    follows,
    earned: new Map(earnedRows.map((r) => [r.author, Number(r.n)])),
    strikes: new Map(strikeRows.map((r) => [r.pub, Number(r.n)])),
    actions,
    reports,
    posts: [...direct, ...targets],
  }
}

/** Calcula a aba e devolve os veredictos; memoriza "quem trouxe" para o SINK. */
export async function computeContagionFor(viewer: string, follows: ReadonlySet<string>, nowSec: number): Promise<Map<string, ContagionVerdict>> {
  const verdicts = computeContagion(await loadContagionInput(viewer, follows, nowSec))
  lastVia.clear()
  for (const v of verdicts.values()) if (v.pass && v.via) lastVia.set(v.postId, v.via)
  return verdicts
}

/**
 * SINK ou denúncia do leitor: experiência ruim com o autor e com quem
 * trouxe o post. Uma linha por (pessoa, post) — enterrar e denunciar o
 * mesmo post conta uma vez. Permanente (Docs/algoritmos.md §9).
 */
export async function recordBadExperience(postId: string, authorPub: string, nowMs = Date.now()): Promise<void> {
  const subjects = new Set([authorPub])
  const via = lastVia.get(postId)
  if (via) subjects.add(via)
  const at = Math.floor(nowMs / 1000)
  await db.batch(
    [...subjects].map((pub) => ({
      sql: `INSERT OR IGNORE INTO contagion_strikes (subject_pub, post_id, created_at) VALUES (?, ?, ?)`,
      params: [pub, postId, at],
    })),
  )
}

/** O leitor desfez o SINK (impulsionou o post): apaga a experiência daquele
 *  post. Corrigir um engano não é esquecer com o tempo — o atacante não
 *  tem como provocar isto no lugar do leitor. */
export async function forgetBadExperience(postId: string): Promise<void> {
  await db.run(`DELETE FROM contagion_strikes WHERE post_id = ?`, [postId])
}

/** Para testes. */
export function clearContagionMemory(): void {
  lastVia.clear()
}
