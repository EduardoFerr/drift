/**
 * Contágio local — aba "Contágio" (Fase 1). Manifesto §24 (emendado em
 * 2026-11-05): as regras são públicas e determinísticas; as entradas são
 * as do próprio leitor.
 *
 * Um post chega ao leitor quando pessoas que ele segue deram DRIFT nele
 * nas últimas 48 h e a soma da força desses vínculos chega a 0,8. A força
 * de cada vínculo sai só de dados locais do leitor:
 *
 *   - follow ........................................ 0,5
 *   - follow + o leitor já impulsionou algo da pessoa  0,8  (vínculo conquistado)
 *   - cada post da pessoa (ou trazido por ela) que o leitor DENUNCIOU: −0,5,
 *     permanente (recuperar é explorável por quem oscila — TrustGuard, WWW
 *     2005). O SINK do leitor não pune ninguém: é gosto (§23).
 *
 * Teto para vínculos fracos (≤ 0,5): somados, valem no máximo 0,5 por post
 * — no DRIFT, na vacina e na quarentena. Contas que o leitor só segue nunca
 * trazem nem escondem nada sozinhas, por mais que sejam.
 *
 * SINK dos contatos vacina (subtrai); denúncias dos contatos somando 1,0
 * põem o post em quarentena para o leitor. Posts recentes de quem o leitor
 * segue entram direto, enquanto o vínculo com o autor for positivo.
 *
 * Gesto do leitor "não trazer mais por X" (local, desfazível): os DRIFTs de
 * X deixam de trazer post; os posts diretos de X, o SINK e a denúncia de X
 * continuam valendo. Com denúncia em 10% dos spams vistos, usado em 20% das
 * vezes, segura a isca (Docs/spec-revisao-contagio.md §4.8).
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
  /** Post com mais de 4 dias não entra pelo contágio (igual à simulação). */
  POST_MAX_AGE_S: 96 * 3600,
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
  /**
   * Gesto local "não trazer mais por X": os DRIFTs destes contatos não
   * trazem post. O resto continua — os posts diretos deles, o SINK
   * (vacina) e a denúncia (quarentena). Desfazível; nunca publicado.
   */
  noBring?: ReadonlySet<string>
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
  /** Contato de maior vínculo que trouxe o post; null se entrou direto. */
  via: string | null
  /** Todos os empatados no maior vínculo: cada um leva a experiência ruim
   *  inteira (ninguém escapa da culpa escolhendo a própria chave), e a
   *  pílula mostra todos. */
  viaAll: string[]
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
  const { viewer, nowSec, follows, earned, strikes, noBring } = input
  const tie = (pub: string) => tieOf(pub, follows, earned, strikes)
  const posts = new Map<string, ContagionPost>()
  for (const p of input.posts) posts.set(p.id, p)

  // Teto simétrico: vínculos fracos (≤ 0,5) somam no máximo WEAK_CAP também
  // na vacina e na quarentena — duas contas só seguidas não escondem nada
  // sozinhas (difamação), do mesmo jeito que não trazem nada sozinhas.
  interface Sum { strong: number; weak: number }
  interface Acc { up: Sum; vac: Sum; quar: Sum; contributors: { pub: string; tie: number }[] }
  const acc = new Map<string, Acc>()
  const get = (id: string): Acc => {
    let a = acc.get(id)
    if (!a) acc.set(id, (a = { up: { strong: 0, weak: 0 }, vac: { strong: 0, weak: 0 }, quar: { strong: 0, weak: 0 }, contributors: [] }))
    return a
  }
  const add = (sum: Sum, t: number) => { if (t > CONTAGION.TIE_FOLLOW) sum.strong += t; else sum.weak += t }
  const total = (sum: Sum) => sum.strong + Math.min(sum.weak, CONTAGION.WEAK_CAP)

  for (const a of latestActions(input.actions).values()) {
    // DRIFT vale 48 h; o SINK de um contato vale enquanto o post puder entrar
    // (4 dias), senão o atacante só republica o DRIFT depois que a vacina expira.
    const window = a.kind === 'bury' ? CONTAGION.POST_MAX_AGE_S : CONTAGION.SPREAD_WINDOW_S
    if (a.actor === viewer || nowSec - a.createdAt > window) continue
    // Ação do próprio autor no próprio post não conta (como no ranking
    // canônico): republicar o DRIFT não mantém um post velho na aba.
    if (posts.get(a.postId)?.author === a.actor) continue
    const t = tie(a.actor)
    if (t <= 0) continue
    if (a.kind === 'bury') { add(get(a.postId).vac, t); continue }
    // "não trazer mais por X": o DRIFT de X não traz (o resto de X vale)
    if (noBring?.has(a.actor)) continue
    const s = get(a.postId)
    add(s.up, t)
    s.contributors.push({ pub: a.actor, tie: t })
  }

  for (const r of input.reports) {
    if (r.reporter === viewer || nowSec - r.createdAt > CONTAGION.REPORT_WINDOW_S) continue
    const t = tie(r.reporter)
    if (t > 0) add(get(r.postId).quar, t)
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
    const weak = Math.min(s.up.weak, CONTAGION.WEAK_CAP)
    const score = s.up.strong + weak
    const vaccine = total(s.vac)
    const quarantine = total(s.quar)
    const contributors = s.contributors.sort((x, y) => y.tie - x.tie || (x.pub < y.pub ? -1 : x.pub > y.pub ? 1 : 0))
    const net = (direct ? CONTAGION.DIRECT_WEIGHT : 0) + score - vaccine
    const fresh = nowSec - post.createdAt <= CONTAGION.POST_MAX_AGE_S
    const pass = quarantine < CONTAGION.QUARANTINE && net > 0 && (direct || (fresh && score >= CONTAGION.THRESHOLD))
    // Post direto veio pelo follow no autor, não por quem impulsionou: não
    // há "quem trouxe" (nem pílula, nem culpa de terceiros).
    const top = direct ? [] : contributors.filter((c) => c.tie === contributors[0]?.tie)
    out.set(postId, {
      postId,
      pass,
      score,
      strong: s.up.strong,
      weak,
      vaccine,
      quarantine,
      direct,
      contributors,
      via: top[0]?.pub ?? null,
      viaAll: top.map((c) => c.pub),
    })
  }
  return out
}
