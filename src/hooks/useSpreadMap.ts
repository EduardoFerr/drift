/**
 * useSpreadMap — agrega origem + spreads de um post pra renderização no mapa.
 *
 * **Origem** = `posts.location` do autor original (capturada quando o post foi
 * criado, se granularity != 'off'). É o "ground zero" geográfico do post.
 *
 * **Destinos** = cada `spreads.location` com a coordenada de quem espalhou.
 *
 * Lê do SQLite (tabelas `posts` e `spreads`), parseia a coluna `location`
 * (JSON `GeoPoint`), e devolve `{origin, destinations, arcs}` pro Deck.gl.
 *
 * **Bug histórico (pré-2026-04-29)**: o hook só lia `spreads.location` e
 * usava `spreads[0]` como origem. Semanticamente errado — o "primeiro
 * espalhador" não é a origem do post; o autor é. Pior: `_buildArcs`
 * exigia `>=2` records, então post com 1 spread renderizava mapa vazio.
 * Fix: separar origin de destinations, aceitar 1 destino, fallback legacy
 * só quando origin é null.
 *
 * Determinismo: dado o mesmo SQLite, retorna o mesmo conjunto. Não
 * polla — é refeito sob demanda (chamada de hook em mount).
 *
 * Eventos sem `location` são ignorados (manifesto §28 — opt-in).
 */

import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import type { GeoPoint, SpreadArc, SpreadMapData, SpreadRecord } from '../types/drift'

interface PostRow {
  location: string | null
}

interface SpreadRow {
  post_id: string
  spreader_pub: string
  created_at: number
  location: string | null
  event_id: string
}

export function useSpreadMap(postId: string | null): {
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
    if (!postId) {
      setState({ data: null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const [postRow, spreadRows] = await Promise.all([
          db.get<PostRow>(`SELECT location FROM posts WHERE id = ?`, [postId]),
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

        const destinations = records.map((r) => ({
          point: r.location,
          createdAt: r.createdAt,
        }))

        const arcs = _buildArcs(origin, destinations)

        const allCountries = new Set<string>()
        if (origin?.country) allCountries.add(origin.country)
        for (const r of records) {
          if (r.location.country) allCountries.add(r.location.country)
        }

        const data: SpreadMapData = {
          origin,
          destinations,
          arcs,
          totalSpreads: records.length,
          countries: Array.from(allCountries),
          firstSpread: (records[0] ?? null) as SpreadRecord | null,
          latestSpread: (records[records.length - 1] ?? null) as SpreadRecord | null,
        }

        if (!cancelled) setState({ data, loading: false, error: null })
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

    return () => {
      cancelled = true
    }
  }, [postId])

  return state
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

/**
 * Constrói arcos pro Deck.gl ArcLayer a partir da origem do post + destinos.
 *
 * Casos:
 *   - `origin` presente, `destinations.length >= 1` → 1 arco por destino,
 *     todos partindo de `origin` (caso comum: autor publicou com location,
 *     N pessoas espalharam com location).
 *   - `origin` presente, `destinations` vazio → `[]` (renderiza só o ponto
 *     da origem via ScatterplotLayer; sem arco).
 *   - `origin` null, `destinations.length >= 2` → **fallback legacy**: usa
 *     `destinations[0]` como origem e os demais como destinos. Cobre posts
 *     antigos (autor sem location, mas espalhadores com location).
 *   - `origin` null, `destinations.length < 2` → `[]`.
 *
 * Coords retornadas no formato `[lng, lat]` (convenção Deck.gl, invertida
 * vs `{lat, lng}`).
 *
 * Exportada como `_buildArcs` (prefixo underscore = test-only) pra que
 * `tests/spread-map.test.ts` possa cobrir os 5 estados sem mockar SQLite.
 *
 * @deprecated Use _computeBounds + HeatmapLayer instead. Will be removed in next release.
 */
export function _buildArcs(
  origin: GeoPoint | null,
  destinations: { point: GeoPoint; createdAt: number }[],
): SpreadArc[] {
  if (origin) {
    return destinations.map((d) => ({
      origin: [origin.lng, origin.lat],
      destination: [d.point.lng, d.point.lat],
      createdAt: d.createdAt,
    }))
  }
  if (destinations.length < 2) return []
  const fallbackOrigin = destinations[0]!.point
  return destinations.slice(1).map((d) => ({
    origin: [fallbackOrigin.lng, fallbackOrigin.lat],
    destination: [d.point.lng, d.point.lat],
    createdAt: d.createdAt,
  }))
}
