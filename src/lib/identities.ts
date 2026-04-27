/**
 * Multi-identidade — manifesto §4 (Anonimato por Design).
 *
 * Usuário pode ter N identidades simultâneas no mesmo dispositivo.
 * Útil pra anti-perseguição (uma identidade pública, outra para tópicos
 * sensíveis), e pra compartimentalizar contextos.
 *
 * Modelo:
 *  - Tabela `identities` (plural) — todas as identidades conhecidas
 *    pelo cliente. Cada uma com nsec encriptado + label opcional.
 *  - `user_prefs.active_identity` — npub da identidade ativa atual.
 *  - `lib/identity.ts` (singular) — proxy pra identidade ATIVA. As
 *    funções `getOrCreateIdentity`, `signDriftEvent` etc. continuam
 *    falando "a identidade", e essa é determinada por `active_identity`.
 *
 * Trocar identidade ativa:
 *   1. UI confirma com user (ação destrutiva pra estado local — feed
 *      muda completamente)
 *   2. UI oferece export do nsec atual antes (regra dura, manifesto §3)
 *   3. `setActiveIdentity(npub)` atualiza `user_prefs`
 *   4. `clearIdentityCache()` em identity.ts pra forçar reload
 *   5. `location.reload()` — sync e feed reconstroem
 *
 * Por que reload? Porque store reativa do feed e sync subscribe foram
 * configurados na boot pra a identidade anterior. Reset clean é mais
 * seguro que reconciliar tudo em runtime — manifesto §3 aceita perder
 * estado local; o que não pode é perder identidade.
 */

import { create } from 'zustand'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { db } from './db'
import { encrypt } from './crypto'

// ─── Tipos ───────────────────────────────────────────────────────────

export interface IdentityRecord {
  npub: string
  npubBech32: string
  label: string | null
  createdAt: number
  imported: boolean
}

interface IdentityRow {
  npub: string
  label: string | null
  created_at: number
  imported: number
}

function rowToRecord(r: IdentityRow): IdentityRecord {
  return {
    npub: r.npub,
    npubBech32: nip19.npubEncode(r.npub),
    label: r.label,
    createdAt: r.created_at,
    imported: r.imported !== 0,
  }
}

// ─── Store reativa ───────────────────────────────────────────────────

interface IdentitiesState {
  list: IdentityRecord[]
  activeNpub: string | null
  loaded: boolean
}

export const useIdentitiesStore = create<IdentitiesState>(() => ({
  list: [],
  activeNpub: null,
  loaded: false,
}))

// ─── Carregamento ────────────────────────────────────────────────────

let initialized = false

/**
 * Carrega lista de identidades + ativa atual. Idempotente.
 *
 * Chamado em `bootstrap.ts` após `loadPrefs` — depende de `user_prefs`
 * pra saber qual identidade está ativa.
 */
export async function loadIdentities(): Promise<void> {
  if (initialized) return
  initialized = true
  await refresh()
}

async function refresh(): Promise<void> {
  const rows = await db.exec<IdentityRow>(
    `SELECT npub, label, created_at, imported FROM identities
     ORDER BY created_at ASC`,
  )
  const list = rows.map(rowToRecord)

  const activeRow = await db.get<{ value: string }>(
    `SELECT value FROM user_prefs WHERE key = 'active_identity'`,
  )
  const activeNpub = activeRow?.value ?? null

  useIdentitiesStore.setState({ list, activeNpub, loaded: true })
}

// ─── CRUD ────────────────────────────────────────────────────────────

/**
 * Cria nova identidade (gera nsec local) e adiciona à lista.
 * NÃO troca a ativa — chamador faz isso explicitamente se quiser.
 *
 * @param label - Etiqueta opcional pra distinguir identidades (ex: "ativismo")
 * @returns Record da nova identidade (sem o nsec — sigiloso)
 */
export async function createNewIdentity(label?: string): Promise<IdentityRecord> {
  const nsecBytes = generateSecretKey()
  const npub = getPublicKey(nsecBytes)
  const nsecHex = bytesToHex(nsecBytes)
  const createdAt = Date.now()

  await db.run(
    `INSERT INTO identities (npub, label, nsec_encrypted, created_at, imported)
     VALUES (?, ?, ?, ?, 0)`,
    [npub, label ?? null, await encrypt(nsecHex), createdAt],
  )
  await refresh()
  return {
    npub,
    npubBech32: nip19.npubEncode(npub),
    label: label ?? null,
    createdAt,
    imported: false,
  }
}

/**
 * Adiciona identidade existente via nsec1 importado.
 *
 * Não troca a ativa. Chamador chama `setActiveIdentity` se quiser.
 */
export async function importIdentityNsec(nsec1: string, label?: string): Promise<IdentityRecord> {
  const trimmed = nsec1.trim()
  if (!trimmed.startsWith('nsec1')) {
    throw new Error('Chave inválida: precisa começar com nsec1')
  }
  let decoded: ReturnType<typeof nip19.decode>
  try {
    decoded = nip19.decode(trimmed)
  } catch {
    throw new Error('Chave inválida: bech32 corrompido')
  }
  if (decoded.type !== 'nsec') {
    throw new Error(`Tipo errado: ${decoded.type} (esperado nsec)`)
  }
  const nsecBytes = decoded.data as Uint8Array
  if (nsecBytes.length !== 32) {
    throw new Error(`Tamanho errado: ${nsecBytes.length} bytes`)
  }

  const npub = getPublicKey(nsecBytes)
  const nsecHex = bytesToHex(nsecBytes)
  const createdAt = Date.now()

  // Idempotente: se já existe, atualiza label.
  await db.run(
    `INSERT INTO identities (npub, label, nsec_encrypted, created_at, imported)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(npub) DO UPDATE SET label = COALESCE(excluded.label, label)`,
    [npub, label ?? null, await encrypt(nsecHex), createdAt],
  )
  await refresh()
  return {
    npub,
    npubBech32: nip19.npubEncode(npub),
    label: label ?? null,
    createdAt,
    imported: true,
  }
}

/**
 * Define a identidade ativa. Trocar identidade é destrutivo pro
 * estado local em RAM — chamador deve fazer `location.reload()` em
 * seguida pra reset clean.
 *
 * Atualiza tanto `user_prefs.active_identity` (multi-identity) quanto
 * a tabela legacy `identity` (singular) — código legado em `identity.ts`
 * lê dela. Sync.
 */
export async function setActiveIdentity(npub: string): Promise<void> {
  const row = await db.get<{ nsec_encrypted: string; created_at: number }>(
    `SELECT nsec_encrypted, created_at FROM identities WHERE npub = ?`,
    [npub],
  )
  if (!row) throw new Error(`Identidade ${npub.slice(0, 12)}... não existe`)

  // user_prefs.active_identity
  await db.run(
    `INSERT INTO user_prefs (key, value) VALUES ('active_identity', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [npub],
  )

  // Sincroniza tabela legacy `identity` (singular) — `identity.ts` lê
  // dela pra getOrCreateIdentity. Substitui pela ativa.
  await db.run(`DELETE FROM identity`)
  await db.run(
    `INSERT INTO identity (npub, nsec_encrypted, created_at) VALUES (?, ?, ?)`,
    [npub, row.nsec_encrypted, row.created_at],
  )

  await refresh()
}

/**
 * Atualiza a label de uma identidade. Não-destrutivo.
 */
export async function renameIdentity(npub: string, label: string | null): Promise<void> {
  await db.run(
    `UPDATE identities SET label = ? WHERE npub = ?`,
    [label, npub],
  )
  await refresh()
}

/**
 * Remove identidade da lista. **Destrutivo** — perde o nsec encriptado
 * pra essa identidade no device. Chamador é responsável por:
 *   1. Oferecer export do nsec ANTES (regra dura, manifesto §3)
 *   2. Não permitir remover a identidade ativa atual sem trocar antes
 *
 * Não toca em `identity` (singular) — se for a ativa, o caller já deve
 * ter trocado a ativa antes.
 */
export async function removeIdentity(npub: string): Promise<void> {
  const active = useIdentitiesStore.getState().activeNpub
  if (active === npub) {
    throw new Error('Não pode remover a identidade ativa — troque a ativa primeiro')
  }
  await db.run(`DELETE FROM identities WHERE npub = ?`, [npub])
  await refresh()
}

// ─── Helpers ─────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}
