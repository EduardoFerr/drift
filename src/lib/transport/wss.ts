/**
 * Transporte WSS clearnet — wrapper sobre `nostr-tools/SimplePool`.
 *
 * É o único transporte ativo no MVP. Roda nos 4 relays seed
 * (`config/relays.ts`). Em fases futuras passamos a aceitar relays
 * adicionados pelo user (Fase 5) e descobertos via NIP-65.
 *
 * Singleton: existe uma instância única (`wssTransport`) compartilhada
 * por `sync.ts` (subscribe global) e `protocol.ts` (publish). O
 * `SimplePool` interno reusa conexões — não abre novo WebSocket por chamada.
 */

import { SimplePool } from 'nostr-tools/pool'
import { activeReadRelays, activeRelays, activeWriteRelays, recordRelayError, recordRelayOk } from '../relays'
import type { SignedEvent } from '../../types/nostr'
import type {
  Filter,
  PublishResult,
  SubscribeHandlers,
  Transport,
  TransportHealth,
  Unsubscribe,
} from './index'

const pool = new SimplePool()

/** Acesso direto ao pool — em geral, prefira `wssTransport`. Mantido
 *  exportado pra casos como `rebuildIdentityHistory` que precisa de
 *  controle fino do subscribe. */
export { pool }

async function publish(event: SignedEvent): Promise<PublishResult> {
  // Snapshot dos relays ativos no momento da publicação. Mudança no
  // user_relays não afeta publishes em curso — cada call fala com o
  // conjunto atual.
  const writeRelays = activeWriteRelays()
  const results = await Promise.allSettled(
    writeRelays.map((url) => pool.publish([url], event)),
  )
  const perRelay: PublishResult['perRelay'] = []
  let ok = 0
  let failed = 0
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!
    const url = writeRelays[i]!
    if (r.status === 'fulfilled') {
      ok++
      perRelay.push({ url, ok: true })
      void recordRelayOk(url)
    } else {
      failed++
      const errMsg = String(r.reason)
      perRelay.push({ url, ok: false, error: errMsg })
      void recordRelayError(url, errMsg)
    }
  }
  return { ok, failed, perRelay }
}

function subscribe(
  filter: Filter,
  handlers: SubscribeHandlers,
): Unsubscribe {
  const readRelays = activeReadRelays()
  const sub = pool.subscribeMany(readRelays, filter, {
    onevent: async (event: SignedEvent) => {
      try {
        await handlers.onevent(event)
      } catch (err) {
        console.error('[wss] onevent failed:', err)
      }
    },
    oneose: handlers.oneose,
  })
  return () => {
    try {
      sub.close()
    } catch {
      /* noop */
    }
  }
}

async function health(timeoutMs = 5000): Promise<TransportHealth[]> {
  const relays = activeRelays()
  return Promise.all(
    relays.map(
      (url) =>
        new Promise<TransportHealth>((resolve) => {
          const start = performance.now()
          let ws: WebSocket
          try {
            ws = new WebSocket(url)
          } catch {
            resolve({ url, ok: false, latencyMs: null })
            return
          }
          const timer = setTimeout(() => {
            try {
              ws.close()
            } catch {
              /* noop */
            }
            resolve({ url, ok: false, latencyMs: null })
          }, timeoutMs)
          ws.onopen = () => {
            clearTimeout(timer)
            const latencyMs = Math.round(performance.now() - start)
            try {
              ws.close()
            } catch {
              /* noop */
            }
            resolve({ url, ok: true, latencyMs })
          }
          ws.onerror = () => {
            clearTimeout(timer)
            resolve({ url, ok: false, latencyMs: null })
          }
        }),
    ),
  )
}

export const wssTransport: Transport = {
  kind: 'wss',
  publish,
  subscribe,
  health,
}
