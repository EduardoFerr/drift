/**
 * Busca de eventos órfãos — POST referenciado por spread/bury/comentário/
 * prova OTS que este cliente ainda não tem.
 *
 * Por quê (auditoria 2026-11-03, P2): a assinatura global usa janela de
 * 7 dias e `limit 500` por relay. Um spread num post mais antigo que isso
 * chegava, mas o post não — o voto ficava órfão e "espalhar" nunca trazia
 * o conteúdo de volta. Aqui pedimos o evento pelo id (`{ ids: [...] }`,
 * NIP-01) e o entregamos ao pipeline canônico (`onNostrEvent`), que valida
 * e verifica assinatura como qualquer outro evento — invariante #1.
 *
 * Anti-martelo: cada id é pedido no máximo 1× por `RETRY_MS`; lotes de
 * até `BATCH` ids; cada REQ fecha no EOSE ou após `TIMEOUT_MS`.
 */

import { orchestrator } from './transport/orchestrator'
import type { Filter } from './transport'
import type { SignedEvent } from '../types/nostr'

const BATCH = 50
const TIMEOUT_MS = 10_000
const RETRY_MS = 60 * 60 * 1000
const ATTEMPTED_CAP = 20_000

const attempted = new Map<string, number>()

/** Ids ainda não pedidos (ou pedidos há mais de `RETRY_MS`). Pura sobre `attempted`. */
export function selectIdsToRequest(ids: readonly string[], nowMs: number): string[] {
  const out: string[] = []
  for (const id of ids) {
    const last = attempted.get(id)
    if (last !== undefined && nowMs - last < RETRY_MS) continue
    out.push(id)
  }
  return out
}

export function requestMissingEvents(ids: readonly string[], nowMs = Date.now()): void {
  requestBatched(ids, nowMs, (chunk) => ({ ids: chunk }))
}

/**
 * Provas OTS (kind 1040) publicadas PELOS PRÓPRIOS autores ainda sem
 * âncora. A assinatura global só traz provas da janela recente; a prova
 * de uma identidade antiga foi publicada meses atrás. Prova publicada por
 * terceiros também vale, mas só a do autor dá pra pedir sem saber o id.
 */
export function requestAnchorsFor(npubs: readonly string[], nowMs = Date.now()): void {
  requestBatched(
    npubs.map((n) => `anchor:${n}`),
    nowMs,
    (chunk) => ({ kinds: [1040], authors: chunk.map((k) => k.slice('anchor:'.length)) }),
  )
}

function requestBatched(
  keys: readonly string[],
  nowMs: number,
  toFilter: (chunk: string[]) => Filter,
): void {
  const todo = selectIdsToRequest([...new Set(keys)], nowMs)
  if (todo.length === 0) return
  if (attempted.size > ATTEMPTED_CAP) attempted.clear()
  for (const id of todo) attempted.set(id, nowMs)

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH)
    let closed = false
    let unsubscribe: (() => void) | null = null
    const close = () => {
      if (closed) return
      closed = true
      unsubscribe?.()
    }
    unsubscribe = orchestrator.subscribe(
      toFilter(chunk),
      {
        onevent: (event: SignedEvent) => {
          // Lazy: events.ts importa este módulo.
          void import('./events')
            .then(({ onNostrEvent }) => onNostrEvent(event))
            .catch((err) => console.warn('[orphans] ingest falhou:', err))
        },
        oneose: close,
      },
    )
    if (closed) unsubscribe?.()
    setTimeout(close, TIMEOUT_MS)
  }
}

/** Só pra testes. */
export function __resetOrphansForTest(): void {
  attempted.clear()
}
