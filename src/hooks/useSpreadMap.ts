/**
 * useSpreadMap — agrega origem + spreads de um post (ou de todos os posts)
 * pra renderização no mapa com animação de propagação.
 *
 * mode='post': origin do post + suas spread destinations, cadeias por ordem
 *   cronológica. Arcos: origin→dest[0]→dest[1]→...
 *
 * mode='global': agrega TODOS os posts/spreads com location. Agrupa por
 *   post_id, constrói cadeias temporais, normaliza timestamps pra [0,1].
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

interface GlobalPostRow {
  id: string
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

async function buildGlobalData(): Promise<SpreadMapData> {
  const [postRows, spreadRows] = await Promise.all([
    db.exec<GlobalPostRow>(
      `SELECT id, location, created_at FROM posts WHERE location IS NOT NULL LIMIT 1000`,
      [],
    ),
    db.exec<SpreadRow>(
      `SELECT post_id, spreader_pub, created_at, location, event_id
       FROM spreads
       WHERE location IS NOT NULL
       ORDER BY post_id, created_at ASC
       LIMIT 2000`,
      [],
    ),
  ])

  // Index posts by id
  const postMap = new Map<string, { loc: GeoPoint; createdAt: number }>()
  for (const row of postRows) {
    const loc = parseLocation(row.location)
    if (loc) postMap.set(row.id, { loc, createdAt: row.created_at })
  }

  // Group spreads by post_id
  const spreadsByPost = new Map<string, { loc: GeoPoint; createdAt: number; spreaderPub: string; eventId: string }[]>()
  for (const row of spreadRows) {
    const loc = parseLocation(row.location)
    if (!loc) continue
    const arr = spreadsByPost.get(row.post_id) ?? []
    arr.push({ loc, createdAt: row.created_at, spreaderPub: row.spreader_pub, eventId: row.event_id })
    spreadsByPost.set(row.post_id, arr)
  }

  // Collect all timestamps for global normalization
  const allTs: number[] = []
  for (const [pid, post] of postMap) {
    if (spreadsByPost.has(pid)) allTs.push(post.createdAt)
  }
  for (const dests of spreadsByPost.values()) {
    for (const d of dests) allTs.push(d.createdAt)
  }

  const { normalize } = makeNormalizer(allTs)

  const allArcs: PropagationArc[] = []
  const allDests: SpreadMapData['destinations'] = []
  const allCountries = new Set<string>()

  for (const [pid, spreads] of spreadsByPost) {
    const post = postMap.get(pid)

    type ChainPoint = { pos: [number, number]; t: number }
    const chain: ChainPoint[] = []
    if (post) {
      chain.push({ pos: [post.loc.lng, post.loc.lat], t: normalize(post.createdAt) })
      if (post.loc.country) allCountries.add(post.loc.country)
    }
    for (const s of spreads) {
      const t = normalize(s.createdAt)
      chain.push({ pos: [s.loc.lng, s.loc.lat], t })
      allDests.push({ point: s.loc, createdAt: s.createdAt, t })
      if (s.loc.country) allCountries.add(s.loc.country)
    }

    // Arcs: consecutive pairs in this post's chain
    for (let i = 0; i < chain.length - 1; i++) {
      const cur = chain[i]
      const next = chain[i + 1]
      if (cur && next) allArcs.push({ from: cur.pos, to: next.pos, t: next.t })
    }
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
