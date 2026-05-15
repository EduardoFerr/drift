/**
 * Gerenciamento dinâmico de relays — manifesto §14 (Bootstrap Distribuído).
 *
 * Substitui a seed list estática (`config/relays.ts`) como fonte de
 * verdade pra `wssTransport`. A seed continua sendo populada no banco
 * na primeira boot (via `ensureSeedRelays`) — daí em diante tudo é
 * gerenciado pelo user.
 *
 * Sources possíveis em `relays_user.source`:
 *   - 'seed'      — pré-instalado pelo cliente (4 iniciais)
 *   - 'user'      — adicionado manualmente
 *   - 'nip65'     — descoberto via kind 10002 de algum user
 *   - 'recommend' — sugerido por tag `recommend-relay` em algum evento
 *
 * Manifesto §20: cliente sempre mantém ao menos 1 relay aleatório fora
 * da preferência do user pra resistir a eclipse por self-config. Isso
 * acontece via `pickAntiEclipseRelay()` que, mesmo após o user remover
 * todos os seeds, mantém **um** seed forçadamente ativo.
 */

import { create } from 'zustand'
import { db } from './db'
import {
  RELAYS as SEED_RELAYS,
  SEED_RELAY_CONFIGS,
} from '../config/relays'
import { getPrefs } from './prefs'
import type { NetworkMode } from '../types/drift'
import {
  filterDemoted,
  getHealth,
  hydrateHealth,
  noteFailure,
  noteSuccess,
} from './relay-health'

// ─── Tipos ───────────────────────────────────────────────────────────

export type RelaySource = 'seed' | 'user' | 'nip65' | 'recommend'

export interface RelayRecord {
  url: string
  read: boolean
  write: boolean
  source: RelaySource
  addedAt: number
  lastOkAt: number | null
  lastErr: string | null
  enabled: boolean
  /** Demoted até este ms epoch. 0 = não demoted. (relay-health, Barney 2026-05-15) */
  demotedUntil: number
  /** Falhas consecutivas. Reset em sucesso. */
  consecutiveFails: number
}

interface RelayRow {
  url: string
  read: number
  write: number
  source: string
  added_at: number
  last_ok_at: number | null
  last_err: string | null
  last_err_at: number | null
  enabled: number
  consecutive_fails: number | null
  demoted_until: number | null
}

function rowToRecord(r: RelayRow): RelayRecord {
  const source: RelaySource =
    r.source === 'seed' ||
    r.source === 'user' ||
    r.source === 'nip65' ||
    r.source === 'recommend'
      ? r.source
      : 'user'
  return {
    url: r.url,
    read: r.read !== 0,
    write: r.write !== 0,
    source,
    addedAt: r.added_at,
    lastOkAt: r.last_ok_at,
    lastErr: r.last_err,
    enabled: r.enabled !== 0,
    demotedUntil: r.demoted_until ?? 0,
    consecutiveFails: r.consecutive_fails ?? 0,
  }
}

const SELECT_COLUMNS =
  `url, read, write, source, added_at, last_ok_at, last_err, last_err_at, enabled, consecutive_fails, demoted_until`

// ─── Store reativa ───────────────────────────────────────────────────

interface RelaysState {
  list: RelayRecord[]
  loaded: boolean
}

export const useRelaysStore = create<RelaysState>(() => ({
  list: [],
  loaded: false,
}))

// ─── Carregamento + seed ─────────────────────────────────────────────

let initialized = false

/**
 * Carrega relays do banco pra store. Idempotente.
 *
 * Na primeira corrida, popula a seed list (4 relays do `config/relays.ts`).
 * Após isso, qualquer remoção é respeitada — re-rodar `ensureSeedRelays`
 * não ressuscita relays que o user explicitamente removeu (manifesto §10:
 * cliente é autoridade sobre próprio estado).
 */
export async function loadRelays(): Promise<void> {
  if (initialized) return
  initialized = true

  await ensureSeedRelays()
  const rows = await db.exec<RelayRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM relays_user
     ORDER BY enabled DESC, added_at ASC`,
  )
  // Hidrata o tracker de saúde a partir do banco. A partir daqui,
  // `activeRelays`/etc. consultam o tracker (in-memory) — não vão ao
  // banco no hot path.
  hydrateHealth(rows.map((r) => ({
    url: r.url,
    consecutive_fails: r.consecutive_fails,
    demoted_until: r.demoted_until,
    last_ok_at: r.last_ok_at,
    last_err_at: r.last_err_at,
  })))
  useRelaysStore.setState({
    list: rows.map(rowToRecord),
    loaded: true,
  })
}

/**
 * Popula a seed list só se a tabela está completamente vazia.
 *
 * Se o user removeu todos os relays manualmente, NÃO ressuscita — só
 * mantém o anti-eclipse aleatório via `pickAntiEclipseRelay()` depois.
 */
async function ensureSeedRelays(): Promise<void> {
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM relays_user`)
  if ((row?.n ?? 0) > 0) return

  const now = Date.now()
  for (const url of SEED_RELAYS) {
    await db.run(
      `INSERT OR IGNORE INTO relays_user (url, read, write, source, added_at, enabled)
       VALUES (?, 1, 1, 'seed', ?, 1)`,
      [url, now],
    )
  }
}

async function refreshList(): Promise<void> {
  const rows = await db.exec<RelayRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM relays_user
     ORDER BY enabled DESC, added_at ASC`,
  )
  useRelaysStore.setState({ list: rows.map(rowToRecord), loaded: true })
}

// ─── CRUD ────────────────────────────────────────────────────────────

export interface AddRelayInput {
  url: string
  read?: boolean
  write?: boolean
  source?: RelaySource
}

export async function addRelay(input: AddRelayInput): Promise<void> {
  const url = normalizeUrl(input.url)
  if (!isValidWss(url)) {
    throw new Error(`URL de relay inválida: ${input.url}. Esperado wss://...`)
  }
  // Detecta se já existia — se não, é "relay novo" e merece rebroadcast.
  const existing = await db.get<{ url: string }>(
    `SELECT url FROM relays_user WHERE url = ? LIMIT 1`,
    [url],
  )
  const isNew = !existing

  await db.run(
    `INSERT INTO relays_user (url, read, write, source, added_at, enabled)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(url) DO UPDATE SET
       read = excluded.read,
       write = excluded.write,
       enabled = 1`,
    [
      url,
      input.read === false ? 0 : 1,
      input.write === false ? 0 : 1,
      input.source ?? 'user',
      Date.now(),
    ],
  )
  await refreshList()

  // Re-broadcast oportunista — manifesto §16. Roda fire-and-forget
  // pra não bloquear UI. Identidade obtida lazy pra evitar import
  // cíclico (relays.ts ← identity.ts ← bootstrap.ts ← relays.ts).
  if (isNew && (input.write !== false)) {
    void scheduleRebroadcast(url)
  }
}

async function scheduleRebroadcast(relayUrl: string): Promise<void> {
  try {
    const [{ getOrCreateIdentity }, { rebroadcastToRelay }] = await Promise.all([
      import('./identity'),
      import('./rebroadcast'),
    ])
    const identity = await getOrCreateIdentity()
    const result = await rebroadcastToRelay(relayUrl, identity.npub)
    if (result.sent > 0) {
      console.log(
        `[relays] re-broadcast em ${relayUrl}: ${result.sent} eventos · ${result.durationMs}ms`,
      )
    }
  } catch (err) {
    console.warn('[relays] re-broadcast falhou:', err)
  }
}

export async function removeRelay(url: string): Promise<void> {
  await db.run(`DELETE FROM relays_user WHERE url = ?`, [normalizeUrl(url)])
  await refreshList()
}

export async function setRelayEnabled(url: string, enabled: boolean): Promise<void> {
  await db.run(
    `UPDATE relays_user SET enabled = ? WHERE url = ?`,
    [enabled ? 1 : 0, normalizeUrl(url)],
  )
  await refreshList()
}

export async function recordRelayOk(url: string): Promise<void> {
  const normalized = normalizeUrl(url)
  const now = Date.now()
  // Atualiza tracker in-memory primeiro — hot path lê daqui.
  const state = noteSuccess(normalized, now)
  await db.run(
    `UPDATE relays_user
       SET last_ok_at = ?,
           last_err = NULL,
           consecutive_fails = ?,
           demoted_until = ?
     WHERE url = ?`,
    [now, state.consecutiveFails, state.demotedUntil, normalized],
  )
  // Não refresh aqui — chamado em hot path; UI consome snapshot atual.
}

export async function recordRelayError(url: string, err: string): Promise<void> {
  const normalized = normalizeUrl(url)
  const now = Date.now()
  const state = noteFailure(normalized, now)
  await db.run(
    `UPDATE relays_user
       SET last_err = ?,
           last_err_at = ?,
           consecutive_fails = ?,
           demoted_until = ?
     WHERE url = ?`,
    [err.slice(0, 200), now, state.consecutiveFails, state.demotedUntil, normalized],
  )
}

// ─── Leitura ─────────────────────────────────────────────────────────

/**
 * Aplica `NetworkMode` (Fase 6.4) sobre uma lista de URLs clearnet.
 *
 *  - `clearnet`: retorna URLs como vieram (default).
 *  - `tor`: troca por `.onion` quando o config seed tiver alias; senão
 *    mantém clearnet (o WSS via Tor segue funcionando, só não anônimo
 *    end-to-end no nível de hidden-service).
 *  - `onion-only`: filtra fora qualquer URL sem `.onion` conhecido.
 *
 * Hoje a fonte de aliases `.onion` é só `SEED_RELAY_CONFIGS` (relays
 * adicionados pelo user vão clearnet-only até migration v8 adicionar
 * coluna `onion` em `relays_user`).
 */
function applyNetworkMode(urls: string[], mode: NetworkMode): string[] {
  if (mode === 'clearnet') return urls
  const onionByUrl = new Map<string, string>()
  for (const cfg of SEED_RELAY_CONFIGS) {
    if (cfg.onion) onionByUrl.set(cfg.url, cfg.onion)
  }
  const out: string[] = []
  for (const url of urls) {
    const onion = onionByUrl.get(url)
    if (mode === 'onion-only') {
      if (onion) out.push(onion)
      // sem onion → drop
      continue
    }
    // mode === 'tor'
    out.push(onion ?? url)
  }
  return out
}

/**
 * URLs ativas (enabled=1) — substitui o uso direto de `RELAYS` em
 * `wssTransport`. Snapshot síncrono da store.
 *
 * Inclui sempre ao menos 1 relay aleatório fora da preferência do user
 * se o conjunto user-curado for muito pequeno (<2). Manifesto §20.
 *
 * Fase 6.4: aplica `NetworkMode` (clearnet/tor/onion-only) antes de
 * retornar — em `tor` prefere `.onion`, em `onion-only` filtra fora
 * relays clearnet-only.
 */
export function activeRelays(): string[] {
  const list = useRelaysStore.getState().list
  const active = list.filter((r) => r.enabled).map((r) => r.url)
  let urls: string[]
  if (active.length >= 2) {
    urls = active
  } else {
    // Anti-eclipse: se o user só tem 0-1 relay configurado, mistura
    // seeds que ele NÃO removeu na rotação (não viola §10 — não
    // ressuscita removidos, só completa).
    const knownUrls = new Set(list.map((r) => r.url))
    const fallback = SEED_RELAYS.filter((u) => !knownUrls.has(u))
    urls = [...active, ...fallback]
  }
  // Filtra demoted (relay-health). `filterDemoted` garante ≥1 fallback
  // mesmo em outage total — manifesto §20.
  const live = filterDemoted(urls, getHealth, Date.now())
  return applyNetworkMode(live, getPrefs().network_mode)
}

/**
 * URLs habilitadas pra escrita (publish). Subset de `activeRelays`.
 * NIP-65: read e write podem divergir.
 *
 * Filtra relays demoted (relay-health). Caller é responsável por
 * tratar set vazio (em prática nunca: `filterDemoted` garante fallback
 * via `activeRelays` se write list zera).
 */
export function activeWriteRelays(): string[] {
  const list = useRelaysStore.getState().list
  const active = list.filter((r) => r.enabled && r.write).map((r) => r.url)
  if (active.length === 0) return activeRelays()
  const live = filterDemoted(active, getHealth, Date.now())
  return applyNetworkMode(live, getPrefs().network_mode)
}

/**
 * URLs habilitadas pra leitura (subscribe). Subset de `activeRelays`.
 *
 * Filtra relays demoted (relay-health). Em caso de todos demoted,
 * `filterDemoted` mantém o de menor `demotedUntil` (anti-eclipse §20).
 */
export function activeReadRelays(): string[] {
  const list = useRelaysStore.getState().list
  const active = list.filter((r) => r.enabled && r.read).map((r) => r.url)
  if (active.length === 0) return activeRelays()
  const live = filterDemoted(active, getHealth, Date.now())
  return applyNetworkMode(live, getPrefs().network_mode)
}

// ─── Helpers ─────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, '').toLowerCase()
}

function isValidWss(url: string): boolean {
  return /^wss?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)
}
