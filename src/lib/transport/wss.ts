/**
 * Transporte WSS — wrapper sobre `nostr-tools/SimplePool`.
 *
 * É o transporte primário (peso 10 no orchestrator). Roda nos relays
 * configurados em `relays.ts:activeReadRelays/activeWriteRelays` —
 * vem do banco SQLite (Fase 5+), não da seed list estática.
 *
 * Singleton: existe uma instância única (`wssTransport`) compartilhada
 * por `sync.ts` (subscribe global), `protocol.ts` (publish) e
 * `webrtc-signaling-nostr.ts` (publish/subscribe de DMs cifrados de
 * signaling). O `SimplePool` interno reusa conexões — não abre novo
 * WebSocket por chamada.
 *
 * ⚠ **MAGIC-AT-DISTANCE**: o `WebSocket` global usado pelo SimplePool
 * pode ser **substituído em runtime** por `TorWebSocket` via
 * `installTorWebSocketImpl()` em `transport/torWebSocket.ts`. Quando
 * `bootstrap.ts` detecta `prefs.network_mode ∈ {tor, onion-only}` em
 * Tauri+arti, instala a substituição ANTES de registrar este
 * transport. Daí em diante, toda chamada `ws = new WebSocket(url)`
 * abaixo (linha do `health()`) e toda conexão aberta pelo SimplePool
 * passa por circuit Tor — sem nada nesta classe ter que mudar.
 *
 * Por que isto importa:
 * - Quem dá `grep "WebSocket"` no projeto pra debuggar latência alta
 *   pode não achar o motivo se ignorar este comentário.
 * - Trocar `network_mode` em runtime NÃO recicla este pool — exige
 *   `location.reload()` (forçado em `ContentSettings.tsx`). Aceitável
 *   porque manifesto §15 ("anti-censura auditável") exige feedback
 *   claro de que o modo mudou.
 * - `webrtc-signaling-nostr.ts` recebe `wssTransport` como dep injection
 *   e herda automaticamente Tor — não há vetor de signaling vazando
 *   em modo `tor`/`onion-only`.
 */

import { SimplePool } from 'nostr-tools/pool'
import { activeReadRelays, activeRelays, activeWriteRelays, recordRelayError, recordRelayOk } from '../relays'
import { probeRelayReachable } from '../relay-probe'
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
      async (url): Promise<TransportHealth> => {
        // HTTPS pre-probe — evita o `console.error` nativo do browser
        // quando `new WebSocket(...)` falha em conexão (DNS/TLS/refused).
        // Promise rejections do fetch são silenciáveis; o WS log de
        // networking layer não é. Marcamos demoted via recordRelayError
        // antes mesmo de tentar o WS.
        // Pre-probe usa metade do timeout do health pra deixar margem ao
        // WS handshake real quando o host está vivo.
        const preProbeTimeout = Math.max(1000, Math.floor(timeoutMs / 2))
        const preProbe = await probeRelayReachable(url, preProbeTimeout)
        if (!preProbe.reachable) {
          void recordRelayError(url, 'pre-probe unreachable (DNS/TLS/conn)')
          return { url, ok: false, latencyMs: null }
        }
        return new Promise<TransportHealth>((resolve) => {
          const start = performance.now()
          let ws: WebSocket
          try {
            ws = new WebSocket(url)
          } catch (err) {
            void recordRelayError(url, `health construct: ${String(err)}`)
            resolve({ url, ok: false, latencyMs: null })
            return
          }
          const timer = setTimeout(() => {
            try {
              ws.close()
            } catch {
              /* noop */
            }
            void recordRelayError(url, 'health timeout')
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
            void recordRelayOk(url)
            resolve({ url, ok: true, latencyMs })
          }
          ws.onerror = () => {
            clearTimeout(timer)
            void recordRelayError(url, 'health onerror')
            resolve({ url, ok: false, latencyMs: null })
          }
        })
      },
    ),
  )
}

export const wssTransport: Transport = {
  kind: 'wss',
  publish,
  subscribe,
  health,
}
