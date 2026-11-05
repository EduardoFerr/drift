/**
 * Contágio local — aba "Contágio" (Fase 1). Manifesto §24 (emendado em
 * 2026-11-05): as regras são públicas e determinísticas; as entradas são
 * as do próprio leitor.
 *
 * Um post chega ao leitor quando pessoas que ele segue deram DRIFT nele
 * nas últimas 48 h e a soma da força desses vínculos passa de 0,8. A força
 * de cada vínculo sai só de dados locais do leitor:
 *
 *   - follow ........................................ 0,5
 *   - follow + o leitor já impulsionou algo da pessoa  0,8  (vínculo conquistado)
 *   - cada SINK/denúncia do leitor contra conteúdo que veio pela pessoa: −0,5,
 *     permanente (recuperar é explorável por quem oscila — TrustGuard, WWW 2005)
 *
 * Teto para vínculos fracos (≤ 0,5): somados, valem no máximo 0,5 por post.
 * Contas que o leitor só segue nunca passam o limiar sozinhas, por mais
 * que sejam (fazenda que ganha follow de volta, revezando ou camuflada).
 *
 * SINK dos contatos vacina (subtrai); denúncias dos contatos somando 1,0
 * põem o post em quarentena para o leitor. Posts recentes de quem o leitor
 * segue entram direto, enquanto o vínculo com o autor for positivo.
 *
 * Tudo em décimos inteiros: a soma não depende da ordem de chegada
 * (Docs/algoritmos.md §9; simulação em Docs/simulacao-contagio/).
 */

export const CONTAGION = {
  /** Limiar para um post entrar pelo contágio (0,8). */
  THRESHOLD: 8,
  /** Vínculos fracos (≤ 0,5) somam no máximo isto por post (0,5). */
  WEAK_CAP: 5,
  TIE_FOLLOW: 5,
  TIE_EARNED: 8,
  /** Cada experiência ruim tira 0,5 do vínculo. */
  STRIKE_PENALTY: 5,
  /** Denúncias de contatos somando 1,0 escondem o post. */
  QUARANTINE: 10,
  /** Peso de um post direto (autor seguido) na conta de vacina. */
  DIRECT_WEIGHT: 10,
  SPREAD_WINDOW_S: 48 * 3600,
  DIRECT_WINDOW_S: 72 * 3600,
  REPORT_WINDOW_S: 14 * 86400,
} as const

export interface ContagionAction {
  postId: string
  actor: string
  kind: 'spread' | 'bury'
  createdAt: number
}

export interface ContagionReport {
  postId: string
  reporter: string
  createdAt: number
}

export interface ContagionPost {
  id: string
  author: string
  createdAt: number
}

export interface ContagionInput {
  viewer: string
  /** Unix seconds. */
  nowSec: number
  /** Quem o leitor segue (NIP-02). */
  follows: ReadonlySet<string>
  /** Autor → quantos posts dele o leitor impulsionou (ação líquida = DRIFT). */
  earned: ReadonlyMap<string, number>
  /** Pessoa → experiências ruins do leitor com conteúdo dela ou trazido por ela. */
  strikes: ReadonlyMap<string, number>
  /** DRIFTs e SINKs de contatos (a ação mais recente por pessoa e post vale). */
  actions: readonly ContagionAction[]
  reports: readonly ContagionReport[]
  /** Posts conhecidos localmente: alvos das ações e posts recentes de seguidos. */
  posts: readonly ContagionPost[]
}

export interface ContagionVerdict {
  postId: string
  pass: boolean
  /** Vínculos fortes + fracos (com teto), em décimos. */
  score: number
  strong: number
  /** Soma dos fracos já com o teto aplicado. */
  weak: number
  vaccine: number
  quarantine: number
  direct: boolean
  /** Quem impulsionou, maior vínculo primeiro (desempate pela chave). */
  contributors: { pub: string; tie: number }[]
  /** Contato de maior vínculo que trouxe o post; null se veio só direto. */
  via: string | null
}

/** Força do vínculo do leitor com `pub`, em décimos. 0 = sem vínculo. */
export function tieOf(
  pub: string,
  follows: ReadonlySet<string>,
  earned: ReadonlyMap<string, number>,
  strikes: ReadonlyMap<string, number>,
): number {
  if (!follows.has(pub)) return 0
  const base = (earned.get(pub) ?? 0) >= 1 ? CONTAGION.TIE_EARNED : CONTAGION.TIE_FOLLOW
  return Math.max(0, base - CONTAGION.STRIKE_PENALTY * (strikes.get(pub) ?? 0))
}

/** Desempate total e independente da ordem de chegada: mais recente vence;
 *  no empate exato, o SINK vence (conservador). */
function latestActions(actions: readonly ContagionAction[]): Map<string, ContagionAction> {
  const out = new Map<string, ContagionAction>()
  for (const a of actions) {
    const key = `${a.postId}\u0000${a.actor}`
    const prev = out.get(key)
    if (!prev || a.createdAt > prev.createdAt || (a.createdAt === prev.createdAt && a.kind === 'bury' && prev.kind === 'spread')) {
      out.set(key, a)
    }
  }
  return out
}

export function computeContagion(input: ContagionInput): Map<string, ContagionVerdict> {
  const { viewer, nowSec, follows, earned, strikes } = input
  const tie = (pub: string) => tieOf(pub, follows, earned, strikes)
  const posts = new Map<string, ContagionPost>()
  for (const p of input.posts) posts.set(p.id, p)

  interface Acc { strong: number; weakRaw: number; vaccine: number; quarantine: number; contributors: { pub: string; tie: number }[] }
  const acc = new Map<string, Acc>()
  const get = (id: string): Acc => {
    let a = acc.get(id)
    if (!a) acc.set(id, (a = { strong: 0, weakRaw: 0, vaccine: 0, quarantine: 0, contributors: [] }))
    return a
  }

  for (const a of latestActions(input.actions).values()) {
    if (a.actor === viewer || nowSec - a.createdAt > CONTAGION.SPREAD_WINDOW_S) continue
    const t = tie(a.actor)
    if (t <= 0) continue
    const s = get(a.postId)
    if (a.kind === 'bury') { s.vaccine += t; continue }
    if (t > CONTAGION.TIE_FOLLOW) s.strong += t
    else s.weakRaw += t
    s.contributors.push({ pub: a.actor, tie: t })
  }

  for (const r of input.reports) {
    if (r.reporter === viewer || nowSec - r.createdAt > CONTAGION.REPORT_WINDOW_S) continue
    const t = tie(r.reporter)
    if (t > 0) get(r.postId).quarantine += t
  }

  // Posts recentes de quem o leitor segue entram direto (se o vínculo
  // com o autor ainda for positivo).
  for (const p of input.posts) {
    if (p.author !== viewer && nowSec - p.createdAt <= CONTAGION.DIRECT_WINDOW_S && tie(p.author) > 0) get(p.id)
  }

  const out = new Map<string, ContagionVerdict>()
  for (const [postId, s] of acc) {
    const post = posts.get(postId)
    if (!post || post.author === viewer) continue
    const direct = nowSec - post.createdAt <= CONTAGION.DIRECT_WINDOW_S && tie(post.author) > 0
    const weak = Math.min(s.weakRaw, CONTAGION.WEAK_CAP)
    const score = s.strong + weak
    const contributors = s.contributors.sort((x, y) => y.tie - x.tie || (x.pub < y.pub ? -1 : x.pub > y.pub ? 1 : 0))
    const net = (direct ? CONTAGION.DIRECT_WEIGHT : 0) + score - s.vaccine
    const pass = s.quarantine < CONTAGION.QUARANTINE && net > 0 && (direct || score >= CONTAGION.THRESHOLD)
    out.set(postId, {
      postId,
      pass,
      score,
      strong: s.strong,
      weak,
      vaccine: s.vaccine,
      quarantine: s.quarantine,
      direct,
      contributors,
      via: contributors[0]?.pub ?? null,
    })
  }
  return out
}
