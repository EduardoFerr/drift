/**
 * Dados da aba Contágio: lê do SQLite o que `computeContagion` precisa e
 * guarda as experiências ruins do leitor. Nada disto é publicado nem sai do
 * dispositivo (manifesto §28).
 *
 * Experiência ruim = DENÚNCIA do leitor (intenção explícita: "isto é
 * spam/abuso"). O SINK não pune ninguém — é gosto ("não quero ver isto"),
 * vacina os contatos e tira o post da tela do leitor (§23: bury não pune o
 * autor). A simulação mostrou por quê: com SINK por gosto em 10% dos posts
 * honestos, punir no SINK zerava 25% dos vínculos honestos e derrubava o
 * alcance de 29% para 5%; o preço de punir só na denúncia é a isca passar
 * mais (2,9% × 1,4%) — Docs/spec-revisao-contagio.md §4.6.
 *
 * De onde vem cada experiência ruim:
 * - AUTOR: gravado no aparelho a cada denúncia feita aqui (em qualquer aba)
 *   e também derivado das denúncias do leitor que o sync trouxe (tabela
 *   `reports`, com o alvo da tag `p` quando o post não está no cache). A
 *   limpeza do cache (`evictOldPosts`) não apaga a punição: ela é
 *   permanente — deixá-la expirar devolve o ataque de quem oscila.
 * - QUEM TROUXE: só de denúncia feita na aba Contágio, e exatamente os
 *   contatos que a pílula "↪ chegou por" mostrava (`Post.arrivedVia`, o
 *   retrato daquela leitura). O protocolo não registra proveniência
 *   (cascade.ts): isto fica só no aparelho.
 */

import { db } from './db'
import { getCurrentNpub } from './identity'
import {
  CONTAGION,
  computeContagion,
  tieOf,
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

export async function loadContagionInput(viewer: string, follows: ReadonlySet<string>, nowSec: number): Promise<ContagionInput> {
  // Bloquear esconde posts E interações da pessoa (manifesto §24, filtro
  // local): quem o leitor bloqueou não traz, não vacina e não denuncia.
  // Silenciar só esconde posts — as interações continuam valendo.
  const blocked = new Set((await db.exec<{ npub: string }>(`SELECT npub FROM blocked`)).map((r) => r.npub))
  const effectiveFollows = new Set([...follows].filter((p) => p !== viewer && !blocked.has(p)))

  // Vínculo conquistado: autores de posts que o leitor impulsionou, contando
  // só a ação líquida (DRIFT não desfeito por SINK posterior; no empate
  // exato, o SINK vence — igual ao ranking canônico).
  const earnedRows = await db.exec<{ author: string; n: number }>(
    `SELECT p.author_pub AS author, COUNT(*) AS n
       FROM spreads s JOIN posts p ON p.id = s.post_id
      WHERE s.spreader_pub = ?
        AND NOT EXISTS (SELECT 1 FROM buries b
                         WHERE b.post_id = s.post_id AND b.burier_pub = s.spreader_pub
                           AND b.created_at >= s.created_at)
      GROUP BY p.author_pub`,
    [viewer],
  )
  // Experiências ruins: autor de cada post que o leitor denunciou (do
  // cache ou do alvo gravado na denúncia) + registro local (autor e quem
  // trouxe). Uma por pessoa e post.
  const strikeRows = await db.exec<{ pub: string; n: number }>(
    `SELECT pub, COUNT(DISTINCT post_id) AS n FROM (
       SELECT COALESCE(p.author_pub, r.target_pub) AS pub, r.post_id AS post_id
         FROM reports r LEFT JOIN posts p ON p.id = r.post_id
        WHERE r.reporter_pub = ? AND COALESCE(p.author_pub, r.target_pub) IS NOT NULL
       UNION
       SELECT subject_pub AS pub, post_id FROM contagion_bad_experiences WHERE viewer_pub = ?
     ) GROUP BY pub`,
    [viewer, viewer],
  )
  const earned = new Map(earnedRows.map((r) => [r.author, Number(r.n)]))
  const strikes = new Map(strikeRows.map((r) => [r.pub, Number(r.n)]))
  // Gesto "não trazer mais por X" do leitor: os DRIFTs de X não trazem.
  const noBring = new Set(
    (await db.exec<{ pub: string }>(`SELECT subject_pub AS pub FROM contagion_no_bring WHERE viewer_pub = ?`, [viewer])).map((r) => r.pub),
  )
  // Só quem ainda tem vínculo pesa: zerados nem entram na SQL (custo).
  const contacts = [...effectiveFollows].filter((p) => tieOf(p, effectiveFollows, earned, strikes) > 0).sort()

  // A ação mais recente de cada contato vale: busca a janela mais larga
  // (SINK vale enquanto o post puder entrar) e o núcleo aplica cada janela.
  const actionSince = nowSec - CONTAGION.POST_MAX_AGE_S
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
    follows: effectiveFollows,
    earned,
    strikes,
    actions,
    reports,
    posts: [...direct, ...targets],
    noBring,
  }
}

/**
 * Gesto "não trazer mais por X" (pílula ↪ da aba Contágio): liga ou
 * desliga para a identidade atual. Local e desfazível — "perdoar" aqui não
 * é a oscilação que o TrustGuard descreve, porque só o leitor dispara.
 */
export async function setNoBring(subjectPub: string, on: boolean, nowMs = Date.now()): Promise<void> {
  const viewer = await getCurrentNpub()
  if (!viewer || subjectPub === viewer) return
  if (on) {
    await db.run(
      `INSERT OR IGNORE INTO contagion_no_bring (viewer_pub, subject_pub, created_at) VALUES (?, ?, ?)`,
      [viewer, subjectPub, Math.floor(nowMs / 1000)],
    )
  } else {
    await db.run(`DELETE FROM contagion_no_bring WHERE viewer_pub = ? AND subject_pub = ?`, [viewer, subjectPub])
  }
}

/** Quem a identidade atual pediu para não trazer mais (mais recente primeiro). */
export async function listNoBring(): Promise<{ npub: string; at: number }[]> {
  const viewer = await getCurrentNpub()
  if (!viewer) return []
  const rows = await db.exec<{ pub: string; t: number }>(
    `SELECT subject_pub AS pub, created_at AS t FROM contagion_no_bring WHERE viewer_pub = ? ORDER BY created_at DESC, subject_pub`,
    [viewer],
  )
  return rows.map((r) => ({ npub: r.pub, at: Number(r.t) * 1000 }))
}

/** Calcula a aba: veredicto de cada post candidato (função pura sobre o SQLite). */
export async function computeContagionFor(viewer: string, follows: ReadonlySet<string>, nowSec: number): Promise<Map<string, ContagionVerdict>> {
  return computeContagion(await loadContagionInput(viewer, follows, nowSec))
}

/**
 * Denúncia feita pelo leitor: grava a experiência ruim com o AUTOR (em
 * qualquer aba) e com cada contato que a pílula "↪ chegou por" mostrava
 * quando ele abriu a denúncia (`vias` — vazio fora da aba Contágio). Uma
 * por (pessoa, post), permanente: na simulação, deixá-la expirar devolveu
 * o ataque de quem oscila.
 */
export async function recordReport(postId: string, authorPub: string, vias: readonly string[], nowMs = Date.now()): Promise<void> {
  const viewer = await getCurrentNpub()
  if (!viewer) return
  const subjects = [...new Set([authorPub, ...vias])].filter((p) => p && p !== viewer)
  if (subjects.length === 0) return
  const at = Math.floor(nowMs / 1000)
  await db.batch(
    subjects.map((pub) => ({
      sql: `INSERT OR IGNORE INTO contagion_bad_experiences (viewer_pub, subject_pub, post_id, created_at) VALUES (?, ?, ?, ?)`,
      params: [viewer, pub, postId, at],
    })),
  )
}

/** Remover uma identidade apaga também o que ela registrou aqui (§4, §28). */
export async function forgetIdentityContagion(viewer: string): Promise<void> {
  await db.run(`DELETE FROM contagion_bad_experiences WHERE viewer_pub = ?`, [viewer])
  await db.run(`DELETE FROM contagion_no_bring WHERE viewer_pub = ?`, [viewer])
}
