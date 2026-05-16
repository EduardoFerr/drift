/**
 * verify.worker — Schnorr verify dedicado em Web Worker.
 *
 * Stateless por design (Ted RFC §3.1, Barney threat model §3.6 BW1-BW4):
 *  - Sem queue interno; correlação por `id` mora no main thread (verify.ts).
 *  - Sem fetch, sem DB, sem IndexedDB, sem cookies, sem localStorage.
 *  - Imports MÍNIMOS: só `nostr-tools/pure` (verifyEvent → schnorr secp256k1
 *    sha256). Chunk worker fica enxuto (~40-55 KB raw / 14-18 KB gz).
 *
 * Boundary main↔worker — protocolo:
 *   InMessage:  { id: number; event: SignedEvent }      pedido
 *   OutMessage: { id: number; ok: boolean }              resposta
 *
 * Mensagens são correlacionadas 1:1 por `id`. Worker NÃO mantém ordem
 * interna além da entrega serial do event loop — main thread garante
 * que o resolve da Promise correta acontece via pending Map (verify.ts).
 *
 * Invariantes preservados (CLAUDE.md):
 *  #1 — Worker NUNCA escreve no SQLite (sem import de db).
 *  #5 — Pipeline cheap→caro: schema check fica no main (events.ts),
 *       só eventos que passam no schema chegam aqui pro verify caro.
 *  #7 — Schnorr é determinístico: worker rodando verifyEvent dá mesmo
 *       resultado que main rodando verifyEvent (Barney §3.4).
 *  #8 — nsec NUNCA passa este boundary. Worker recebe SignedEvent
 *       (pubkey+sig já públicos por design Nostr) e devolve boolean
 *       (Barney §3.5, BW3).
 *
 * Crash recovery: try/catch defensivo em torno de verifyEvent —
 * input malformado que detonasse @noble vira `ok=false` em vez de
 * derrubar o worker (Barney threat model T1, defesa).
 */

import { verifyEvent } from 'nostr-tools/pure'
import type { Event as SignedEvent } from 'nostr-tools'

interface InMessage {
  id: number
  event: SignedEvent
}

interface OutMessage {
  id: number
  ok: boolean
}

self.onmessage = (e: MessageEvent<InMessage>): void => {
  const { id, event } = e.data
  let ok = false
  try {
    ok = verifyEvent(event)
  } catch {
    // Input malformado / @noble lançou — trata como verify fail.
    // Não logamos por padrão: em verify-storm hostil, log floda console.
    ok = false
  }
  ;(self as unknown as Worker).postMessage({ id, ok } satisfies OutMessage)
}
