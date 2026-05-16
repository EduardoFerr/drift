/**
 * webrtc/peerLink — build/parse peer URIs + QR generation.
 *
 * Funções puras pra pairing P2P. Usa NIP-19 nprofile (pubkey + relay
 * hints num único bech32) — formato standard Nostr, sem URI custom.
 *
 * QR code contém o nprofile raw (compacto); link direto usa
 * `?peer=nprofile1...` na URL do app.
 *
 * Manifesto §28 (privacidade): npub é público por design; relay hints
 * são NIP-65 públicos. Nenhum dado novo exposto.
 */

import { nip19 } from 'nostr-tools'

export interface PeerLinkData {
  npubHex: string
  relayHints: string[]
}

/**
 * Codifica pubkey hex + relay hints em nprofile bech32 (NIP-19).
 * Se não tem relay hints, retorna npub1... simples.
 */
export function encodePeerLink(pubkeyHex: string, relayHints?: string[]): string {
  if (relayHints && relayHints.length > 0) {
    return nip19.nprofileEncode({ pubkey: pubkeyHex, relays: relayHints })
  }
  return nip19.npubEncode(pubkeyHex)
}

/**
 * Decodifica npub1.../nprofile1... em pubkey hex + relay hints.
 * Retorna null se malformado ou tipo inesperado.
 */
export function decodePeerLink(encoded: string): PeerLinkData | null {
  try {
    const decoded = nip19.decode(encoded)
    if (decoded.type === 'npub') {
      return { npubHex: decoded.data, relayHints: [] }
    }
    if (decoded.type === 'nprofile') {
      return {
        npubHex: decoded.data.pubkey,
        relayHints: decoded.data.relays ?? [],
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Constrói URL completa com `?peer=` param. Usa origin atual ou
 * fallback pra URL canônica.
 */
export function buildPeerURL(pubkeyHex: string, relayHints?: string[]): string {
  const encoded = encodePeerLink(pubkeyHex, relayHints)
  const base =
    typeof window !== 'undefined'
      ? window.location.origin + window.location.pathname
      : 'https://drift.social/'
  return `${base}?peer=${encoded}`
}

/**
 * Gera data URL (PNG) do QR code com o nprofile/npub.
 * Conteúdo do QR é o nprofile raw (compacto, ~60 chars), não a URL
 * inteira — mantém QR legível mesmo em tamanho pequeno.
 */
export async function generatePeerQR(
  pubkeyHex: string,
  relayHints?: string[],
): Promise<string> {
  const QRCode = await import('qrcode/lib/browser')
  const encoded = encodePeerLink(pubkeyHex, relayHints)
  return QRCode.toDataURL(encoded, {
    width: 240,
    margin: 2,
    color: { dark: '#e8ff00', light: '#000000' },
  })
}
