/**
 * BIP39 + NIP-06 — derivar identidade Nostr a partir de 12 palavras.
 *
 * Manifesto §3 (Identidade Portável; Dispositivo Descartável).
 *
 * NIP-06 define como derivar uma chave secp256k1 (nsec) a partir de
 * uma seed BIP39 padrão:
 *
 *   1. mnemonic → entropy (BIP39)
 *   2. entropy + passphrase → seed (PBKDF2 com 2048 iterações)
 *   3. seed → master key BIP32
 *   4. derivar com path m/44'/1237'/0'/0/0 → private key (32 bytes)
 *
 * Vantagem vs nsec1 puro: 12 palavras é mais legível/decorável que
 * "nsec1xy0z...067fs". UX melhor pra backup em papel.
 *
 * Compatibilidade: identidades geradas por NIP-06 funcionam em todos
 * os clientes Nostr que suportam (Damus, Snort, Coracle, Iris, Amethyst).
 *
 * **Trade-off honesto:** BIP39 + PBKDF2 é mais lento que gerar nsec
 * direto (uma vez, ~2s). Por isso só é opt-in — default continua
 * sendo nsec via `generateSecretKey()` (cripto-secure direto).
 */

import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

/** Path NIP-06 padrão. */
const NIP06_PATH = "m/44'/1237'/0'/0/0"

/**
 * Gera uma nova mnemonic BIP39 (12 palavras, 128 bits de entropia).
 * 12 é suficiente — mais que isso é teatro (2^128 já é absurdamente seguro).
 */
export function generateBip39Mnemonic(): string {
  return generateMnemonic(wordlist, 128)
}

/**
 * Valida que uma frase de 12/15/18/21/24 palavras é uma mnemonic
 * BIP39 bem-formada (palavras na wordlist, checksum correto).
 */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim().toLowerCase(), wordlist)
}

/**
 * Deriva nsec (private key) + npub a partir de uma mnemonic BIP39.
 * NIP-06 path padrão. Passphrase opcional adiciona camada extra
 * (manifesto §3: ver `Privacidade Opcional` nas seções de identidade).
 *
 * @param mnemonic - 12-24 palavras BIP39
 * @param passphrase - Opcional. Se omitido, vazio (default NIP-06).
 * @returns { nsecHex, nsecBytes, npubHex, nsecBech32, npubBech32 }
 * @throws Se a mnemonic for inválida.
 */
export async function deriveNostrKeyFromMnemonic(
  mnemonic: string,
  passphrase = '',
): Promise<{
  nsecHex: string
  nsecBytes: Uint8Array
  npubHex: string
  nsecBech32: string
  npubBech32: string
}> {
  const trimmed = mnemonic.trim().toLowerCase()
  if (!isValidMnemonic(trimmed)) {
    throw new Error('Mnemonic BIP39 inválida (checksum ou palavra fora da wordlist)')
  }

  const seed = await mnemonicToSeed(trimmed, passphrase)
  const root = HDKey.fromMasterSeed(seed)
  const child = root.derive(NIP06_PATH)
  const nsecBytes = child.privateKey
  if (!nsecBytes || nsecBytes.length !== 32) {
    throw new Error('Falha na derivação BIP32 — chave inválida')
  }

  const npubHex = getPublicKey(nsecBytes)
  const nsecHex = bytesToHex(nsecBytes)
  return {
    nsecHex,
    nsecBytes,
    npubHex,
    nsecBech32: nip19.nsecEncode(nsecBytes),
    npubBech32: nip19.npubEncode(npubHex),
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}
