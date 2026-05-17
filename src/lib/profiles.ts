/**
 * profiles — publish/read de kind 0 (NIP-01 profile metadata).
 *
 * **Manifesto §5.3 + §28 + §17**:
 * - Identificação é OPT-IN: cliente nunca obriga o user a se identificar
 * - 3 modos canônicos: Anônimo (default) / Semi-anônimo (alias) / Identificado (nome+avatar)
 * - "Não podemos impedir as pessoas se identificarem" — direito do user
 * - Mas: cliente cria atrito intencional (banner inline antes do publish,
 *   defaults vazios, copy explícito de que é imutável + público)
 *
 * **Separação de concerns**: kind 0 não é evento Drift (faixa 1..9999).
 * Mora em `profiles.ts` separado de `protocol.ts` (que cobre 9078..9081).
 * Pipeline `onNostrEvent` em `events.ts` aceita kind 0 via dispatch
 * (handler `persistUserMetadata` em LWW), mas o PUBLISH é gerenciado
 * só aqui.
 *
 * **Whitelist estrito**: `buildKind0Payload` aceita só keys em
 * `KIND_0_ALLOWED_KEYS` (LOCK_VIA_TEST). Garante que campos privados
 * (location, GPS, nsec, prefs) jamais vazam em kind 0 — manifesto §28.
 */

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { signDriftEvent, publishToRelays } from './nostr'
import {
  KIND_0_ALLOWED_KEYS,
  type UserMetadataPayload,
  type UserMetadata,
} from '../types/drift'
import type { SignedEvent } from '../types/nostr'
import { db } from './db'

/**
 * Constrói payload válido pra kind 0 content. Filtra chaves fora da
 * whitelist NIP-01 + remove valores vazios (string '' ou whitespace-only).
 *
 * Função pura — testável sem db, sem network.
 *
 * NIP-01 prefer omissão sobre `null` pra campos vazios; respeitamos.
 */
export function buildKind0Payload(
  input: Partial<UserMetadataPayload>,
): UserMetadataPayload {
  const out: UserMetadataPayload = {}
  for (const key of KIND_0_ALLOWED_KEYS) {
    const v = input[key]
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (trimmed.length === 0) continue
    out[key] = trimmed
  }
  return out
}

/**
 * Limites defensivos por campo. Reflete o que UI deve enforcement
 * antes de chamar `publishUserMetadata`. Cap defensivo aqui é segundo
 * gate — UI é primeira linha.
 */
export const PROFILE_LIMITS = {
  name: 32,
  display_name: 32,
  about: 140,
  picture: 512,
  banner: 512,
  website: 512,
  nip05: 128,
  lud16: 128,
} as const

/**
 * Valida limites de comprimento. Retorna lista de violations
 * (campo + razão) ou array vazio se OK.
 */
export function validateProfilePayload(
  payload: UserMetadataPayload,
): { field: string; reason: string }[] {
  const errors: { field: string; reason: string }[] = []
  for (const key of KIND_0_ALLOWED_KEYS) {
    const v = payload[key]
    if (typeof v !== 'string') continue
    const limit = PROFILE_LIMITS[key]
    if (v.length > limit) {
      errors.push({ field: key, reason: `máximo ${limit} caracteres` })
    }
  }
  // picture/banner/website devem ser https://
  for (const key of ['picture', 'banner', 'website'] as const) {
    const v = payload[key]
    if (typeof v === 'string' && v.length > 0 && !v.startsWith('https://')) {
      errors.push({ field: key, reason: 'precisa começar com https://' })
    }
  }
  // nip05 deve ter formato handle@domain
  if (typeof payload.nip05 === 'string' && payload.nip05.length > 0) {
    if (!/^[a-z0-9._-]+@[a-z0-9.-]+$/i.test(payload.nip05)) {
      errors.push({ field: 'nip05', reason: 'formato handle@domain' })
    }
  }
  return errors
}

/**
 * Publica kind 0 NIP-01 com payload validado. Cliente local recebe
 * de volta via `onNostrEvent` → `persistUserMetadata` (LWW).
 *
 * **CRÍTICO**: chamador deve ter mostrado o banner inline §28 + §5.3
 * antes de invocar. Publish é imutável no Nostr; não há undo (apenas
 * `resetProfile` que publica content vazio sobrescrevendo via LWW).
 */
export async function publishUserMetadata(
  payload: UserMetadataPayload,
): Promise<SignedEvent> {
  const safe = buildKind0Payload(payload)
  const event = await signDriftEvent({
    kind: 0,
    tags: [],
    content: JSON.stringify(safe),
  })
  await publishToRelays(event)
  // Local ingest — não esperamos round-trip do relay. onNostrEvent é
  // idempotente (LWW); se relay devolver, será no-op.
  const { onNostrEvent } = await import('./events')
  await onNostrEvent(event)
  return event
}

/**
 * Reset de profile: publica kind 0 com content vazio `{}`.
 * LWW na ingestão sobrescreve metadata anterior — user "volta" pro
 * modo Anônimo (§5.3).
 *
 * Não há "delete" no Nostr — o evento original existe pra sempre. Mas
 * clientes que respeitam LWW (Drift, Damus, Snort, etc.) consideram
 * o último kind 0 como autoritativo, então `{}` efetivamente esconde
 * o perfil anterior.
 */
export async function resetUserMetadata(): Promise<SignedEvent> {
  const event = await signDriftEvent({
    kind: 0,
    tags: [],
    content: JSON.stringify({}),
  })
  await publishToRelays(event)
  const { onNostrEvent } = await import('./events')
  await onNostrEvent(event)
  return event
}

interface UserMetadataRow {
  npub: string
  name: string | null
  display_name: string | null
  about: string | null
  picture: string | null
  banner: string | null
  website: string | null
  nip05: string | null
  lud16: string | null
  event_created_at: number
}

/**
 * Lê metadata local de um npub. Retorna `null` se nunca recebido kind 0
 * pra esse npub. Resultado é cache + LWW da ingestão; UI deve tratar
 * `null` como "modo Anônimo".
 */
export async function getUserMetadata(npub: string): Promise<UserMetadata | null> {
  const row = await db.get<UserMetadataRow>(
    `SELECT npub, name, display_name, about, picture, banner, website, nip05, lud16, event_created_at
     FROM users_metadata
     WHERE npub = ?`,
    [npub],
  )
  if (!row) return null
  return {
    npub: row.npub,
    name: row.name,
    displayName: row.display_name,
    about: row.about,
    picture: row.picture,
    banner: row.banner,
    website: row.website,
    nip05: row.nip05,
    lud16: row.lud16,
    eventCreatedAt: row.event_created_at,
  }
}

// ─── Store + hook reativo ────────────────────────────────────────────

/**
 * Bump simples — `events.ts:persistUserMetadata` chama `bumpMetadata(npub)`
 * após ingestão LWW. Hook `useUserMetadata` re-query quando a versão muda
 * pra esse npub.
 *
 * Por que não um cache no store? Metadata muda raramente; re-query
 * direto da tabela mantém um source-of-truth (SQLite) e evita
 * dessincronização entre cache em memória + tabela.
 */
interface ProfileBumpState {
  /** Map<npub, version>. Increment a cada `persistUserMetadata`. */
  versions: Map<string, number>
}

export const useProfileBumpStore = create<ProfileBumpState>(() => ({
  versions: new Map(),
}))

export function bumpProfileVersion(npub: string): void {
  useProfileBumpStore.setState((s) => {
    const next = new Map(s.versions)
    next.set(npub, (next.get(npub) ?? 0) + 1)
    return { versions: next }
  })
}

/**
 * Hook reativo — busca metadata local e re-query quando o npub recebe
 * novo kind 0 (via `bumpProfileVersion`).
 *
 * Retorna `null` enquanto carrega OU se nunca houve kind 0 pra esse
 * npub. Caller deve tratar `null` como modo Anônimo.
 */
export function useUserMetadata(npub: string | null): UserMetadata | null {
  const [data, setData] = useState<UserMetadata | null>(null)
  const version = useProfileBumpStore((s) =>
    npub ? (s.versions.get(npub) ?? 0) : 0,
  )
  useEffect(() => {
    if (!npub) {
      setData(null)
      return
    }
    let cancelled = false
    void getUserMetadata(npub).then((m) => {
      if (!cancelled) setData(m)
    })
    return () => {
      cancelled = true
    }
  }, [npub, version])
  return data
}
