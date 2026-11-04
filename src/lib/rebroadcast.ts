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
 * **Seleção** (ordem de prioridade em `collectMyEvents`):
 *   - Provas OTS da própria identidade (âncora de antiguidade)
 *   - Os spreads/buries do próprio user (votos)
 *   - Comentários próprios
 *   - Posts próprios (author_pub = currentNpub)
 *   - Posts que o user espalhou (existe spread.spreader_pub = currentNpub)
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

const PUBLISH_GAP_MS = 20 // entre publishes pra não floodar
const MAX_EVENTS_PER_RUN = 2000 // por categoria; limite alto, mas não infinito
const REBROADCAST_TIMEOUT_MS = 60_000 // tempo total máximo por run

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

/**
 * Ordem de prioridade (auditoria 2026-11-03, P3). Antes era um único
 * `UNION ALL … LIMIT 200` com posts próprios primeiro: quem tinha >200
 * posts nunca republicava um spread/bury — e são os votos que definem o
 * ranking. Agora cada categoria tem seu próprio teto e vem nesta ordem:
 *   1. provas OTS próprias (âncora de antiguidade — sem elas o peso some);
 *   2. spreads + buries próprios (votos; eventos pequenos);
 *   3. comentários próprios;
 *   4. posts próprios, mais recentes primeiro;
 *   5. posts que o user espalhou (seedear, §16).
 */
async function collectMyEvents(npub: string): Promise<SignedEvent[]> {
  const q = (sql: string, params: unknown[]) => db.exec<RawEventRow>(sql, [...params, MAX_EVENTS_PER_RUN])
  const groups = await Promise.all([
    q(
      `SELECT raw_event FROM ots_proofs
       WHERE target_event_id IN (SELECT target_event_id FROM ots_anchors WHERE author_pub = ?)
       LIMIT ?`,
      [npub],
    ),
    q(
      `SELECT raw_event FROM (
         SELECT raw_event, created_at FROM spreads WHERE spreader_pub = ? AND raw_event IS NOT NULL
         UNION ALL
         SELECT raw_event, created_at FROM buries WHERE burier_pub = ? AND raw_event IS NOT NULL
       ) ORDER BY created_at DESC LIMIT ?`,
      [npub, npub],
    ),
    q(`SELECT raw_event FROM comments WHERE author_pub = ? ORDER BY created_at DESC LIMIT ?`, [npub]),
    q(
      `SELECT raw_event FROM posts WHERE author_pub = ? AND raw_event IS NOT NULL
       ORDER BY created_at DESC LIMIT ?`,
      [npub],
    ),
    q(
      `SELECT p.raw_event FROM posts p INNER JOIN spreads s ON s.post_id = p.id
       WHERE s.spreader_pub = ? AND p.raw_event IS NOT NULL
       ORDER BY s.created_at DESC LIMIT ?`,
      [npub],
    ),
  ])
  const rows = groups.flat()

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
