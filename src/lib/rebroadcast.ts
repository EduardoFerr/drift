/**
 * Re-broadcast oportunista — manifesto §16 (Disponibilidade Distribuída).
 *
 * Quando o cliente conecta a um relay novo, republica os eventos que
 * o user **publicou** ou **espalhou**. Mecânica social vira
 * infraestrutura técnica:
 *
 *   "espalhar = seedear"
 *
 * Em escala, cada user que espalha um post viral vira fonte alternativa
 * dele. Se um relay original cair ou for bloqueado, posts continuam
 * acessíveis via os clientes que espalharam.
 *
 * **Seleção:**
 *   - Posts próprios (author_pub = currentNpub)
 *   - Posts que o user espalhou (existe spread.spreader_pub = currentNpub)
 *   - Os spreads/buries do próprio user (republica os eventos de ação)
 *
 * **NÃO inclui:**
 *   - Reports — privacidade do reporter (manifesto §26 não obriga
 *     re-broadcast)
 *   - Buries de outros (nada a ver com você)
 *
 * **Limite (manifesto §16):** seedear pode revelar quem tem o quê. Em
 * modo paranoia (Fase 6), seeding é desligado por default; user
 * ativa explicitamente. Por enquanto Fase 5 ativa por default — tradeoff
 * aceitável dado que a alternativa é perda de durabilidade.
 *
 * Throttling: re-broadcast é fire-and-forget com delay aleatório
 * pequeno entre eventos pra não saturar o relay.
 */

import { db } from './db'
import { pool } from './transport/wss'
import type { SignedEvent } from '../types/nostr'

const PUBLISH_GAP_MS = 50 // 50ms entre publishes pra não floodar
const MAX_EVENTS_PER_RUN = 200 // limite alto, mas não infinito
const REBROADCAST_TIMEOUT_MS = 8000 // tempo total máximo por run

interface RawEventRow {
  raw_event: string | null
}

/**
 * Republica eventos do user atual num relay específico.
 *
 * Tipicamente chamado quando o user adiciona um relay novo via UI, ou
 * via NIP-65 import. Pode ser chamado periodicamente por cliente
 * paranoico mas não é o caminho default.
 *
 * @param relayUrl - Relay onde republicar
 * @param currentNpub - Pubkey hex do user atual (filtrar posts próprios + espalhados)
 * @returns Estatísticas: quantos eventos enviados, quantos com erro
 */
export async function rebroadcastToRelay(
  relayUrl: string,
  currentNpub: string,
): Promise<{ sent: number; failed: number; durationMs: number }> {
  const start = Date.now()

  const events = await collectMyEvents(currentNpub)
  if (events.length === 0) {
    return { sent: 0, failed: 0, durationMs: 0 }
  }

  let sent = 0
  let failed = 0
  const startedAt = Date.now()

  for (const event of events) {
    if (Date.now() - startedAt > REBROADCAST_TIMEOUT_MS) {
      console.warn('[rebroadcast] timeout — parando após', sent, 'eventos')
      break
    }
    try {
      await pool.publish([relayUrl], event)
      sent++
    } catch (err) {
      failed++
      console.warn('[rebroadcast]', relayUrl, 'falhou:', err)
    }
    if (PUBLISH_GAP_MS > 0) {
      await sleep(PUBLISH_GAP_MS)
    }
  }

  return { sent, failed, durationMs: Date.now() - start }
}

async function collectMyEvents(npub: string): Promise<SignedEvent[]> {
  // Posts próprios + posts espalhados pelo user (via JOIN com spreads)
  // + spreads + buries do user. Ignora rows sem raw_event (eventos
  // antigos pré-Fase-5 sem coluna).
  const rows = await db.exec<RawEventRow>(
    `
    SELECT raw_event FROM posts WHERE author_pub = ? AND raw_event IS NOT NULL
    UNION ALL
    SELECT p.raw_event FROM posts p
      INNER JOIN spreads s ON s.post_id = p.id
      WHERE s.spreader_pub = ? AND p.raw_event IS NOT NULL
    UNION ALL
    SELECT raw_event FROM spreads WHERE spreader_pub = ? AND raw_event IS NOT NULL
    UNION ALL
    SELECT raw_event FROM buries WHERE burier_pub = ? AND raw_event IS NOT NULL
    LIMIT ?
    `,
    [npub, npub, npub, npub, MAX_EVENTS_PER_RUN],
  )

  const seen = new Set<string>()
  const events: SignedEvent[] = []
  for (const row of rows) {
    if (!row.raw_event) continue
    try {
      const ev = JSON.parse(row.raw_event) as SignedEvent
      if (!ev.id || seen.has(ev.id)) continue
      seen.add(ev.id)
      events.push(ev)
    } catch {
      /* JSON malformado — ignora */
    }
  }
  return events
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
