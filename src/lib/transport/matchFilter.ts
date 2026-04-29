/**
 * matchFilter — implementação pura de filtros NIP-01.
 *
 * Usado pelo `webrtcTransport` (Fase 6.1a) pra decidir se um evento que
 * chegou via DataChannel deve ser entregue a um subscriber específico.
 * `pool.subscribeMany` da nostr-tools faz isso internamente pra WSS,
 * mas pra WebRTC implementamos local porque quem aceita os eventos
 * somos nós, não o relay.
 *
 * Semântica NIP-01:
 *   - Filter vazio `{}` casa todo evento.
 *   - Campo presente com array vazio (ex: `kinds: []`) NÃO casa nenhum.
 *   - `since`/`until` são INCLUSIVOS (Barney peer review #6).
 *   - Tag filters (`#e`, `#p`, `#a`, etc) são single-letter por NIP-01.
 *     Drift respeita invariante #14 (CLAUDE.md): não inventa multi-char.
 *
 * Determinismo: dado o mesmo evento + filtro, retorna o mesmo bool.
 * Sem `Date.now()`, sem state. Manifesto §7 (determinismo).
 */

import type { SignedEvent } from '../../types/nostr'
import type { Filter } from './index'

export function matchFilter(event: SignedEvent, filter: Filter): boolean {
  // ids — match exato em event.id
  if (filter.ids && !filter.ids.includes(event.id)) return false

  // authors — match exato em event.pubkey
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false

  // kinds — match exato em event.kind
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false

  // since/until — limites INCLUSIVOS (Barney peer review #6)
  if (filter.since !== undefined && event.created_at < filter.since) return false
  if (filter.until !== undefined && event.created_at > filter.until) return false

  // Tag filters — `#<letter>`, single-char por NIP-01
  for (const key of Object.keys(filter)) {
    if (!key.startsWith('#') || key.length !== 2) continue
    const wanted = (filter as Record<string, string[] | undefined>)[key]
    if (!wanted) continue
    // Array vazio = field presente sem valores = nenhum casa (NIP-01).
    if (wanted.length === 0) return false
    const tagName = key.slice(1)
    const hasTag = event.tags.some(
      (t) =>
        t[0] === tagName &&
        typeof t[1] === 'string' &&
        wanted.includes(t[1]),
    )
    if (!hasTag) return false
  }

  return true
}
