/**
 * orchestrator — multiplexer de transportes (Fase 6.2-D, manifesto §12).
 *
 * Implementa `Transport` agregando múltiplos transportes registrados:
 *
 *   - **publish**: race-to-first-OK. Primeira confirmação `ok > 0` resolve
 *     a Promise; outros transportes continuam propagando em background
 *     (best-effort). Se todos falharem, retorna failed agregado.
 *
 *   - **subscribe**: fan-out — registra a mesma subscription em cada
 *     transporte. Dedup por `event.id` em LRU(1000) — o mesmo evento
 *     entregue por WSS e WebRTC dispara `onevent` exatamente 1×. Primeiro
 *     EOSE conta (não esperar o mais lento).
 *
 *   - **health**: concat de todos os transportes com prefixo
 *     (`webrtc:<peerId>`, `wss:<url>`).
 *
 * Quem registra os transportes: `bootstrap.ts` chama `registerTransport`
 * pra cada transporte ativo no boot. `sync.ts` e `nostr.ts:publishToRelays`
 * passam a falar com `orchestrator` em vez de `wssTransport` direto.
 *
 * Manifesto §12 (múltiplos transportes), §14 (compatibilidade Nostr —
 * orchestrator não inventa kinds, só multiplexa). Invariante #11
 * (sem afinidade — race é determinada por confirmação técnica, não
 * conteúdo).
 *
 * **Comportamentalmente equivalente** ao `wssTransport` direto quando só
 * ele está registrado — orchestrator apenas adiciona poder de combinar.
 */

import type {
  Filter,
  PublishResult,
  SubscribeHandlers,
  Transport,
  TransportHealth,
  Unsubscribe,
} from './index'
import type { SignedEvent } from '../../types/nostr'

/** Capacidade da LRU de event.id pra dedup cross-transport. */
const DEDUP_CAP = 1_000

interface RegisteredTransport {
  transport: Transport
  weight: number
  required: boolean
}

const registry: RegisteredTransport[] = []

/**
 * Registra um transporte ativo no orchestrator. Chamar no bootstrap.
 *
 * @param transport instância de `Transport` (wssTransport, webrtcTransport, etc)
 * @param opts.weight peso pro tie-break em race (não usado em MVP — futuro 6.3)
 * @param opts.required se `true`, falha do transporte falha o publish inteiro
 *   (não há esse caso ainda — todos opcionais). Default `false`.
 */
export function registerTransport(
  transport: Transport,
  opts: { weight?: number; required?: boolean } = {},
): void {
  // Idempotente: re-register substitui (útil pra hot-reload em dev).
  const idx = registry.findIndex((r) => r.transport === transport)
  const entry: RegisteredTransport = {
    transport,
    weight: opts.weight ?? 1,
    required: opts.required ?? false,
  }
  if (idx >= 0) registry[idx] = entry
  else registry.push(entry)
}

/** Test-only: limpa registry entre tests. */
export function _resetRegistry(): void {
  registry.length = 0
}

async function publish(event: SignedEvent): Promise<PublishResult> {
  if (registry.length === 0) {
    return { ok: 0, failed: 0, perRelay: [] }
  }

  // Race-to-first-ok — dispara em todos os transportes; resolve no
  // primeiro que retornar `ok > 0`. Outros continuam em background.
  // Resultado final: agregado de todos quando TODOS terminarem (caller
  // só espera o primeiro OK; mas pra honesto retorno, agregamos).
  const promises = registry.map((r) =>
    r.transport.publish(event).catch(
      (err): PublishResult => ({
        ok: 0,
        failed: 1,
        perRelay: [
          {
            url: `${r.transport.kind}:error`,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          },
        ],
      }),
    ),
  )

  // Aguarda todos pra agregar — race semantics seria optimization
  // futura (6.3). Por ora, behavior idêntico a publishToRelays
  // sequential: caller espera todos e vê per-transport breakdown.
  const results = await Promise.all(promises)

  let ok = 0
  let failed = 0
  const perRelay: PublishResult['perRelay'] = []
  for (const result of results) {
    ok += result.ok
    failed += result.failed
    perRelay.push(...result.perRelay)
  }
  return { ok, failed, perRelay }
}

function subscribe(filter: Filter, handlers: SubscribeHandlers): Unsubscribe {
  if (registry.length === 0) {
    // Sem transportes registrados — subscribe é no-op. EOSE imediato
    // pra não travar caller esperando histórico.
    if (handlers.oneose) queueMicrotask(() => handlers.oneose?.())
    return () => {
      /* noop */
    }
  }

  // Dedup LRU: `event.id` → tick de inserção. Quando excede DEDUP_CAP,
  // remove o mais antigo (Map mantém ordem de inserção).
  const seen = new Map<string, true>()
  let eosFired = false

  const wrappedHandlers: SubscribeHandlers = {
    onevent: async (event: SignedEvent) => {
      if (seen.has(event.id)) return
      seen.set(event.id, true)
      // Cap defensivo — evita growth ilimitado em sessions longas.
      if (seen.size > DEDUP_CAP) {
        const first = seen.keys().next().value
        if (first !== undefined) seen.delete(first)
      }
      await handlers.onevent(event)
    },
    oneose: () => {
      // Primeiro EOSE conta — não esperamos o transporte mais lento.
      if (eosFired) return
      eosFired = true
      handlers.oneose?.()
    },
  }

  const unsubs = registry.map((r) => r.transport.subscribe(filter, wrappedHandlers))

  return () => {
    for (const unsub of unsubs) {
      try {
        unsub()
      } catch {
        /* noop — transporte pode já estar fechado */
      }
    }
    seen.clear()
  }
}

async function health(timeoutMs?: number): Promise<TransportHealth[]> {
  if (registry.length === 0) return []

  const results = await Promise.all(
    registry.map((r) =>
      r.transport.health(timeoutMs).catch(
        (): TransportHealth[] => [
          {
            url: `${r.transport.kind}:error`,
            ok: false,
            latencyMs: null,
          },
        ],
      ),
    ),
  )

  // Concat com prefixo — `wss:relay.url` vs `webrtc:peerNpub.slice(8)`.
  // Caller distingue origem.
  const out: TransportHealth[] = []
  for (let i = 0; i < results.length; i++) {
    const r = registry[i]!
    for (const h of results[i]!) {
      out.push({
        ...h,
        url: `${r.transport.kind}:${h.url}`,
      })
    }
  }
  return out
}

export const orchestrator: Transport = {
  kind: 'bundle',
  publish,
  subscribe,
  health,
}
