/**
 * webrtc/bundle — offline event transport (sneakernet).
 *
 * Manifesto §15 (anti-censura), §16 (disponibilidade distribuída),
 * §31.3 (resiliência offline): permite trocar eventos Drift entre
 * dispositivos SEM rede ativa — via JSON export/import ou QR code
 * chunks.
 *
 * Fluxo:
 *   exportBundle(events) → { json, qrParts }
 *   importBundle(json) → SignedEvent[] (Schnorr verified)
 *
 * Eventos importados passam pelo pipeline normal:
 *   importBundle → caller chama onNostrEvent() pra cada → SQLite → feed
 *
 * Segurança: cada evento é Schnorr-verified individualmente. Eventos
 * com assinatura inválida são silenciosamente dropados (não propagam
 * erro pro bundle inteiro — partial import é aceitável).
 *
 * QR chunking: bundles pequenos (< 2KB) cabem em 1 QR. Maiores são
 * splitados em chunks com header de sequência. Tamanho máximo de
 * bundle é limitado pra evitar DoS via QR flood.
 *
 * Privacy: zero network involvement. ON por default (Barney delib).
 */

import type { SignedEvent } from '../../../types/nostr'

const BUNDLE_VERSION = 1
const MAX_BUNDLE_EVENTS = 500
const QR_CHUNK_MAX_BYTES = 1800

export interface BundleExport {
  json: string
  qrParts: string[]
  eventCount: number
}

interface BundleEnvelope {
  v: number
  events: SignedEvent[]
  exportedAt: number
}

export function exportBundle(events: SignedEvent[]): BundleExport {
  if (events.length === 0) {
    return { json: '{"v":1,"events":[],"exportedAt":0}', qrParts: [], eventCount: 0 }
  }

  const capped = events.slice(0, MAX_BUNDLE_EVENTS)
  const envelope: BundleEnvelope = {
    v: BUNDLE_VERSION,
    events: capped,
    exportedAt: Math.floor(Date.now() / 1000),
  }
  const json = JSON.stringify(envelope)

  const qrParts: string[] = []
  if (json.length <= QR_CHUNK_MAX_BYTES) {
    qrParts.push(json)
  } else {
    const totalChunks = Math.ceil(json.length / QR_CHUNK_MAX_BYTES)
    for (let i = 0; i < totalChunks; i++) {
      const slice = json.slice(i * QR_CHUNK_MAX_BYTES, (i + 1) * QR_CHUNK_MAX_BYTES)
      qrParts.push(`DRIFT:${i + 1}/${totalChunks}:${slice}`)
    }
  }

  return { json, qrParts, eventCount: capped.length }
}

export async function importBundle(json: string): Promise<SignedEvent[]> {
  const { verifyEvent } = await import('nostr-tools/pure')

  let envelope: BundleEnvelope
  try {
    envelope = JSON.parse(json) as BundleEnvelope
  } catch {
    console.warn('[bundle] JSON parse failed')
    return []
  }

  if (!envelope || typeof envelope.v !== 'number' || !Array.isArray(envelope.events)) {
    console.warn('[bundle] invalid envelope structure')
    return []
  }

  if (envelope.v > BUNDLE_VERSION) {
    console.warn('[bundle] version', envelope.v, 'not supported (max:', BUNDLE_VERSION, ')')
    return []
  }

  const verified: SignedEvent[] = []
  for (const event of envelope.events.slice(0, MAX_BUNDLE_EVENTS)) {
    if (!isPlausibleEvent(event)) continue
    try {
      if (verifyEvent(event)) {
        verified.push(event)
      } else {
        console.warn('[bundle] Schnorr verify failed for event', event.id?.slice(0, 8))
      }
    } catch {
      // malformed event — skip
    }
  }

  console.info(`[bundle] imported ${verified.length}/${envelope.events.length} events (verified)`)
  return verified
}

export function reassembleChunks(chunks: string[]): string | null {
  if (chunks.length === 0) return null
  if (chunks.length === 1 && !chunks[0]!.startsWith('DRIFT:')) return chunks[0]!

  const parsed: { index: number; total: number; data: string }[] = []
  for (const chunk of chunks) {
    const match = chunk.match(/^DRIFT:(\d+)\/(\d+):(.*)$/)
    if (!match) return null
    parsed.push({
      index: parseInt(match[1]!, 10),
      total: parseInt(match[2]!, 10),
      data: match[3] ?? '',
    })
  }

  if (parsed.length === 0) return null
  const total = parsed[0]!.total
  if (parsed.length !== total) return null
  if (parsed.some((p) => p.total !== total)) return null

  parsed.sort((a, b) => a.index - b.index)
  return parsed.map((p) => p.data).join('')
}

function isPlausibleEvent(e: unknown): e is SignedEvent {
  if (!e || typeof e !== 'object') return false
  const ev = e as Record<string, unknown>
  return (
    typeof ev.id === 'string' &&
    typeof ev.pubkey === 'string' &&
    typeof ev.kind === 'number' &&
    typeof ev.created_at === 'number' &&
    typeof ev.sig === 'string' &&
    Array.isArray(ev.tags)
  )
}
