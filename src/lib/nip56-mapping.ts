/**
 * NIP-56 ↔ Drift report reason mapping (puro, testável).
 *
 * NIP-56 define 7 report_type canônicos no `e`/`p` tag index [3].
 * Drift opera com 3 buckets (`ReportReason` em `types/drift.ts`):
 * `illegal | spam | harassment`. Mapping bidirecional documentado +
 * LOCK_VIA_TEST (manifesto §7 determinismo).
 *
 * Spec: github.com/nostr-protocol/nips/blob/master/56.md
 *
 * Deliberação HIMYM 2026-05-17 (Marshall + ratificado por todos):
 *   - Drift `harassment` → NIP-56 `other` (NIP-56 não tem canônico)
 *   - NIP-56 `nudity` → Drift `spam` (Drift cobre nudity via §27
 *     content-warning pipeline, não via report)
 *   - NIP-56 `malware`/`impersonation`/`profanity` mapeados pro
 *     bucket Drift mais conservador
 *   - NIP-56 `other` → Drift `spam` (fallback conservador)
 *
 * Função PURA — sem Date.now, sem db, sem state. Mesmo input → mesmo
 * output, sempre. Test `tests/nip56-mapping.test.ts`.
 */

import type { ReportReason } from '../types/drift'

/** NIP-56 report_type canônicos (spec literal). */
export type Nip56ReportType =
  | 'nudity'
  | 'malware'
  | 'profanity'
  | 'illegal'
  | 'spam'
  | 'impersonation'
  | 'other'

export const NIP56_REPORT_TYPES: readonly Nip56ReportType[] = [
  'nudity',
  'malware',
  'profanity',
  'illegal',
  'spam',
  'impersonation',
  'other',
] as const

/**
 * Drift ReportReason → NIP-56 report_type emit value.
 *
 * Quando o cliente Drift publica kind 1984, o reason original do user
 * (3 buckets) precisa traduzir pro vocabulário NIP-56 (7 valores).
 *
 * Tabela canônica:
 *   illegal     → illegal      (1:1)
 *   spam        → spam         (1:1)
 *   harassment  → other        (NIP-56 sem canônico — fallback honesto)
 */
export function mapDriftToNip56(reason: ReportReason): Nip56ReportType {
  switch (reason) {
    case 'illegal':
      return 'illegal'
    case 'spam':
      return 'spam'
    case 'harassment':
      return 'other'
  }
}

/**
 * NIP-56 report_type ingestão → Drift bucket.
 *
 * Quando Drift ingere kind 1984 emitido por outro cliente (Damus,
 * Snort), o report_type pode ser qualquer um dos 7. Mapping lossy
 * 7 → 3:
 *
 *   illegal       → illegal
 *   malware       → illegal  (malware é crime digital)
 *   spam          → spam
 *   impersonation → spam     (similar — fake identity vector)
 *   profanity     → spam     (Drift não trata profanity como abuse,
 *                              vira spam bucket pra ranking)
 *   nudity        → spam     (Drift cobre nudity via content-warning §27,
 *                              não via report — bucket conservador)
 *   other         → spam     (fallback honesto)
 *
 * Returns `null` se report_type não está no whitelist NIP-56 (input
 * adversarial / cliente custom inventando vocabulário). Caller deve
 * rejeitar.
 */
export function mapNip56ToDrift(reportType: string): ReportReason | null {
  switch (reportType) {
    case 'illegal':
    case 'malware':
      return 'illegal'
    case 'spam':
    case 'impersonation':
    case 'profanity':
    case 'nudity':
    case 'other':
      return 'spam'
    default:
      return null
  }
}

/**
 * Type guard pra report_type vir de fonte não-confiável (parse de evento).
 */
export function isNip56ReportType(v: unknown): v is Nip56ReportType {
  return typeof v === 'string' && (NIP56_REPORT_TYPES as readonly string[]).includes(v)
}
