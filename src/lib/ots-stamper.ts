/**
 * Carimbo OpenTimestamps da identidade ativa — gera a âncora de
 * antiguidade que `ranking.ts` exige (auditoria 2026-11-03, S1/S3).
 *
 * Ciclo (idempotente, retomável entre sessões via `ots_local_stamps`):
 *   1. sem âncora e sem carimbo local → carimba o evento MAIS RECENTE que
 *      esta identidade tem no banco (post > comment > spread > bury);
 *      calendários OTS públicos agregam o digest numa transação Bitcoin;
 *   2. a cada `UPGRADE_EVERY_MS` tenta o upgrade (o calendário só devolve a
 *      prova completa depois que o bloco confirma — tipicamente horas);
 *   3. com attestation Bitcoin → remove as pending (NIP-03), assina e
 *      publica kind 1040, e ingere localmente pelo pipeline canônico.
 *
 * Antiguidade conta a partir do BLOCO, não do `created_at`: ninguém
 * consegue carimbar no passado. Quem nunca agiu não tem o que carimbar —
 * e não precisa de peso.
 *
 * Privacidade (§28): o calendário vê o IP e sha256(id ‖ nonce). Depois que
 * a prova kind 1040 é publicada (ela contém o nonce), o calendário pode
 * ligar aquele IP ao evento e à npub — e, com várias identidades no mesmo
 * aparelho, ligar as identidades entre si. Desligado fora de
 * `network_mode = 'clearnet'` e quando `ots_stamping_enabled = false`.
 */

import { db } from './db'
import {
  base64ToBytes,
  bytesToBase64,
  collectLeaves,
  hexToBytes,
  parseOtsFile,
  serializeOtsFile,
} from './ots'
import { stampDigest, stripPending, upgradeOtsFile } from './ots-client'

const UPGRADE_EVERY_MS = 60 * 60 * 1000

export type StampStatus = 'disabled' | 'anchored' | 'nothing' | 'stamped' | 'waiting' | 'published'

interface LocalStampRow {
  event_id: string
  kind: number
  ots_b64: string
  last_try: number | null
  published: number
}

export interface StamperDeps {
  nowMs?: number
  stamp?: typeof stampDigest
  upgrade?: typeof upgradeOtsFile
  /** Assina + publica + ingere o kind 1040. Default: identidade ativa. */
  publishProof?: (input: { kind: number; tags: string[][]; content: string }) => Promise<void>
  enabled?: boolean
}

export async function ensureOwnAnchor(npub: string, deps: StamperDeps = {}): Promise<StampStatus> {
  const nowMs = deps.nowMs ?? Date.now()
  if (!(deps.enabled ?? (await stampingAllowed()))) return 'disabled'

  const anchor = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ots_anchors WHERE author_pub = ?`,
    [npub],
  )
  if ((anchor?.n ?? 0) > 0) return 'anchored'

  const local = await db.get<LocalStampRow>(
    `SELECT event_id, kind, ots_b64, last_try, published FROM ots_local_stamps
     WHERE npub = ? ORDER BY created_at ASC LIMIT 1`,
    [npub],
  )

  if (!local) {
    const target = await newestOwnEvent(npub)
    if (!target) return 'nothing'
    const file = await (deps.stamp ?? stampDigest)(hexToBytes(target.id))
    await db.run(
      `INSERT OR IGNORE INTO ots_local_stamps (event_id, npub, kind, ots_b64, created_at, last_try)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [target.id, npub, target.kind, bytesToBase64(serializeOtsFile(file)), nowMs, nowMs],
    )
    return 'stamped'
  }

  if (local.published) return 'waiting' // publicado; aguardando verificação/âncora
  if (local.last_try !== null && nowMs - local.last_try < UPGRADE_EVERY_MS) return 'waiting'

  const { file } = await (deps.upgrade ?? upgradeOtsFile)(parseOtsFile(base64ToBytes(local.ots_b64)))
  await db.run(`UPDATE ots_local_stamps SET ots_b64 = ?, last_try = ? WHERE event_id = ?`, [
    bytesToBase64(serializeOtsFile(file)),
    nowMs,
    local.event_id,
  ])

  const leaves = await collectLeaves(file)
  if (!leaves.some((l) => l.attestation.type === 'bitcoin')) return 'waiting'

  const content = bytesToBase64(serializeOtsFile(stripPending(file)))
  await (deps.publishProof ?? publishOwnProof)({
    kind: 1040,
    tags: [
      ['e', local.event_id],
      ['k', String(local.kind)],
    ],
    content,
  })
  await db.run(`UPDATE ots_local_stamps SET published = 1 WHERE event_id = ?`, [local.event_id])
  return 'published'
}

/**
 * Evento a carimbar: o MAIS RECENTE da identidade (post > comment > spread
 * > bury). A antiguidade vem do bloco Bitcoin, não do evento — então
 * qualquer evento serve, e o recente é o que os outros clientes já têm
 * (janela de sync de 7 dias): lá a prova chega reconhecida como do
 * próprio autor (prioridade, sem busca na rede). Carimbar o mais antigo
 * obrigava cada cliente a buscá-lo na rede (revisão A17).
 */
async function newestOwnEvent(npub: string): Promise<{ id: string; kind: number } | null> {
  const row = await db.get<{ id: string; kind: number }>(
    `SELECT id, kind FROM (
       SELECT id, 9078 AS kind, created_at, 0 AS pref FROM posts WHERE author_pub = ?
       UNION ALL SELECT id, 1111, created_at, 1 FROM comments WHERE author_pub = ?
       UNION ALL SELECT event_id, 9079, created_at, 2 FROM spreads WHERE spreader_pub = ?
       UNION ALL SELECT event_id, 9080, created_at, 3 FROM buries WHERE burier_pub = ?
     ) ORDER BY pref ASC, created_at DESC LIMIT 1`,
    [npub, npub, npub, npub],
  )
  return row ?? null
}

async function stampingAllowed(): Promise<boolean> {
  const { getPrefs } = await import('./prefs')
  const p = getPrefs()
  return p.ots_stamping_enabled !== false && (p.network_mode ?? 'clearnet') === 'clearnet'
}

async function publishOwnProof(input: { kind: number; tags: string[][]; content: string }): Promise<void> {
  const { signDriftEvent, publishToRelays } = await import('./nostr')
  const event = await signDriftEvent(input)
  await publishToRelays(event)
  // Ingestão local pelo pipeline canônico (invariante #1) — não espera o eco do relay.
  const { onNostrEvent } = await import('./events')
  await onNostrEvent(event)
}

let stamperTimer: ReturnType<typeof setInterval> | null = null

/**
 * Liga o ciclo pra identidade ativa: 1 tentativa agora + a cada hora.
 * Também re-tenta verificar provas pendentes recebidas de terceiros.
 */
export function startOtsStamper(getNpub: () => Promise<string | null>): void {
  if (stamperTimer !== null) return
  const tick = async () => {
    try {
      const npub = await getNpub()
      if (npub) await ensureOwnAnchor(npub)
    } catch (err) {
      console.warn('[ots] carimbo falhou (tenta de novo depois):', err)
    }
    const { scheduleOtsVerification } = await import('./ots-anchors')
    scheduleOtsVerification()
  }
  void tick()
  stamperTimer = setInterval(() => void tick(), UPGRADE_EVERY_MS)
}
