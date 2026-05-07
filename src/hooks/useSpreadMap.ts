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
 * Manifesto §28 (Privacidade pelo Mínimo): só usa location que o autor
 * escolheu publicar. Nunca infere via IP.
 */

import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { seedFromSpreaders } from '../lib/seeder'
import type { GeoPoint, PropagationArc, SpreadMapData, SpreadRecord } from '../types/drift'

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
  mode: 'post' | 'global' = 'post',
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

  useEffect(() => {
    if (mode === 'post' && !postId) {
      setState({ data: null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const data =
          mode === 'global'
            ? await buildGlobalData()
            : await buildPostData(postId!)

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
  }, [postId, mode])

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
  if (origin?.country) allCountries.add(origin.country)
  for (const r of records) {
    if (r.location.country) allCountries.add(r.location.country)
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
async function buildGlobalData(): Promise<SpreadMapData> {
  const rows = await db.exec<VirtualArcRow>(
    `SELECT p.location  AS from_loc,
            s.location  AS to_loc,
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
    allArcs.push({ from: [fromLoc.lng, fromLoc.lat], to: [toLoc.lng, toLoc.lat], t })
    allDests.push({ point: toLoc, createdAt: row.spread_at, t })
    if (fromLoc.country) allCountries.add(fromLoc.country)
    if (toLoc.country)   allCountries.add(toLoc.country)
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
