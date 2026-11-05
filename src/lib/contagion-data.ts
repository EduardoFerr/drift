/**
 * Dados da aba Contágio: lê do SQLite o que `computeContagion` precisa e
 * guarda "quem trouxe" o que o leitor denunciou. Nada disto é publicado
 * nem sai do dispositivo (manifesto §28).
 *
 * Experiência ruim = DENÚNCIA do leitor (intenção explícita: "isto é
 * spam/abuso"). O SINK não pune ninguém — é gosto ("não quero ver isto"),
 * vacina os contatos e esconde o post para o leitor (§23: bury não pune o
 * autor). A simulação mostrou por quê: com SINK por gosto em 10% dos
 * posts honestos, punir no SINK zerava 24% dos vínculos honestos e
 * derrubava o alcance de 38% para 5%; punir só na denúncia defende igual
 * (isca 1,5% × 1,4%) sem esse custo (Docs/spec-revisao-contagio.md §4.6).
 *
 * - A parte do AUTOR sai das denúncias públicas do próprio leitor (tabela
 *   `reports`): recalculável a partir dos eventos, igual em todo aparelho.
 * - A parte de QUEM TROUXE é inferida na hora, a partir dos vínculos do
 *   leitor, e fica local (`contagion_bad_experiences`): o protocolo não
 *   registra proveniência (cascade.ts). O leitor VÊ quem trouxe no card
 *   (ContagionViaChip) — §24 emendado: nenhum sinal que ele não vê —, e só
 *   é punido quem trouxe quando a denúncia nasce na aba, à vista.
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

/** Contatos empatados no maior vínculo que trouxeram cada post, na última
 *  leitura da aba (o primeiro é o exibido no card). */
const lastVia = new Map<string, string[]>()

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
  // Experiências ruins: autor de cada post que o leitor denunciou (dos
  // eventos) + quem trouxe o que ele denunciou na aba (local). Uma por post.
  const strikeRows = await db.exec<{ pub: string; n: number }>(
    `SELECT pub, COUNT(DISTINCT post_id) AS n FROM (
       SELECT p.author_pub AS pub, r.post_id AS post_id
         FROM reports r JOIN posts p ON p.id = r.post_id WHERE r.reporter_pub = ?
       UNION
       SELECT subject_pub AS pub, post_id FROM contagion_bad_experiences WHERE viewer_pub = ?
     ) GROUP BY pub`,
    [viewer, viewer],
  )
  const earned = new Map(earnedRows.map((r) => [r.author, Number(r.n)]))
  const strikes = new Map(strikeRows.map((r) => [r.pub, Number(r.n)]))
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
  }
}

/** Calcula a aba e devolve os veredictos; memoriza "quem trouxe" para o card e a denúncia. */
export async function computeContagionFor(viewer: string, follows: ReadonlySet<string>, nowSec: number): Promise<Map<string, ContagionVerdict>> {
  const verdicts = computeContagion(await loadContagionInput(viewer, follows, nowSec))
  lastVia.clear()
  for (const v of verdicts.values()) if (v.pass && v.viaAll.length) lastVia.set(v.postId, v.viaAll)
  return verdicts
}

/** "Chegou por" exibido no card da aba Contágio (null = entrou direto). */
export function getArrivedVia(postId: string): string | null {
  return lastVia.get(postId)?.[0] ?? null
}

/**
 * Denúncia feita na aba Contágio: registra como experiência ruim quem trouxe
 * o post — todos os empatados no maior vínculo, para ninguém escapar da
 * culpa escolhendo a chave. A do autor não precisa ser gravada: sai da
 * própria denúncia publicada. Uma por (pessoa, post). Permanente: na
 * simulação, deixá-la expirar devolveu o ataque de quem oscila.
 */
export async function recordReportedVia(postId: string, nowMs = Date.now()): Promise<void> {
  const viewer = await getCurrentNpub()
  const vias = (lastVia.get(postId) ?? []).filter((p) => p !== viewer)
  if (!viewer || vias.length === 0) return
  const at = Math.floor(nowMs / 1000)
  await db.batch(
    vias.map((pub) => ({
      sql: `INSERT OR IGNORE INTO contagion_bad_experiences (viewer_pub, subject_pub, post_id, created_at) VALUES (?, ?, ?, ?)`,
      params: [viewer, pub, postId, at],
    })),
  )
}

/** Para testes. */
export function clearContagionMemory(): void {
  lastVia.clear()
}
