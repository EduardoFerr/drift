/**
 * useSpreadMap — agrega origem + spreads de um post (ou de todos os posts)
 * pra renderização no mapa com animação de propagação.
 *
 * mode='post': origin do post + suas spread destinations, cadeias por ordem
 *   cronológica. Arcos: origin→dest[0]→dest[1]→...
 *
 * mode='global': modelo de árvore viral real. JOIN posts+spreads via
 *   posts.author_pub — cada arco é "local do autor do post → local de quem
 *   espalhou". A→B quando A cria um post e B espalha; B→D quando B cria
 *   um post e D espalha. Resultado: árvore A→{B,C}, B→{D,F}, D→{H,I,J}.
 *   LIMIT 2000 spreads pra não travar mapa com dados enormes.
 *
 * mode='network' (Satoshi+Ted 2026-05-21): mesma agregação do global,
 *   FILTRADA por follows do user ativo. Mostra "spreads de quem eu
 *   sigo, geograficamente". Empty state quando user não segue ninguém
 *   ou está anônimo. Manifesto §24 view-layer carve-out — não afeta
 *   score canônico, é só lente visual local.
 *
 * Manifesto §28 (Privacidade pelo Mínimo): só usa location que o autor
 * escolheu publicar. Nunca infere via IP.
 */

import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { seedFromSpreaders } from '../lib/seeder'
import { useFollowsStore } from '../lib/follows'
import { useBootStore } from '../lib/bootstrap'
import type { GeoPoint, PropagationArc, SpreadMapData, SpreadRecord } from '../types/drift'

export type SpreadMapMode = 'post' | 'global' | 'network'

interface PostRow {
  location: string | null
  created_at: number
}

interface SpreadRow {
  post_id: string
  spreader_pub: string
  created_at: number
  location: string | null
  event_id: string
}

export function useSpreadMap(
  postId: string | null,
  mode: SpreadMapMode = 'post',
  /** Em modo `global`, post sendo visualizado no overlay. Arcos/dots
   *  cujo `post_id` bate são taggeados `isCurrent: true` na data de
   *  retorno — UI destaca visualmente. Quando ausente, nenhum arco
   *  ganha highlight (modo "verdadeiramente agregado"). */
  currentPostId?: string | null,
): {
  data: SpreadMapData | null
  loading: boolean
  error: string | null
} {
  const [state, setState] = useState<{
    data: SpreadMapData | null
    loading: boolean
    error: string | null
  }>({ data: null, loading: false, error: null })

  // Network mode: precisa do npub ativo + lista de follows.
  // Subscribe via stores garante re-fetch quando follows mudam.
  const activeNpub = useBootStore((s) => s.identity?.npub ?? null)
  const followsVersion = useFollowsStore((s) => s.following.size)

  useEffect(() => {
    if (mode === 'post' && !postId) {
      setState({ data: null, loading: false, error: null })
      return
    }
    // Network mode requer npub ativo — anônimo retorna empty
    if (mode === 'network' && !activeNpub) {
      setState({ data: null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        let data: SpreadMapData
        if (mode === 'global') {
          data = await buildGlobalData(currentPostId ?? null)
        } else if (mode === 'network') {
          data = await buildNetworkData(activeNpub!, currentPostId ?? null)
        } else {
          data = await buildPostData(postId!)
        }

        if (!cancelled) {
          setState({ data, loading: false, error: null })
          if (postId && mode === 'post') {
            void seedFromSpreaders(postId).catch(() => { /* noop */ })
          }
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    })()

    return () => { cancelled = true }
    // followsVersion entra na dep array pra trigger re-fetch quando user
    // segue/deixa de seguir alguém (network mode reflete state atual)
  }, [postId, mode, currentPostId, activeNpub, followsVersion])

  return state
}

// ─── Post mode ────────────────────────────────────────────────────────

async function buildPostData(postId: string): Promise<SpreadMapData> {
  const [postRow, spreadRows] = await Promise.all([
    db.get<PostRow>(`SELECT location, created_at FROM posts WHERE id = ?`, [postId]),
    db.exec<SpreadRow>(
      `SELECT post_id, spreader_pub, created_at, location, event_id
       FROM spreads
       WHERE post_id = ? AND location IS NOT NULL
       ORDER BY created_at ASC`,
      [postId],
    ),
  ])

  const origin = parseLocation(postRow?.location ?? null)

  type LocatedSpread = Omit<SpreadRecord, 'location'> & { location: GeoPoint }

  const records: LocatedSpread[] = spreadRows
    .map((row): LocatedSpread | null => {
      const loc = parseLocation(row.location)
      if (!loc) return null
      return {
        postId: row.post_id,
        spreaderPub: row.spreader_pub,
        createdAt: row.created_at,
        location: loc,
        eventId: row.event_id,
      }
    })
    .filter((r): r is LocatedSpread => r !== null)

  // Build chain: [origin?, dest0, dest1, ...]
  type ChainPoint = { pos: [number, number]; ts: number }
  const chain: ChainPoint[] = []
  if (origin && postRow?.created_at) {
    chain.push({ pos: [origin.lng, origin.lat], ts: postRow.created_at })
  }
  for (const r of records) {
    chain.push({ pos: [r.location.lng, r.location.lat], ts: r.createdAt })
  }

  const { normalize } = makeNormalizer(chain.map((c) => c.ts))

  const destinations = records.map((r) => ({
    point: r.location,
    createdAt: r.createdAt,
    t: normalize(r.createdAt),
  }))

  const arcs: PropagationArc[] = []
  for (let i = 0; i < chain.length - 1; i++) {
    const next = chain[i + 1]
    if (next) arcs.push({ from: chain[i]!.pos, to: next.pos, t: normalize(next.ts) })
  }

  const allCountries = new Set<string>()
  if (origin) allCountries.add(regionKey(origin))
  for (const r of records) {
    allCountries.add(regionKey(r.location))
  }

  return {
    origin,
    destinations,
    arcs,
    totalSpreads: records.length,
    countries: Array.from(allCountries),
    firstSpread: (records[0] ?? null) as SpreadRecord | null,
    latestSpread: (records[records.length - 1] ?? null) as SpreadRecord | null,
  }
}

// ─── Global mode ──────────────────────────────────────────────────────

interface VirtualArcRow {
  post_id: string    // identifica o post — usado pra tag isCurrent
  from_loc: string   // posts.location (autor do post)
  to_loc: string     // spreads.location (quem espalhou)
  spread_at: number  // spreads.created_at
}

/**
 * Modelo de árvore viral: JOIN posts+spreads.
 *
 * Cada linha do resultado representa uma borda da árvore:
 *   from_loc = local onde o post foi criado (quem "infectou")
 *   to_loc   = local de quem espalhou (quem foi "infectado")
 *
 * Exemplos:
 *   A cria post em LA, B espalha em LB → arco LA→LB (A infecta B)
 *   B cria post em LB, D espalha em LD → arco LB→LD (B infecta D)
 *   Juntos formam a árvore A→B→D, não uma estrela A→{B,D}.
 */
async function buildGlobalData(currentPostId: string | null): Promise<SpreadMapData> {
  const rows = await db.exec<VirtualArcRow>(
    `SELECT s.post_id    AS post_id,
            p.location   AS from_loc,
            s.location   AS to_loc,
            s.created_at AS spread_at
     FROM spreads s
     JOIN posts p ON s.post_id = p.id
     WHERE s.location IS NOT NULL
       AND p.location  IS NOT NULL
     ORDER BY s.created_at ASC
     LIMIT 2000`,
    [],
  )

  const { normalize } = makeNormalizer(rows.map((r) => r.spread_at))

  const allArcs: PropagationArc[] = []
  const allDests: SpreadMapData['destinations'] = []
  const allCountries = new Set<string>()

  for (const row of rows) {
    const fromLoc = parseLocation(row.from_loc)
    const toLoc   = parseLocation(row.to_loc)
    if (!fromLoc || !toLoc) continue

    const t = normalize(row.spread_at)
    const isCurrent = currentPostId !== null && row.post_id === currentPostId
    allArcs.push({
      from: [fromLoc.lng, fromLoc.lat],
      to: [toLoc.lng, toLoc.lat],
      t,
      isCurrent,
    })
    allDests.push({ point: toLoc, createdAt: row.spread_at, t, isCurrent })
    allCountries.add(regionKey(fromLoc))
    allCountries.add(regionKey(toLoc))
  }

  return {
    origin: null,
    destinations: allDests,
    arcs: allArcs,
    totalSpreads: allDests.length,
    countries: Array.from(allCountries),
    firstSpread: null,
    latestSpread: null,
  }
}

// ─── K=1 doxx detection helper (Satoshi devsec C 2026-05-21) ────────
//
// Detecta cenário "user é o único com GPS no mapa deste post" — vetor
// K=1 doxx documentado em `Docs/threat-model-maps.md`. Mapa de post
// controverso com pin único em cidade pequena → identifies user via
// community knowledge.
//
// Pure function (manifesto §7). Comparação por npub direto (não por
// coords arredondadas) evita false positive em zonas densas onde
// múltiplos spreaders compartilham coords após bucket.
//
// Trigger UI: mode='post' apenas (global/network agregam por design).
// Dismissal: session-only (UI decide). Helper retorna apenas o boolean.
export function isUserSoloSpreader(
  data: SpreadMapData | null,
  activeNpub: string | null,
): boolean {
  if (!activeNpub || !data) return false
  if (data.totalSpreads !== 1) return false
  return data.firstSpread?.spreaderPub === activeNpub
}

// ─── Network mode (Satoshi+Ted 2026-05-21) ──────────────────────────
//
// Mesma agregação do global, FILTRADA por `spreader_pub IN (follows do
// active user)`. Manifesto §24 view-layer carve-out — não toca em
// posts.score, é só uma lente visual local-only.
//
// Schema NIP-02: tabela `follows` tem (follower_pub, followed_pub) PK
// composite — verificar invariante #15 (source SEMPRE = active identity).
//
// Edge cases:
//   - Anônimo (sem activeNpub) — caller (hook) já retorna empty antes
//     de chegar aqui
//   - User sem follows — query retorna 0 rows, SpreadMapData vazio →
//     Placeholder UI mostra "sua rede está vazia"
//
// LOCK_VIA_TEST scope: query SOMENTE faz JOIN contra `posts` + `follows`
// (não toca em lens_edges, posts.score, reports). Mantém escopo limitado
// pra evitar power creep em ranking. Conformance pattern:
//   spreader_pub IN (SELECT following_pub FROM follows WHERE follower_pub = ?)
async function buildNetworkData(
  activeNpub: string,
  currentPostId: string | null,
): Promise<SpreadMapData> {
  const rows = await db.exec<VirtualArcRow>(
    `SELECT s.post_id    AS post_id,
            p.location   AS from_loc,
            s.location   AS to_loc,
            s.created_at AS spread_at
     FROM spreads s
     JOIN posts p ON s.post_id = p.id
     WHERE s.location IS NOT NULL
       AND p.location  IS NOT NULL
       AND s.spreader_pub IN (
         SELECT following_pub FROM follows WHERE follower_pub = ?
       )
     ORDER BY s.created_at ASC
     LIMIT 2000`,
    [activeNpub],
  )

  const { normalize } = makeNormalizer(rows.map((r) => r.spread_at))

  const allArcs: PropagationArc[] = []
  const allDests: SpreadMapData['destinations'] = []
  const allCountries = new Set<string>()

  for (const row of rows) {
    const fromLoc = parseLocation(row.from_loc)
    const toLoc   = parseLocation(row.to_loc)
    if (!fromLoc || !toLoc) continue

    const t = normalize(row.spread_at)
    const isCurrent = currentPostId !== null && row.post_id === currentPostId
    allArcs.push({
      from: [fromLoc.lng, fromLoc.lat],
      to: [toLoc.lng, toLoc.lat],
      t,
      isCurrent,
    })
    allDests.push({ point: toLoc, createdAt: row.spread_at, t, isCurrent })
    allCountries.add(regionKey(fromLoc))
    allCountries.add(regionKey(toLoc))
  }

  return {
    origin: null,
    destinations: allDests,
    arcs: allArcs,
    totalSpreads: allDests.length,
    countries: Array.from(allCountries),
    firstSpread: null,
    latestSpread: null,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function makeNormalizer(timestamps: number[]): { normalize: (ts: number) => number } {
  if (timestamps.length === 0) return { normalize: () => 0 }
  const minTs = Math.min(...timestamps)
  const maxTs = Math.max(...timestamps)
  const range = maxTs - minTs || 1
  return { normalize: (ts: number) => (ts - minTs) / range }
}

/**
 * Identifica uma região geográfica distinta a partir de um GeoPoint.
 *
 * Por que não usar `country`? O cliente oficial Drift NÃO faz reverse
 * geocoding (manifesto §17/§28 — privacidade pelo mínimo, sem chave
 * mestra disfarçada via serviço externo de geocoding). Logo `country`
 * sempre vem `''` em GeoPoints gerados pelo cliente oficial. Contar
 * `country` distinto resultava em counter sempre 0 mesmo com 39 drifts
 * em 5 países diferentes (sintoma reportado em 2026-05-07).
 *
 * Solução pura/determinística: bucket por coordenada arredondada a 0
 * casas decimais (~111km, ~grão de país pequeno). Países pequenos viram
 * 1-2 buckets; países grandes (BR/US/RU) viram dezenas. Counter exibido
 * como "X países" é aproximação grosseira mas ≠ 0 quando há atividade
 * geograficamente distribuída — promessa cumprida.
 *
 * Quando `country` for não-vazio (cliente alternativo com reverse
 * geocoding plugado, ou tag legacy com nome real), preferir o nome real
 * em vez do bucket — assim Set agrupa "Brasil" e não "(-15,-47)".
 */
export function regionKey(p: GeoPoint): string {
  if (p.country) return p.country
  // Bucket de ~111km. Round, não floor — coords negativas (Brasil tem
  // lat negativo) cruzam zero corretamente.
  return `${Math.round(p.lat)},${Math.round(p.lng)}`
}

function parseLocation(raw: string | null): GeoPoint | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<GeoPoint>
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return null
    return { lat: v.lat, lng: v.lng, city: v.city ?? '', country: v.country ?? '' }
  } catch {
    return null
  }
}
