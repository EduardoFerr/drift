/**
 * Relay directory — fonte de descoberta de relays, separada do SEED.
 *
 * **Manifesto §17 adendo + CLAUDE invariante #18:** SEED_RELAY_CONFIGS
 * (`config/relays.ts`) só contém relays neutros ou anti-spam-only.
 * Discovery UX (Settings > Relays > Descobrir) consome ESTE directory
 * pra mostrar opções moderadas e free-speech como opt-in.
 *
 * Source: `Docs/curated-relays-YYYY-MM.json` (snapshot mensal versionado
 * em git, auditado manualmente). Aqui apenas re-tipamos pra TypeScript.
 *
 * NIP-11 fetch dinâmico em `lib/relay-directory.ts` complementa este
 * estático com latência, supported_nips, software, etc.
 */

import curatedJson from '../../Docs/curated-relays-2026-05.json'

/**
 * Categoria visual pra Discovery UX. Em ordem de apresentação:
 *  - `curated`   → recomendados Drift (neutros, alto volume)
 *  - `moderated` → AI moderation opt-in (precedente: Tagr Bot)
 *  - `free`      → sem moderação ativa (paranoid tier)
 *  - `community` → NIP-29 groups
 *  - `onion`     → Tor hidden service (`network_mode=tor`)
 *
 * NOTA: `moderated` substitui o nome `family-friendly` original.
 * Razão: "family-friendly" tem décadas de uso como dog whistle
 * (Barney threat model 2026-05-17). "Moderated" é descritivo, sem
 * carga.
 */
export type RelayDirectoryTab =
  | 'curated'
  | 'moderated'
  | 'free'
  | 'community'
  | 'onion'

/**
 * Tier de política de moderação. Declarado pelo curador ou parsed
 * de NIP-11 `drift_policy` (extensão custom Ted RFC).
 *
 *  - `manual-spam-only` → rate limit técnico padrão NIP, sem AI scan
 *  - `unmoderated`      → sem rejeição de conteúdo declarada
 *  - `ai-assisted-opt-in` → labels NIP-56 via bot que user opta seguir
 *  - `ai-automated`     → reject server-side por classificador (red flag —
 *                          documentar audit do modelo)
 *  - `manual-human`     → mod humano revisa (raro, normalmente community)
 *  - `private`          → membership/whitelist (NIP-29 ou NIP-42)
 */
export type RelayPolicy =
  | 'manual-spam-only'
  | 'unmoderated'
  | 'ai-assisted-opt-in'
  | 'ai-automated'
  | 'manual-human'
  | 'private'

/**
 * Entry curado pra Discovery. Imutável após import — não mutar em runtime.
 */
export interface RelayDirectoryEntry {
  /** WSS clearnet URL canônica (sempre presente). */
  url: string
  /** Alias `.onion` opcional. Usado em `network_mode=tor`. */
  onion?: string
  /** Tab onde aparece no Discovery UX. */
  tab: RelayDirectoryTab
  /** Tier de moderação declarada. Renderiza badge tier na UI. */
  policy: RelayPolicy
  /** Descrição 1-linha da política. Texto livre, user-facing. */
  policyDetail: string
  /** Custo. `'free'` pra curated MVP (sem pagos por constraint do user). */
  cost: 'free'
  /** Nota opcional sobre operator (ex: "Operado por X, OpenSats funded"). */
  trustNote?: string
  /** URL pra audit/source do operator/política. */
  source?: string
}

interface RelayDirectoryMeta {
  version: string
  lastAuditedAt: string
  curator: string
  rationale: string
  tabs: Record<RelayDirectoryTab, string>
  relays: RelayDirectoryEntry[]
  excluded?: { rationale: string; list: Array<{ url: string; reason: string }> }
}

// Type assertion — o JSON é validado em build pelo schema implícito (tsc
// confere shape no acesso). Conformance test garante values válidos
// (tab/policy enum, URL pattern).
const META = curatedJson as RelayDirectoryMeta

export const DIRECTORY_VERSION = META.version
export const DIRECTORY_AUDITED_AT = META.lastAuditedAt
export const DIRECTORY_RATIONALE = META.rationale
export const DIRECTORY_TAB_LABELS = META.tabs
export const RELAY_DIRECTORY: readonly RelayDirectoryEntry[] = META.relays

/**
 * Helper pra filtrar entries por tab. Sem allocation extra — readonly
 * filter sobre o array imutável.
 */
export function getRelaysByTab(tab: RelayDirectoryTab): RelayDirectoryEntry[] {
  return RELAY_DIRECTORY.filter((r) => r.tab === tab)
}

/**
 * Lookup por URL. Retorna `null` se URL não está no directory.
 * URLs duplicadas (clearnet + onion pra mesmo relay) podem retornar
 * a primeira match — não-determinístico se o caller depende disso.
 */
export function findRelayByUrl(url: string): RelayDirectoryEntry | null {
  return RELAY_DIRECTORY.find((r) => r.url === url || r.onion === url) ?? null
}
