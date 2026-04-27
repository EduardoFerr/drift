/**
 * Identidade Nostr do usuário.
 *
 * Gerada localmente via secp256k1, salva criptografada no SQLite.
 * O nsec NUNCA é transmitido pela rede e NUNCA é persistido em claro.
 *
 * Cache em memória para a sessão atual — evita decifrar a cada
 * assinatura de evento.
 *
 * Recovery: se o nsec_encrypted no SQLite não puder ser decifrado
 * (master key dessincronizada — IndexedDB e OPFS estão em buckets
 * separados do browser e podem ficar fora de sincronia em casos
 * raros), a identidade local é resetada. Isto perde o npub atual.
 *
 * Portabilidade (§30.8): identidade é o nsec1, não o device.
 *  - exportIdentity() — para mostrar nsec1 ao usuário (backup, QR)
 *  - setIdentityFromNsec() — para importar identidade existente
 *  - resetIdentity() — destrutivo, só após confirmação explícita
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { db } from './db'
import { encrypt, decrypt, resetMasterKey } from './crypto'
import type { DriftIdentity } from '../types/drift'

let cached: DriftIdentity | null = null

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex string')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function nsecHexToBytes(hex: string): Uint8Array {
  return hexToBytes(hex)
}

interface IdentityRow {
  npub: string
  nsec_encrypted: string
  created_at: number
}

export async function getOrCreateIdentity(): Promise<DriftIdentity> {
  if (cached) return cached

  const existing = await db.get<IdentityRow>(
    `SELECT npub, nsec_encrypted, created_at FROM identity LIMIT 1`,
  )

  if (existing) {
    try {
      const nsecHex = await decrypt(existing.nsec_encrypted)
      const nsecBytes = hexToBytes(nsecHex)
      cached = {
        nsec: nsecHex,
        npub: existing.npub,
        nsecBech32: nip19.nsecEncode(nsecBytes),
        npubBech32: nip19.npubEncode(existing.npub),
        createdAt: existing.created_at,
      }
      return cached
    } catch (err) {
      console.warn(
        '[identity] decrypt da identidade existente falhou — gerando nova identidade. Erro:',
        err,
      )
      await resetIdentity()
      // cai pro fluxo de criação abaixo
    }
  }

  return createNewIdentity()
}

async function createNewIdentity(): Promise<DriftIdentity> {
  const nsecBytes = generateSecretKey()
  const npub = getPublicKey(nsecBytes)
  const nsecHex = bytesToHex(nsecBytes)
  return persistIdentity(nsecBytes, nsecHex, npub)
}

async function persistIdentity(
  nsecBytes: Uint8Array,
  nsecHex: string,
  npub: string,
): Promise<DriftIdentity> {
  const createdAt = Date.now()

  await db.run(
    `INSERT INTO identity (npub, nsec_encrypted, created_at) VALUES (?, ?, ?)`,
    [npub, await encrypt(nsecHex), createdAt],
  )

  cached = {
    nsec: nsecHex,
    npub,
    nsecBech32: nip19.nsecEncode(nsecBytes),
    npubBech32: nip19.npubEncode(npub),
    createdAt,
  }
  return cached
}

// ─── Portabilidade ───────────────────────────────────────────────────

/**
 * Retorna a identidade atual em formato bech32 (nsec1.../npub1...) para
 * backup/exibição. Disponível porque o nsec NÃO é segredo do sistema —
 * é segredo do usuário, e o usuário precisa ter acesso a ele.
 */
export async function exportIdentity(): Promise<DriftIdentity> {
  return getOrCreateIdentity()
}

/**
 * Substitui a identidade local por uma fornecida via nsec1...
 *
 * Destrutivo: a identidade anterior é apagada do dispositivo. Não
 * remove os posts/spreads/buries que o usuário antigo havia publicado
 * na rede Nostr — esses ficam lá, mas deixam de ser "seus" no app.
 *
 * Lança erro se o nsec1 for inválido. Após sucesso, chame
 * `rebuildIdentityHistory(npub)` em sync.ts para puxar o histórico
 * desta identidade da rede.
 */
export async function setIdentityFromNsec(nsec1: string): Promise<DriftIdentity> {
  const trimmed = nsec1.trim()
  if (!trimmed.startsWith('nsec1')) {
    throw new Error('Chave inválida: precisa começar com nsec1')
  }

  let decoded: ReturnType<typeof nip19.decode>
  try {
    decoded = nip19.decode(trimmed)
  } catch {
    throw new Error('Chave inválida: formato bech32 corrompido')
  }
  if (decoded.type !== 'nsec') {
    throw new Error(`Chave inválida: tipo ${decoded.type}, esperado nsec`)
  }
  const nsecBytes = decoded.data as Uint8Array
  if (nsecBytes.length !== 32) {
    throw new Error(`Chave inválida: ${nsecBytes.length} bytes, esperado 32`)
  }

  const npub = getPublicKey(nsecBytes)
  const nsecHex = bytesToHex(nsecBytes)

  // Apaga identidade atual (e a master key — daí o encrypt abaixo gera
  // uma nova master key + reencripta o nsec importado com ela).
  await resetIdentity()
  return persistIdentity(nsecBytes, nsecHex, npub)
}

/**
 * Apaga identidade local — row no SQLite + master key no IndexedDB.
 * Próxima chamada a getOrCreateIdentity vai gerar identidade nova.
 *
 * Destrutivo: o npub é perdido. Em produção, exportar nsec para
 * backup antes de chamar isto.
 */
export async function resetIdentity(): Promise<void> {
  cached = null
  await db.run(`DELETE FROM identity`)
  await resetMasterKey()
}

export async function getCurrentNpub(): Promise<string | null> {
  try {
    const id = await getOrCreateIdentity()
    return id.npub
  } catch {
    return null
  }
}

/** Para testes — limpa cache. NÃO apaga a identidade do banco. */
export function clearIdentityCache(): void {
  cached = null
}
