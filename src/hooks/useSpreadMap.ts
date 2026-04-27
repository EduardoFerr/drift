/**
 * useSpreadMap — agrega spreads de um post pra renderização no mapa.
 *
 * Lê do SQLite (tabela `spreads`), parseia a coluna `location` (JSON
 * `GeoPoint`), e devolve uma estrutura amigável pro Deck.gl ArcLayer.
 *
 * Determinismo: dado o mesmo SQLite, retorna o mesmo conjunto. Não
 * polla — é refeito sob demanda (chamada de hook em mount).
 *
 * Spreads sem `location` são ignorados (manifesto §28 — location é
 * opt-in; default off; muitos usuários nunca vão ligar).
 */

import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import type { GeoPoint, SpreadArc, SpreadMapData, SpreadRecord } from '../types/drift'

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
        // Origem do arc = primeiro spread (geograficamente o "ground zero").
        // Destino = cada spread subsequente. Visualmente: arcos saindo
        // de um ponto e se espalhando pelo globo.
        const rows = await db.exec<SpreadRow>(
          `SELECT post_id, spreader_pub, created_at, location, event_id
           FROM spreads
           WHERE post_id = ? AND location IS NOT NULL
           ORDER BY created_at ASC`,
          [postId],
        )

        // Mantém o tipo "estreito" — location já garantido non-null pelo filtro.
        type LocatedSpread = Omit<SpreadRecord, 'location'> & { location: GeoPoint }

        const records: LocatedSpread[] = rows
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

        const arcs = buildArcs(records)
        const countries = Array.from(
          new Set(records.map((r) => r.location.country).filter(Boolean)),
        )

        const data: SpreadMapData = {
          arcs,
          totalSpreads: records.length,
          countries,
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

function buildArcs(records: { location: GeoPoint; createdAt: number }[]): SpreadArc[] {
  if (records.length < 2) return []
  const origin = records[0]?.location
  if (!origin) return []
  return records.slice(1).map((rec) => ({
    origin: [origin.lng, origin.lat] as [number, number],
    destination: [rec.location.lng, rec.location.lat] as [number, number],
    createdAt: rec.createdAt,
  }))
}
