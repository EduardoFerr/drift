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
import { hiddenReason } from './moderation-local'
import { useFollowsStore } from './follows'
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
  score: number
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
    p.client, p.content_warning, p.score, p.spreads, p.buries, p.raw_event,
    um.name AS author_name, um.display_name AS author_display_name,
    um.picture AS author_picture
  FROM posts p
  LEFT JOIN users_metadata um ON um.npub = p.author_pub`

export async function getGlobalFeed(limit = 50): Promise<Post[]> {
  const rows = await db.exec<PostRow>(
    `${POST_SELECT}
     WHERE p.score > -999
     ORDER BY p.score DESC, p.created_at DESC
     LIMIT ?`,
    [limit],
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
export async function getFollowingFeed(limit = 50): Promise<Post[]> {
  const followingSet = useFollowsStore.getState().following
  if (followingSet.size === 0) return []

  const placeholders = Array.from(followingSet).map(() => '?').join(',')
  const rows = await db.exec<PostRow>(
    `${POST_SELECT}
     WHERE p.score > -999 AND p.author_pub IN (${placeholders})
     ORDER BY p.score DESC, p.created_at DESC
     LIMIT ?`,
    [...followingSet, limit],
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
     ORDER BY p.score DESC, p.created_at DESC
     LIMIT ?`,
    [cutoffSeconds, limit],
  )
  return rows.map(rowToPost)
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
 * correta baseado em `useFeedStore.tab`.
 */
async function getFeedByTab(tab: FeedTab, limit: number): Promise<Post[]> {
  switch (tab) {
    case 'global':
      return getGlobalFeed(limit)
    case 'following':
      return getFollowingFeed(limit)
    case 'trending':
      return getTrendingFeed(limit)
  }
}

/** Indica se o usuário corrente já espalhou ou enterrou o post. Usado
 *  para esconder os botões depois de uma ação. */
export async function getMyAction(
  postId: string,
  npub: string,
): Promise<'spread' | 'bury' | null> {
  const sp = await db.get<{ n: number }>(
    `SELECT 1 AS n FROM spreads WHERE post_id = ? AND spreader_pub = ? LIMIT 1`,
    [postId, npub],
  )
  if (sp) return 'spread'
  const bu = await db.get<{ n: number }>(
    `SELECT 1 AS n FROM buries WHERE post_id = ? AND burier_pub = ? LIMIT 1`,
    [postId, npub],
  )
  if (bu) return 'bury'
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
  unseenByTab: { global: 0, following: 0, trending: 0 },
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
    unseenByTab: { ...s.unseenByTab, [tab]: 0 },
  }))
  await refreshFeed()
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshInFlight = false
let refreshPending = false

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
  // Coalesce: se já tem refresh rolando, marca pendente e sai. Quando
  // o atual terminar, dispara mais um.
  if (refreshInFlight) {
    refreshPending = true
    return
  }
  refreshInFlight = true
  try {
    const { limit, tab } = useFeedStore.getState()
    const rawPosts = await getFeedByTab(tab, limit)
    // Lily Tinder-audit 2026-05-21 (Item 2): cap defensivo Zustand vs OOM
    // mobile low-end. SQLite já tem MAX_POSTS_CACHE (cache.ts) — este é
    // defesa em camada no array da store. Posts vêm ordenados por score
    // DESC, então truncar slice(0, CAP) preserva os mais relevantes.
    const posts = rawPosts.length > FEED_QUEUE_CAP
      ? rawPosts.slice(0, FEED_QUEUE_CAP)
      : rawPosts
    useFeedStore.setState({
      posts,
      loaded: true,
      snapshotTs: Date.now(), // Lily Item 3 — UI badge "atualizado há X"
    })
  } catch (err) {
    console.error('[feed] refresh failed:', err)
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
    score: row.score,
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
