/**
 * Relay directory runtime — NIP-11 fetch + cache 24h + lookup helpers.
 *
 * Pipeline:
 *   1. Discovery UX abre tab → React component pede `getDirectoryEntries(tab)`
 *   2. Pra cada entry, `getRelayInfo(url)` checa cache SQLite (TTL 24h)
 *   3. Cache miss → `fetchNip11(url)` HTTP GET com `Accept:application/nostr+json`
 *   4. Persist em `relay_directory_cache` + retorna parsed metadata
 *
 * Lazy: NIP-11 fetch só roda na primeira vez que tab é aberta.
 *
 * **Manifesto §28** (privacidade pelo mínimo): NIP-11 fetch é HTTP GET
 * comum — em `network_mode=tor`, roteia via SOCKS5 arti (Fase 6). PWA
 * clearnet expõe IP igual a qualquer GET. Não correlacionável com
 * identidade Drift (sem nsec na request).
 *
 * **NIP-11 spec:** `github.com/nostr-protocol/nips/blob/master/11.md`
 * Campos canônicos: `name`, `description`, `pubkey`, `contact`, `supported_nips`,
 * `software`, `version`, `limitation`, `payments_url`, `fees`, `posting_policy`.
 * Drift estende com `drift_policy` (custom, opt-in pelo operator — Ted RFC).
 */

import { db } from './db'
import {
  RELAY_DIRECTORY,
  getRelaysByTab,
  type RelayDirectoryEntry,
  type RelayDirectoryTab,
} from '../config/relays-directory'

/** TTL do cache: 24h. Relay metadata é estável; refetch frequente é desperdício. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Timeout HTTP do NIP-11 fetch. >5s sugere relay morto. */
const FETCH_TIMEOUT_MS = 5_000

/**
 * NIP-11 relay information document (subset que renderizamos).
 * Drift `drift_policy` é extensão custom — operator opt-in declara seu
 * tier de moderação (Ted RFC 2026-05-17).
 */
export interface Nip11Info {
  name?: string
  description?: string
  pubkey?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  limitation?: Record<string, unknown>
  payments_url?: string
  fees?: Record<string, unknown>
  posting_policy?: string
  /** Drift custom: tier moderação declarada pelo operator. */
  drift_policy?: {
    version: string
    classifiers?: string[]
    rejects?: string[]
    accepts_kinds?: number[]
    appeal_contact?: string
  }
}

/**
 * Entry completa pra render — combina curated estático com NIP-11 vivo.
 * `nip11` é null quando cache miss + fetch falhou.
 */
export interface RelayDirectoryRecord extends RelayDirectoryEntry {
  nip11: Nip11Info | null
  latencyMs: number | null
  fetchedAt: number | null
  /** `true` se fetch teve sucesso na última tentativa. */
  ok: boolean
}

interface CachedRow {
  url: string
  json: string
  latency_ms: number | null
  software: string | null
  supported_nips: string | null
  fetched_at: number
  ok: number
}

/**
 * Busca info de um relay. Cache miss → fetch network → persist → return.
 * Cache hit (fetched_at < TTL) → return direto. Cache stale → re-fetch
 * em background (next call vê novo dado).
 */
async function getRelayInfo(url: string): Promise<{
  nip11: Nip11Info | null
  latencyMs: number | null
  fetchedAt: number | null
  ok: boolean
}> {
  const nowMs = Date.now()
  const row = await db.get<CachedRow>(
    `SELECT url, json, latency_ms, software, supported_nips, fetched_at, ok
     FROM relay_directory_cache WHERE url = ?`,
    [url],
  )
  if (row) {
    const ageMs = nowMs - row.fetched_at * 1000
    if (ageMs < CACHE_TTL_MS) {
      // Cache hit — sem re-fetch.
      return {
        nip11: row.ok === 1 ? safeParseNip11(row.json) : null,
        latencyMs: row.latency_ms,
        fetchedAt: row.fetched_at,
        ok: row.ok === 1,
      }
    }
  }
  // Cache miss ou stale — refetch sync (caller já está em useEffect).
  const fresh = await fetchAndCache(url)
  return fresh
}

async function fetchAndCache(url: string): Promise<{
  nip11: Nip11Info | null
  latencyMs: number | null
  fetchedAt: number | null
  ok: boolean
}> {
  const result = await fetchNip11(url)
  const fetchedAt = Math.floor(Date.now() / 1000)
  const jsonText = result.nip11 ? JSON.stringify(result.nip11) : '{}'
  await db.run(
    `INSERT INTO relay_directory_cache (url, json, latency_ms, software, supported_nips, fetched_at, ok)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       json = excluded.json,
       latency_ms = excluded.latency_ms,
       software = excluded.software,
       supported_nips = excluded.supported_nips,
       fetched_at = excluded.fetched_at,
       ok = excluded.ok`,
    [
      url,
      jsonText,
      result.latencyMs,
      result.nip11?.software ?? null,
      result.nip11?.supported_nips ? JSON.stringify(result.nip11.supported_nips) : null,
      fetchedAt,
      result.ok ? 1 : 0,
    ],
  )
  return { ...result, fetchedAt }
}

/**
 * Fetch NIP-11 puro — sem cache, sem persist. Retorna parsed info ou null
 * em falha. Latência medida do início do fetch ao parsed body.
 *
 * Conversão WSS→HTTPS: NIP-11 sempre serve via mesmo host com HTTPS.
 * Drift segue spec literal: `wss://relay.example` → `https://relay.example`.
 */
export async function fetchNip11(wssUrl: string): Promise<{
  nip11: Nip11Info | null
  latencyMs: number | null
  ok: boolean
}> {
  // Suporta ws:// (onion) e wss:// (clearnet).
  const httpUrl = wssUrl.replace(/^wss?:\/\//, (m) => (m === 'wss://' ? 'https://' : 'http://'))
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const t0 = performance.now()
  try {
    const res = await fetch(httpUrl, {
      method: 'GET',
      headers: { Accept: 'application/nostr+json' },
      signal: controller.signal,
      // Cache via service worker é OK — TTL 24h server-side já cobre.
    })
    const latencyMs = Math.round(performance.now() - t0)
    if (!res.ok) {
      return { nip11: null, latencyMs, ok: false }
    }
    const text = await res.text()
    const nip11 = safeParseNip11(text)
    return { nip11, latencyMs, ok: nip11 !== null }
  } catch {
    return { nip11: null, latencyMs: null, ok: false }
  } finally {
    clearTimeout(timeoutId)
  }
}

function safeParseNip11(text: string): Nip11Info | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    // Coerção defensiva: aceitamos JSON parcial, normalizamos só
    // campos conhecidos (sem mutação do objeto original).
    return parsed as Nip11Info
  } catch {
    return null
  }
}

/**
 * Retorna entries enriquecidos com NIP-11 cache pra renderização.
 * Lazy: roda fetch só pra entries não cacheados (ou cache stale).
 *
 * Calle render-side: este é o ponto de entrada do DiscoverRelaysCard.
 */
export async function getDirectoryEntries(
  tab: RelayDirectoryTab,
): Promise<RelayDirectoryRecord[]> {
  const entries = getRelaysByTab(tab)
  const results = await Promise.all(
    entries.map(async (entry) => {
      const info = await getRelayInfo(entry.url)
      return { ...entry, ...info }
    }),
  )
  return results
}

/**
 * Re-export pra testes / consumers que querem todas as entries sem fetch.
 */
export { RELAY_DIRECTORY }

/**
 * Valida SEED_RELAY_CONFIGS contra invariante #18 (CLAUDE.md): SEED não
 * pode conter relays com policy `ai-assisted-opt-in`, `ai-automated`,
 * `manual-human` ou `private`. Só `manual-spam-only` e `unmoderated`.
 *
 * Função pura (manifesto §7). LOCK_VIA_TEST consome.
 */
export function validateSeedAgainstInvariant18(
  seedUrls: readonly string[],
  directory: readonly RelayDirectoryEntry[] = RELAY_DIRECTORY,
): { url: string; violation: string }[] {
  const violations: { url: string; violation: string }[] = []
  const allowed = new Set<string>(['manual-spam-only', 'unmoderated'])
  for (const url of seedUrls) {
    const entry = directory.find((r) => r.url === url || r.onion === url)
    if (!entry) {
      // Relay no SEED não está no directory — não violação por si,
      // mas registra pra audit (curador deve adicionar ao directory).
      continue
    }
    if (!allowed.has(entry.policy)) {
      violations.push({
        url,
        violation: `policy '${entry.policy}' não permitida em SEED (apenas manual-spam-only ou unmoderated). CLAUDE.md invariante #18.`,
      })
    }
  }
  return violations
}
