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
}

export async function getGlobalFeed(limit = 50): Promise<Post[]> {
  const rows = await db.exec<PostRow>(
    `SELECT id, author_pub, content, created_at, category, location, client, content_warning, score, spreads, buries, raw_event
     FROM posts
     WHERE score > -999
     ORDER BY score DESC, created_at DESC
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
    `SELECT id, author_pub, content, created_at, category, location, client, content_warning, score, spreads, buries, raw_event
     FROM posts
     WHERE score > -999 AND author_pub IN (${placeholders})
     ORDER BY score DESC, created_at DESC
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
    `SELECT id, author_pub, content, created_at, category, location, client, content_warning, score, spreads, buries, raw_event
     FROM posts
     WHERE score > -999 AND created_at >= ?
     ORDER BY score DESC, created_at DESC
     LIMIT ?`,
    [cutoffSeconds, limit],
  )
  return rows.map(rowToPost)
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
  /** Limite atual da query — 50 default, pode crescer com paginação */
  limit: number
  /** Tab ativa do feed. Default 'global'. */
  tab: FeedTab
}

export const useFeedStore = create<FeedStore>(() => ({
  posts: [],
  loaded: false,
  limit: 50,
  tab: 'global',
}))

/**
 * Troca a tab do feed. Dispara refresh imediato pra a nova query
 * carregar — UI vê transição. Manifesto §24: cada tab é só uma view
 * sobre os mesmos dados, score determinístico inalterado.
 */
export async function setFeedTab(tab: FeedTab): Promise<void> {
  if (useFeedStore.getState().tab === tab) return
  useFeedStore.setState({ tab, loaded: false })
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
    const posts = await getFeedByTab(tab, limit)
    useFeedStore.setState({ posts, loaded: true })
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
  const tags = event.tags as unknown as string[][]
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
