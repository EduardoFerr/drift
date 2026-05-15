/**
 * nostr-dm — NIP-44 v2 DM encryption helpers. Extraído de `lib/nostr.ts`
 * em V9.33 (Lighthouse "reduce unused JS" follow-up): `nip44` traz
 * ChaCha20-Poly1305 do @noble/ciphers (~15-20 KB raw), e SÓ é usado
 * por `transport/webrtc-signaling-nostr` (Fase 6.1b). Quando vivia em
 * `nostr.ts` (eager), o bundle entrada arrastava esse código mesmo
 * sem WebRTC ativo. Aqui em arquivo separado, o tree-shaker move o
 * nip44 pro chunk WebRTC (lazy).
 *
 * API mantém sync — webrtc-signaling chama dentro de hot paths que
 * preferem evitar await por handshake.
 */

// V9.33: nip44 (ChaCha20-Poly1305 → @noble/ciphers) usado só por
// WebRTC signaling (Fase 6.1b, lazy). Vivia em nostr.ts (eager); aqui
// em arquivo separado, tree-shaking via importação dedicada ajuda
// Rollup a deixar fora do entry chunk.
import { nip44 } from 'nostr-tools'

const { encrypt, decrypt, getConversationKey } = nip44

/**
 * Cifra plaintext via NIP-44 v2 pro pubkey do peer destinatário.
 *
 * Usa `getConversationKey(senderNsecBytes, recipientNpubHex)` pra
 * derivar a chave HKDF/ECDH compartilhada e `encrypt` pra produzir
 * o payload base64 (versioned, AEAD, padded).
 */
export function encryptDM(
  plain: string,
  peerNpubHex: string,
  senderNsecBytes: Uint8Array,
): string {
  const key = getConversationKey(senderNsecBytes, peerNpubHex)
  return encrypt(plain, key)
}

/**
 * Decifra payload NIP-44 v2 vindo de `event.content`.
 *
 * Lança se cifra inválida — caller deve catchar e dar drop silencioso
 * (manifesto §11 — eventos inválidos são ruído, não exceção).
 */
export function decryptDM(
  payload: string,
  peerNpubHex: string,
  recipientNsecBytes: Uint8Array,
): string {
  const key = getConversationKey(recipientNsecBytes, peerNpubHex)
  return decrypt(payload, key)
}
