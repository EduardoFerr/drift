/**
 * Lente — a mistura (Docs/algoritmos.md §6; manifesto §24).
 *
 * Função pura que decide a ORDEM das abas Global e Em alta quando a lente
 * está ligada. Entradas, todas do leitor ou públicas: a aba como ela já é
 * (os N primeiros na ordem de sempre), os posts de quem ele segue que
 * passam no filtro da mesma aba (o feed já limita a 7 dias), e a força da
 * lente (0 a 100).
 *
 * Quem a lente adianta ("escolhidos"): posts de quem você segue com score
 * ≥ 0 (a comunidade não afundou), no máximo 2 por pessoa — os de mais
 * pontos. Um seguido que posta muito não toma a lente.
 *
 * Regra: a aba é refeita lugar a lugar, com uma cota — entre os p+1
 * primeiros lugares, pelo menos ⌊(p+1)·k/100⌋ são escolhidos (enquanto
 * houver): com k = 50, um lugar sim, um não; com k = 100, todos. Quando a
 * cota pede, entra o próximo escolhido; senão, o próximo do resto, na
 * ordem de sempre. Travas:
 *   - nunca rebaixa um escolhido: se ele já estava no lugar p da aba, fica
 *     no lugar p ou acima (os outros posts, inclusive outros de quem você
 *     segue, podem descer para abrir lugar — como os de qualquer pessoa);
 *   - a aba mantém o tamanho: escolhidos que estavam fora dela empurram
 *     para fora o fim da aba (nunca um escolhido).
 * Força 0 → a aba de sempre, os mesmos objetos na mesma ordem. Mais força
 * nunca põe um escolhido mais abaixo (o adiantamento da trava conta na
 * cota; por indução, até cada lugar há sempre pelo menos tantos escolhidos
 * quanto com força menor).
 *
 * As duas leituras (a aba e a rede) podem discordar se um evento chegar
 * entre elas. Para não rebaixar nem perder post nesse caso, um post que
 * está nas duas vale como a aba o leu, e os escolhidos que já estão na
 * aba vêm antes dos de fora, pelo lugar que têm nela.
 *
 * Determinismo (manifesto §7): as entradas são reordenadas pela ordem
 * canônica antes de tudo — score DESC, created_at DESC, id ASC, igual ao
 * `FEED_ORDER` do feed — então a ordem de chegada não muda nada. Só
 * inteiros e comparações; nenhum número da lente é gravado ou publicado.
 */

/** O mínimo de um post que a lente lê. */
export interface LensPost {
  readonly id: string
  /** Score decaído, o mesmo que ordena o feed (`score_now`). */
  readonly score: number
  /** unix seconds */
  readonly createdAt: number
  readonly authorPub: string
}

export interface MixInput<T extends LensPost> {
  /** A aba de sempre (os N primeiros na ordem canônica). */
  readonly tab: readonly T[]
  /** Posts de quem você segue que passam no filtro da mesma aba. */
  readonly network: readonly T[]
  /** Força da lente, 0 a 100 (fora disso é limitada). */
  readonly strengthPct: number
}

export interface MixResult<T extends LensPost> {
  readonly posts: T[]
  /** Posts que a lente adiantou: lugar de antes (null = estavam fora da
   *  aba) e lugar de agora, 0 = primeiro. */
  readonly lifted: Map<string, { from: number | null; to: number }>
}

/** No máximo quantos posts de cada pessoa a lente adianta. */
export const LENS_MAX_PER_AUTHOR = 2

/** A lente só adianta posts de até 7 dias (o feed aplica na consulta). */
export const LENS_MAX_AGE_DAYS = 7

const finite = (n: number) => (Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY)

/** Ordem canônica do feed: score DESC, created_at DESC, id ASC (como o SQL;
 *  score inválido conta como o mais baixo, como NULL no SQLite). */
export function canonicalCompare(a: LensPost, b: LensPost): number {
  const sa = finite(a.score)
  const sb = finite(b.score)
  if (sa !== sb) return sa < sb ? 1 : -1
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Cota da sua rede: com força k, quantos dos p+1 primeiros lugares são
 *  escolhidos (no mínimo, enquanto houver). */
export function networkQuota(p: number, k: number): number {
  return Math.floor(((p + 1) * k) / 100)
}

export function mixNetwork<T extends LensPost>(input: MixInput<T>): MixResult<T> {
  const k = Math.max(0, Math.min(100, Math.round(input.strengthPct)))
  const tab = [...input.tab].sort(canonicalCompare)
  if (k === 0 || tab.length === 0) return { posts: k === 0 ? tab : [], lifted: new Map() }

  const inTab = new Map<string, number>()
  tab.forEach((p, i) => inTab.set(p.id, i))

  // Escolhidos: score ≥ 0, até LENS_MAX_PER_AUTHOR por pessoa (os de mais
  // pontos). Post que está nas duas leituras vale como a aba o leu.
  const candidates = new Map<string, T>()
  for (const p of input.network) {
    if (candidates.has(p.id)) continue
    const i = inTab.get(p.id)
    candidates.set(p.id, i === undefined ? p : tab[i]!)
  }
  const perAuthor = new Map<string, number>()
  const chosen: T[] = []
  for (const p of [...candidates.values()].sort(canonicalCompare)) {
    if (!(finite(p.score) >= 0)) continue
    const n = perAuthor.get(p.authorPub) ?? 0
    if (n >= LENS_MAX_PER_AUTHOR) continue
    perAuthor.set(p.authorPub, n + 1)
    chosen.push(p)
  }
  // Os que já estão na aba, pelo lugar nela; depois os de fora, na ordem de sempre.
  const net = [
    ...chosen.filter((p) => inTab.has(p.id)).sort((a, b) => inTab.get(a.id)! - inTab.get(b.id)!),
    ...chosen.filter((p) => !inTab.has(p.id)),
  ]
  const chosenIds = new Set(net.map((p) => p.id))
  const rest = tab.filter((p) => !chosenIds.has(p.id))

  const out: T[] = []
  const lifted = new Map<string, { from: number | null; to: number }>()
  let i = 0
  let j = 0
  for (let p = 0; out.length < tab.length; p++) {
    const head = net[i]
    const due = head !== undefined && (inTab.get(head.id) ?? Number.POSITIVE_INFINITY) <= p
    if (head !== undefined && (i < networkQuota(p, k) || due || j >= rest.length)) {
      const from = inTab.get(head.id)
      if (from === undefined || from > out.length) lifted.set(head.id, { from: from ?? null, to: out.length })
      out.push(head)
      i++
    } else if (j < rest.length) {
      out.push(rest[j++]!)
    } else break
  }
  return { posts: out, lifted }
}
