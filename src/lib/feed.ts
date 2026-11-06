/**
 * Leitura do feed a partir do SQLite.
 *
 * Esta camada existe para que a UI nunca toque em SQL diretamente.
 * Mantém o resto do app desacoplado do schema.
 *
 * Filtra posts moderados (score = -999) e ordena por score DESC.
 * Para MVP suportamos apenas a aba 'global' — 'following' e 'trending'
 * entram na Fase 4.
 *
 * Reatividade: a store `useFeedStore` mantém o array de posts atual.
 * `invalidateFeed()` (debounced 150ms) é chamado em `onNostrEvent`
 * após cada persist; ele dispara um refresh do SQLite. UI consome
 * via hook e re-renderiza apenas quando o feed real muda — sem poll.
 */

import { create } from 'zustand'
import { db } from './db'
import { hiddenReason, useModLocalStore } from './moderation-local'
import { useFollowsStore } from './follows'
import { getCurrentNpub } from './identity'
import { applyActiveLens, activeLensNeedsNetwork } from './lens/init'
import { useLensRegistryStore } from './lens/registry'
import { LENS_MAX_AGE_DAYS } from './lens/order'
import { useLensStore } from './trust-lens'
import { normalizeLayout } from '../types/drift'
import { parseImetaTag as parseImetaTagSync, type BlobMeta } from './nip94'
import { FEED_INITIAL_LIMIT, FEED_QUEUE_CAP } from '../config/constants'
import type {
  Post,
  Subpost,
  GeoPoint,
  ContentWarning,
  FeedTab,
  RenderHint,
  UserPrefs,
} from '../types/drift'

/**
 * Decay temporal aplicado na LEITURA (correção de D1, auditoria
 * 2026-10-13).
 *
 * Antes, o feed ordenava por `posts.score`, uma coluna materializada que
 * só era reescrita quando chegava evento novo NAQUELE post. A idade
 * usada no cálculo congelava no instante do último spread, então o decay
 * nunca acontecia: um post de 48h com spreads concentrados na 1ª hora
 * ficava gravado 125× acima do valor correto, permanentemente. O feed
 * virava um pódio imóvel — exatamente o que o manifesto §24 diz evitar.
 *
 * Agora `posts.score_base` guarda só o numerador (invariante no tempo) e
 * o divisor é calculado aqui, a cada leitura. Nenhum job periódico
 * reescreve a tabela; o tempo passa porque a query sabe que horas são.
 *
 * `now` entra por parâmetro, nunca via relógio implícito — manifesto §7
 * (determinismo): mesma entrada, mesma saída.
 *
 * Réplica exata de `scoring.ts:decayDivisor`. A paridade entre as duas
 * é travada por `tests/score-decay-parity.test.ts`, que roda a SQL e o
 * TS sobre os mesmos inputs. `pow()` está disponível no build pinado do
 * sqlite-wasm (verificado em runtime no Chromium).
 *
 * `max(0, idade)` espelha o `Math.max(0, ageHours)` do TS. Sem ele
 * (auditoria 2026-11-03, C1), `created_at` no futuro dava divisor < 2^1.5
 * — boost de até ~89× com +1h54 — e, além de +2h, `pow` de base negativa
 * virava NULL e jogava o post pro fim. O gate de `MAX_FUTURE_SKEW_SECONDS`
 * já barra o grosso; o clamp fecha a janela de tolerância.
 */
const DECAYED_SCORE = `(p.score_base / pow(max(0, (? - p.created_at) / 3600.0) + 2, 1.5))`

/**
 * O valor decaído é SELECIONADO como `score_now` e é ele que vira
 * `Post.score` em `rowToPost`. Isso não é detalhe de implementação: se
 * a UI exibisse a coluna materializada enquanto o feed ordena pelo
 * valor decaído, o número mostrado não explicaria a ordem — a mesma
 * incoerência que o manifesto §22 (algoritmo legível) proíbe.
 *
 * Ordenar pelo ALIAS (e não repetir a expressão) mantém um único `?`
 * de relógio por query, na posição do SELECT, que vem antes dos
 * parâmetros do WHERE e do LIMIT.
 */
const SCORE_NOW = `${DECAYED_SCORE} AS score_now`

/** Ordenação canônica do feed — manifesto §8 exige o `id ASC` final
 *  como desempate determinístico. */
const FEED_ORDER = `ORDER BY score_now DESC, p.created_at DESC, p.id ASC`

/** Relógio em unix seconds, no formato que a SQL espera. */
function nowSeconds(now: number): number {
  return Math.floor(now / 1000)
}

const REFRESH_DEBOUNCE_MS = 150
/** Janela do Trending — só posts publicados nas últimas N horas. */
const TRENDING_WINDOW_HOURS = 24

// ─── Queries puras ───────────────────────────────────────────────────

interface PostRow {
  id: string
  author_pub: string
  content: string
  created_at: number
  category: string | null
  location: string | null
  client: string | null
  content_warning: string | null
  /** Score materializado. Serve o sentinela -999, o VIRAL_PIN_THRESHOLD
   *  e o `reports_confirmed`. NÃO é o que ordena o feed desde D1. */
  score: number
  /** Numerador invariante no tempo, como gravado. */
  score_base: number
  /** Score COM o decay aplicado, calculado na query. É o que ordena o
   *  feed e o que a UI exibe. */
  score_now: number
  spreads: number
  buries: number
  /** raw_event JSON — usado pra extrair tags `imeta` no read path (B.2). */
  raw_event: string
  /**
   * Lily Sprint N+2 P2.11 — campos opt-in vindos do LEFT JOIN
   * `users_metadata` por `author_pub = npub`. Null quando o autor nunca
   * publicou kind 0 (modo Anônimo §5.3). Apenas decorativos — NÃO
   * participam de score/ranking (manifesto §22 LOCK_VIA_TEST).
   */
  author_name: string | null
  author_display_name: string | null
  author_picture: string | null
}

/**
 * Lily Sprint N+2 P2.11 — colunas do SELECT compartilhadas entre as
 * queries de feed. Sempre LEFT JOIN com `users_metadata` pra popular
 * `author_*` (decorativo opt-in, §5.3). LEFT (não INNER) preserva posts
 * de autores em modo Anônimo — não some do feed por falta de kind 0.
 *
 * Index `idx_users_metadata_nip05` existe; PK `npub` faz o JOIN ser O(1)
 * por row. Cost negligenciável vs cost da query base.
 */
const POST_SELECT = `SELECT
    p.id, p.author_pub, p.content, p.created_at, p.category, p.location,
    p.client, p.content_warning, p.score, p.score_base, ${SCORE_NOW},
    p.spreads, p.buries, p.raw_event,
    um.name AS author_name, um.display_name AS author_display_name,
    um.picture AS author_picture
  FROM posts p
  LEFT JOIN users_metadata um ON um.npub = p.author_pub`

export async function getGlobalFeed(limit = 50, now = Date.now()): Promise<Post[]> {
  const rows = await db.exec<PostRow>(
    `${POST_SELECT}
     WHERE p.score > -999
     ${FEED_ORDER}
     LIMIT ?`,
    [nowSeconds(now), limit],
  )
  return rows.map(rowToPost)
}

/**
 * Feed restrito a authors que o user atual está seguindo (NIP-02).
 * Manifesto §24: ranking dentro continua determinístico — só mudamos
 * o conjunto, não a ordem.
 *
 * Se o user não segue ninguém, retorna vazio. Não há fallback "global"
 * — UI mostra estado vazio com call-to-action pra seguir.
 */
export async function getFollowingFeed(limit = 50, now = Date.now()): Promise<Post[]> {
  const followingSet = useFollowsStore.getState().following
  if (followingSet.size === 0) return []

  const placeholders = Array.from(followingSet).map(() => '?').join(',')
  const rows = await db.exec<PostRow>(
    `${POST_SELECT}
     WHERE p.score > -999 AND p.author_pub IN (${placeholders})
     ${FEED_ORDER}
     LIMIT ?`,
    [nowSeconds(now), ...followingSet, limit],
  )
  return rows.map(rowToPost)
}

/**
 * Feed Trending — posts recentes (últimas 24h) ordenados por score.
 * Captura "o que está pegando" sem virar viés histórico.
 *
 * Diferença vs Global: filtro temporal estrito. Posts antigos com
 * score acumulado alto somem; posts novos com bom score aparecem.
 */
export async function getTrendingFeed(limit = 50, now = Date.now()): Promise<Post[]> {
  const cutoffSeconds = Math.floor((now - TRENDING_WINDOW_HOURS * 3600 * 1000) / 1000)
  const rows = await db.exec<PostRow>(
    `${POST_SELECT}
     WHERE p.score > -999 AND p.created_at >= ?
     ${FEED_ORDER}
     LIMIT ?`,
    [nowSeconds(now), cutoffSeconds, limit],
  )
  return rows.map(rowToPost)
}

/**
 * Aba Contágio (manifesto §24 emendado; Docs/algoritmos.md §9): o CONJUNTO
 * é o que chegou ao leitor pelas pessoas que ele segue — DRIFTs de
 * contatos somando 0,8, com teto para vínculos fracos, vacina e quarentena
 * dos contatos (src/lib/contagion.ts). A ORDEM continua a canônica: mesmas
 * entradas, mesmo feed, recalculável por qualquer um.
 *
 * Sem follows não há contágio: retorna vazio e a UI convida a seguir.
 */
export async function getContagionFeed(limit = 50, now = Date.now()): Promise<Post[]> {
  const follows = useFollowsStore.getState().following
  if (follows.size === 0) return []
  const viewer = await getCurrentNpub()
  if (!viewer) return []
  // Sob demanda: a aba é opcional, quem nunca a abre não baixa o motor.
  const { computeContagionFor } = await import('./contagion-data')
  const verdicts = await computeContagionFor(viewer, follows, nowSeconds(now))
  const ids = [...verdicts.values()].filter((v) => v.pass).map((v) => v.postId).sort()
  if (ids.length === 0) return []
  // Um parâmetro só (json_each): sem teto de parâmetros do SQLite, por
  // maior que seja o conjunto.
  const rows = await db.exec<PostRow>(
    `${POST_SELECT}
     WHERE p.score > -999 AND p.id IN (SELECT value FROM json_each(?))
     ${FEED_ORDER}
     LIMIT ?`,
    [nowSeconds(now), JSON.stringify(ids), limit],
  )
  // "Quem trouxe" viaja com o post: a pílula mostra e a denúncia pune
  // exatamente o que foi calculado nesta leitura (sem estado à parte).
  return rows.map((row) => {
    const post = rowToPost(row)
    const via = verdicts.get(post.id)?.viaAll ?? []
    return via.length > 0 ? { ...post, arrivedVia: via } : post
  })
}

/**
 * V9.20 — busca um Post pelo id no SQLite local. Usado pelo handler
 * de deep-link (`?p=<nevent>`) em App.tsx pra abrir PostViewer modal
 * com o post linkado depois do onNostrEvent ter materializado o row.
 * Retorna null se id não existir (ainda) localmente.
 */
export async function getPostById(id: string): Promise<Post | null> {
  const row = await db.get<PostRow>(
    `${POST_SELECT}
     WHERE p.id = ?
     LIMIT 1`,
    [id],
  )
  return row ? rowToPost(row) : null
}

/**
 * Dispatcher por tab — usado por `refreshFeed` pra escolher a query
 * correta baseado em `useFeedStore.tab`. `now` é um só por leitura: a aba e
 * os posts da sua rede (lente) usam o mesmo relógio, então o mesmo score.
 */
async function getFeedByTab(tab: FeedTab, limit: number, now: number): Promise<Post[]> {
  switch (tab) {
    case 'global':
      return getGlobalFeed(limit, now)
    case 'following':
      return getFollowingFeed(limit, now)
    case 'trending':
      return getTrendingFeed(limit, now)
    case 'contagio':
      return getContagionFeed(limit, now)
  }
}

// ─── Lente (manifesto §24; Docs/algoritmos.md §6) ───────────────────

/** Abas em que a lente mexe. Seguindo já é só a sua rede e Contágio já
 *  escolhe o conjunto pela sua rede — as duas ficam na ordem de sempre. */
const LENS_TABS: ReadonlySet<FeedTab> = new Set<FeedTab>(['global', 'trending'])

/**
 * Posts de quem o leitor segue (`authors`, "sua rede") que passam no filtro
 * da aba, na ordem canônica — os candidatos da lente. Mesmo SQL, mesmo
 * relógio e mesmo limite da aba (com a lente em 100%, no máximo `limit`
 * deles cabem). A lente só adianta posts de até 7 dias
 * (`LENS_MAX_AGE_DAYS`): no Global, sem isso, um post antigo com um voto
 * (score > 0 para sempre) passaria à frente de todo post novo sem voto. Em
 * alta já recorta 24 h.
 */
export async function getNetworkCandidates(
  tab: 'global' | 'trending',
  authors: readonly string[],
  limit: number,
  now: number,
): Promise<Post[]> {
  if (authors.length === 0) return []
  const params: unknown[] = [nowSeconds(now), JSON.stringify(authors)]
  const windowMs = tab === 'trending' ? TRENDING_WINDOW_HOURS * 3600 * 1000 : LENS_MAX_AGE_DAYS * 86_400_000
  const window = 'AND p.created_at >= ?'
  params.push(Math.floor((now - windowMs) / 1000))
  params.push(limit)
  const rows = await db.exec<PostRow>(
    `${POST_SELECT}
     WHERE p.score > -999 AND p.author_pub IN (SELECT value FROM json_each(?)) ${window}
     ${FEED_ORDER}
     LIMIT ?`,
    params,
  )
  return rows.map(rowToPost)
}

/**
 * Aplica a lente ativa à aba (só Global e Em alta). A aba chega na ordem
 * canônica; a lente decide a ordem final e, se pedir, recebe os posts de
 * quem o leitor segue — "sua rede" pela mesma regra da aba Contágio
 * (vínculo > 0: segue, não bloqueou, a denúncia dele não zerou), menos os
 * silenciados. Nada é gravado: o resultado vive só no store.
 */
async function withLens(tab: FeedTab, canonical: Post[], limit: number, now: number): Promise<Post[]> {
  if (!LENS_TABS.has(tab)) return canonical
  let network: Post[] = []
  let viewer: string | null = null
  if (activeLensNeedsNetwork()) {
    try {
      viewer = await getCurrentNpub()
      const follows = useFollowsStore.getState().following
      if (viewer && follows.size > 0) {
        const { lensNetworkAuthors } = await import('./contagion-data')
        const authors = (await lensNetworkAuthors(viewer, follows)).filter((a) => hiddenReason(a) === null)
        network = await getNetworkCandidates(tab as 'global' | 'trending', authors, limit, now)
      }
    } catch (err) {
      // A lente nunca derruba a aba: sem a sua rede, fica a ordem de sempre.
      console.warn('[lente] sem a sua rede nesta leitura; ordem de sempre:', err)
      network = []
    }
  }
  try {
    return [...applyActiveLens(canonical, { viewer, now, network })]
  } catch (err) {
    console.warn('[lente] falhou; ordem de sempre:', err)
    return canonical
  }
}

/**
 * Refaz a aba quando muda algo que a lente lê: força, lente ativa, quem o
 * leitor segue, bloqueios/silenciados. Debounced (invalidateFeed); só nas
 * abas em que a lente mexe. Devolve a função que desliga.
 */
export function startFeedLensSync(): () => void {
  const bump = () => {
    if (LENS_TABS.has(useFeedStore.getState().tab)) invalidateFeed()
  }
  const offs = [
    useLensStore.subscribe((s, prev) => { if (s.strength !== prev.strength) bump() }),
    useLensRegistryStore.subscribe((s, prev) => { if (s.activeId !== prev.activeId) bump() }),
    useFollowsStore.subscribe((s, prev) => { if (s.following !== prev.following) bump() }),
    useModLocalStore.subscribe((s, prev) => { if (s.blocked !== prev.blocked || s.muted !== prev.muted) bump() }),
  ]
  return () => { for (const off of offs) off() }
}

/** A ação LÍQUIDA do usuário corrente no post (a mais recente; no empate
 *  exato, o SINK — igual ao ranking canônico). Usado para destacar o botão
 *  e decidir se um DRIFT desfaz um SINK. Antes devolvia 'spread' se
 *  existisse qualquer spread, e DRIFT→SINK→DRIFT virava no-op. */
export async function getMyAction(
  postId: string,
  npub: string,
): Promise<'spread' | 'bury' | null> {
  const sp = await db.get<{ t: number }>(
    `SELECT created_at AS t FROM spreads WHERE post_id = ? AND spreader_pub = ? LIMIT 1`,
    [postId, npub],
  )
  const bu = await db.get<{ t: number }>(
    `SELECT created_at AS t FROM buries WHERE post_id = ? AND burier_pub = ? LIMIT 1`,
    [postId, npub],
  )
  if (bu && (!sp || bu.t >= sp.t)) return 'bury'
  if (sp) return 'spread'
  return null
}

// ─── Store reativa ───────────────────────────────────────────────────

interface FeedStore {
  posts: Post[]
  loaded: boolean
  /** Limite atual da query — FEED_INITIAL_LIMIT default, pode crescer
   *  com paginação (Tinder N/2 refill — vide BACKLOG). */
  limit: number
  /** Tab ativa do feed. Default 'global'. */
  tab: FeedTab
  /**
   * Timestamp ms da última `refreshFeed()` completa. Usado por UI pra
   * mostrar badge "atualizado há X" (Lily Tinder-audit 2026-05-21,
   * Item 3). `null` antes do primeiro refresh.
   *
   * Manifesto §28 OK: local-only, zero export. Apenas indicador visual
   * pro user — não persistido, não compartilhado.
   */
  snapshotTs: number | null
  /**
   * A primeira carga da aba atual falhou (ex.: o arquivo do motor da aba
   * Contágio sumiu do servidor depois de um deploy). A lista fica vazia e a
   * UI oferece recarregar — nunca os posts da aba anterior sob o rótulo
   * desta.
   */
  failed: boolean
  /**
   * Contador de POSTs novos recebidos via subscribe desde a última vez
   * que o user "marcou como visto" (refresh manual ou tab change).
   * Por tab — cada um conta separadamente. UI mostra badge "+N novos"
   * no botão refresh quando > 0. Reset em `markFeedSeen()`.
   *
   * Increment em `bumpUnseenCount()` chamado de `events.ts:persistPost`
   * APÓS detectar insert genuíno (`seenPostIds` set local descarta
   * duplicatas cross-relay). Manifesto §6 — verdade por eventos.
   */
  unseenByTab: Record<FeedTab, number>
}

export const useFeedStore = create<FeedStore>(() => ({
  posts: [],
  loaded: false,
  limit: FEED_INITIAL_LIMIT,
  tab: 'global',
  snapshotTs: null,
  failed: false,
  unseenByTab: { global: 0, following: 0, trending: 0, contagio: 0 },
}))

/**
 * Incrementa contador "novos não-vistos" de TODOS os tabs.
 * Chamado por `events.ts:persistPost` quando um POST genuinamente novo
 * (não duplicate cross-relay) entra no SQLite.
 *
 * Conservador: incrementa em todas as tabs porque na hora de receber
 * o evento não sabemos qual filter (global/following/trending) ele vai
 * passar. Trade-off: badge pode aparecer em "seguindo" mesmo se autor
 * não é seguido — refresh limpa, user vê que de fato nada novo
 * apareceu lá. Aceitável; alternativa exigia consultar prefs/follows
 * por evento (custo > valor).
 */
export function bumpUnseenCount(): void {
  useFeedStore.setState((s) => ({
    unseenByTab: {
      global: s.unseenByTab.global + 1,
      following: s.unseenByTab.following + 1,
      trending: s.unseenByTab.trending + 1,
      contagio: s.unseenByTab.contagio + 1,
    },
  }))
}

/**
 * Marca a tab ATUAL como "vista" — zera o contador. Chamado pelo botão
 * refresh manual e por tap-on-active-tab (FeedTabs). NÃO chamado por
 * `invalidateFeed` automático (preserva acúmulo entre boot/idle).
 */
export function markFeedSeen(): void {
  useFeedStore.setState((s) => ({
    unseenByTab: { ...s.unseenByTab, [s.tab]: 0 },
  }))
}

/**
 * Troca a tab do feed. Dispara refresh imediato pra a nova query
 * carregar — UI vê transição. Manifesto §24: cada tab é só uma view
 * sobre os mesmos dados, score determinístico inalterado.
 *
 * Zera unseenByTab[newTab] no switch — user trocou pra ela, vai ver o
 * conteúdo, dot indicator deve sumir imediatamente. Sem isso, badge
 * persiste mesmo após user "ver" a tab (combinado com bumpUnseenCount
 * que incrementa todas as tabs, criava sensação de "sempre tem novo").
 * User feedback 2026-05-08.
 */
export async function setFeedTab(tab: FeedTab): Promise<void> {
  if (useFeedStore.getState().tab === tab) return
  useFeedStore.setState((s) => ({
    tab,
    loaded: false,
    failed: false,
    unseenByTab: { ...s.unseenByTab, [tab]: 0 },
  }))
  await refreshFeed()
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshInFlight = false
let refreshPending = false
let feedHolds = 0
let refreshHeld = false

/**
 * Segura a atualização do feed enquanto uma folha que mora num card está
 * aberta (ex.: "chegou por", aba Contágio): um evento do relay recalcularia
 * a aba e tiraria o card — e a folha junto — da tela no meio da ação. Os
 * refreshes pedidos nesse meio-tempo viram um só, ao soltar. Devolve a
 * função que solta (idempotente).
 */
export function holdFeed(): () => void {
  feedHolds++
  let released = false
  return () => {
    if (released) return
    released = true
    feedHolds--
    if (feedHolds === 0 && refreshHeld) {
      refreshHeld = false
      invalidateFeed()
    }
  }
}

/**
 * Sinaliza que o feed precisa ser recarregado do SQLite. Debounced —
 * múltiplas invalidações em janela de 150ms colapsam em 1 query.
 *
 * Chamado por `onNostrEvent` após persistir POST/SPREAD/BURY/REPORT.
 * Re-querying o SQLite e diff-ando contra o estado é mais simples e
 * robusto do que tentar atualizar incrementalmente o array de posts.
 */
export function invalidateFeed(): void {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshFeed()
  }, REFRESH_DEBOUNCE_MS)
}

/**
 * Força refresh imediato (sem debounce). Útil em fluxos de UI que
 * precisam ver dados atualizados sincronamente — ex: depois de
 * `location.reload()` ou clearLocal.
 */
export async function refreshFeed(): Promise<void> {
  // Folha aberta sobre um card (holdFeed): roda quando ela fechar.
  if (feedHolds > 0) {
    refreshHeld = true
    return
  }
  // Coalesce: se já tem refresh rolando, marca pendente e sai. Quando
  // o atual terminar, dispara mais um.
  if (refreshInFlight) {
    refreshPending = true
    return
  }
  refreshInFlight = true
  const { limit, tab } = useFeedStore.getState()
  const now = Date.now()
  try {
    const rawPosts = await getFeedByTab(tab, limit, now)
    // A aba pode ter mudado enquanto a query rodava (a do Contágio é a mais
    // lenta): descarta o resultado velho e refaz para a aba atual, em vez de
    // gravar posts de uma aba sob o rótulo de outra com `loaded = true`.
    if (useFeedStore.getState().tab !== tab) {
      refreshPending = true
      return
    }
    // Lily Tinder-audit 2026-05-21 (Item 2): cap defensivo Zustand vs OOM
    // mobile low-end. SQLite já tem MAX_POSTS_CACHE (cache.ts) — este é
    // defesa em camada no array da store. Posts vêm ordenados por score
    // DESC, então truncar slice(0, CAP) preserva os mais relevantes.
    const canonical = rawPosts.length > FEED_QUEUE_CAP
      ? rawPosts.slice(0, FEED_QUEUE_CAP)
      : rawPosts
    // A lente (Global e Em alta) decide a ordem final sobre a aba já cortada:
    // o tamanho não muda. A aba pode ter mudado enquanto ela lia a sua rede.
    const posts = await withLens(tab, canonical, Math.min(limit, FEED_QUEUE_CAP), now)
    if (useFeedStore.getState().tab !== tab) {
      refreshPending = true
      return
    }
    useFeedStore.setState({
      posts,
      loaded: true,
      failed: false,
      snapshotTs: Date.now(), // Lily Item 3 — UI badge "atualizado há X"
    })
  } catch (err) {
    console.error('[feed] refresh failed:', err)
    // Primeira carga desta aba (logo depois da troca): os posts na store são
    // da aba anterior. Não deixa a lista errada sob o rótulo desta; a UI
    // mostra o erro com "recarregar". Num refresh da mesma aba, os posts
    // que estão lá são dela: ficam.
    const now = useFeedStore.getState()
    if (now.tab === tab && !now.loaded) useFeedStore.setState({ posts: [], loaded: true, failed: true })
  } finally {
    refreshInFlight = false
    if (refreshPending) {
      refreshPending = false
      void refreshFeed()
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function rowToPost(row: PostRow): Post {
  const subposts = parseSubposts(row.content)
  // Track B.2 — attach imeta tags do raw_event aos subposts com imagem.
  // Convenção Drift (RFC §3.5.3): imetas aparecem na ordem dos subposts
  // que têm imageUrl. Subposts só-texto não consomem entrada da lista.
  attachImetasToSubposts(subposts, row.raw_event)
  // Lily Sprint N+2 P2.11 — picks decorativos opt-in vindos do LEFT JOIN
  // com `users_metadata`. Alias = display_name OR name (autores costumam
  // preencher um ou outro, mas display_name tem prioridade pela
  // convenção NIP-01). Validação anti-tracker do `picture` fica no
  // render layer (vide `isSafeAvatarUrl` no AuthorChip + ProfileModal).
  // Manifesto §22: campos NÃO entram em score/weight/ranking — LOCK_VIA_TEST.
  const authorAlias = row.author_display_name ?? row.author_name ?? undefined
  const authorAvatar = row.author_picture ?? undefined
  return {
    id: row.id,
    authorPub: row.author_pub,
    content: row.content,
    subposts,
    createdAt: row.created_at,
    category: row.category,
    location: parseLocation(row.location),
    client: row.client,
    contentWarning: row.content_warning,
    // O que a UI mostra é o valor decaído, o mesmo que ordena o feed.
    score: row.score_now,
    spreads: row.spreads,
    buries: row.buries,
    authorAlias,
    authorAvatar,
  }
}

/**
 * Vincula tags `imeta` do raw_event aos subposts correspondentes.
 * Mutativa pra evitar realocar — chama-se em hot path do feed (50/refresh).
 *
 * Falha de parse é silenciosa: subposts ficam sem `meta` e Image cai pro
 * `imageUrl` direto sem hash verify (compat retro).
 */
function attachImetasToSubposts(subposts: Subpost[], rawEvent: string): void {
  let event: { tags?: unknown }
  try {
    event = JSON.parse(rawEvent) as { tags?: unknown }
  } catch {
    return
  }
  if (!Array.isArray(event.tags)) return

  // parseImetaTag é puro e síncrono (string ops); import estático é OK
  // porque nip94.ts não tem deps pesadas (sem Helia).
  const tags = event.tags as string[][]
  const metas: BlobMeta[] = []
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== 'imeta') continue
    const meta = parseImetaTagSync(tag)
    if (meta) metas.push(meta)
  }
  if (metas.length === 0) return

  // Distribui em ordem pelos subposts COM imagem.
  let mi = 0
  for (const sp of subposts) {
    if (sp.imageUrl) {
      const m = metas[mi++]
      if (m) sp.meta = m
    }
  }
}


// ─── Filtros locais (manifesto §27) ──────────────────────────────────
//
// Aplicado NA RENDERIZAÇÃO, não na query do feed. Por quê: §24 exige
// score determinístico — a query do feed precisa ser idêntica entre
// usuários. O filtro pessoal é UI, não ranking.

const KNOWN_WARNINGS = new Set<ContentWarning>(['nsfw', 'violence', 'spoiler', 'ad'])

function isKnownWarning(v: string | null): v is ContentWarning {
  return v !== null && (KNOWN_WARNINGS as Set<string>).has(v)
}

/**
 * Decide blur/hide pra um post baseado em três sinais:
 *
 *   1. Bloqueio/silenciamento local do autor (§24, mais agressivo —
 *      hide total)
 *   2. Aviso declarado pelo autor (`post.contentWarning`, §27)
 *   3. Preferências locais do leitor (`UserPrefs`)
 *
 * Manifesto §24: filtros locais NÃO mudam score — query do feed
 * continua determinística entre clientes. Esse helper é aplicado **na
 * renderização** pra cada post.
 *
 * @param post - Post a renderizar
 * @param prefs - Preferências locais (`UserPrefs`)
 * @returns Hint pra UI: blur/hide + razão (pra tooltip/overlay)
 */
export function applyContentFilters(post: Post, prefs: UserPrefs): RenderHint {
  // Bloqueio/silenciamento local vence tudo — autor está na lista
  // pessoal do user, esconde antes de qualquer outra heurística.
  const modReason = hiddenReason(post.authorPub)
  if (modReason) {
    return { blur: false, hide: true, reason: null, modReason }
  }

  const cw = post.contentWarning
  if (!cw) return { blur: false, hide: false, reason: null }

  // Strings livres não-conhecidas: tratamos como genérico — sem blur/hide,
  // mas a UI ainda pode mostrar "marcado como X" se quiser.
  if (!isKnownWarning(cw)) return { blur: false, hide: false, reason: null }

  if (cw === 'nsfw' && !prefs.show_nsfw_default) {
    return { blur: true, hide: false, reason: 'nsfw' }
  }
  if (cw === 'violence' && !prefs.show_nsfw_default) {
    // Violência segue o mesmo toggle de NSFW por simplicidade — settings
    // pode separar em fase futura. Manifesto §27 não obriga separação.
    return { blur: true, hide: false, reason: 'violence' }
  }
  if (cw === 'spoiler' && prefs.hide_spoilers) {
    return { blur: false, hide: true, reason: 'spoiler' }
  }
  if (cw === 'ad' && prefs.hide_ads) {
    return { blur: false, hide: true, reason: 'ad' }
  }
  return { blur: false, hide: false, reason: null }
}

/**
 * Track C.6.2 — versão de `applyContentFilters` pra `CommentRecord`. Mesma
 * lógica determinística (manifesto §7) operando sobre os mesmos sinais
 * (block/mute do autor + content-warning + prefs locais), apenas com
 * shape de input diferente. Mantida paralela (em vez de polimórfica
 * via interface) pra preservar o tipo nominal `Post` no call-site da
 * feed e evitar refactor cross-cutting.
 */
export function applyContentFiltersComment(
  comment: { authorPub: string; contentWarning?: string | ContentWarning | null },
  prefs: UserPrefs,
): RenderHint {
  const modReason = hiddenReason(comment.authorPub)
  if (modReason) {
    return { blur: false, hide: true, reason: null, modReason }
  }
  const cw = comment.contentWarning ?? null
  if (!cw) return { blur: false, hide: false, reason: null }
  if (!isKnownWarning(cw)) return { blur: false, hide: false, reason: null }
  if (cw === 'nsfw' && !prefs.show_nsfw_default) {
    return { blur: true, hide: false, reason: 'nsfw' }
  }
  if (cw === 'violence' && !prefs.show_nsfw_default) {
    return { blur: true, hide: false, reason: 'violence' }
  }
  if (cw === 'spoiler' && prefs.hide_spoilers) {
    return { blur: false, hide: true, reason: 'spoiler' }
  }
  if (cw === 'ad' && prefs.hide_ads) {
    return { blur: false, hide: true, reason: 'ad' }
  }
  return { blur: false, hide: false, reason: null }
}


/**
 * @internal — exported pra testes (V4 LOCK_VIA_TEST `layout.fixture-legacy`,
 * `layout.unknown-value-fallback`, `layout.roundtrip`). Não usar fora de
 * tests/feed.ts. UI consome via `getGlobalFeed`/`getFollowingFeed`/etc.
 */
export function parseSubposts(content: string): Subpost[] {
  try {
    const parsed = JSON.parse(content) as { subposts?: unknown }
    if (!Array.isArray(parsed.subposts)) return []
    // V4: normaliza layout no read path (não muta content armazenado —
    // preserva fidelidade ao evento original da rede, mantém content ===
    // raw_event content, single defesa em camada antes da UI).
    // Posts antigos sem campo `layout` recebem DEFAULT_LAYOUT='portrait'
    // (compat retro). Valores desconhecidos ('cubist', etc.) também caem
    // pra DEFAULT_LAYOUT — defensa contra tag flooding ou cliente futuro
    // emitindo layout novo que este cliente não conhece.
    return parsed.subposts.filter(isSubpost).map(normalizeSubpostLayout)
  } catch {
    return []
  }
}

function isSubpost(v: unknown): v is Subpost {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return typeof s.id === 'string' && typeof s.order === 'number'
}

function normalizeSubpostLayout(s: Subpost): Subpost {
  // normalizeLayout faz o type guard + fallback determinístico (§7).
  // Tira o `?` opcional do tipo — UI nunca vê layout undefined.
  return { ...s, layout: normalizeLayout(s.layout) }
}

function parseLocation(raw: string | null): GeoPoint | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<GeoPoint>
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return null
    return {
      lat: v.lat,
      lng: v.lng,
      city: v.city ?? '',
      country: v.country ?? '',
    }
  } catch {
    return null
  }
}
