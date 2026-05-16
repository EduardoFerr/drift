/**
 * deep-link — parsing puro de query params da URL de boot.
 *
 * Drift expõe 3 entradas de deep-link na URL:
 *   - `?action=compose`  → manifest PWA shortcut (long-press no ícone)
 *   - `?action=settings` → manifest PWA shortcut
 *   - `?p=<nevent>`      → share post (V9.20). nevent codifica
 *                          event id + author + kind via nip19.
 *
 * Função pura — recebe string da query, decodifica nevent quando
 * presente, devolve o que o App.tsx precisa pra reagir. Side effects
 * (setState, network) ficam no chamador. Testável sem mock de window.
 */

import * as nip19 from 'nostr-tools/nip19'

export type DeepLinkAction = 'compose' | 'settings' | null

export interface PeerLinkData {
  npubHex: string
  relayHints: string[]
}

export interface DeepLinkParse {
  action: DeepLinkAction
  /**
   * Hex 64-char event id decodificado do `?p=<nevent>`. `null` quando:
   *   - param ausente
   *   - decode lança (string malformada)
   *   - decoded.type !== 'nevent' (ex.: npub1, note1, nprofile1)
   */
  postEventId: string | null
  /** Relay hints encoded no nevent (NIP-19). Recipient consulta esses
   *  relays primeiro — resolve posts antigos que os relays locais
   *  podem ter evictado. */
  relayHints: string[]
  /**
   * Peer pairing data decodificado do `?peer=<nprofile|npub>`. `null`
   * quando param ausente ou decode falha. Fase 6 P2P discovery:
   * interstitial deve confirmar antes de chamar connectTo().
   */
  peerLink: PeerLinkData | null
}

/**
 * `search` = string do query (`?foo=bar`), igual ao `window.location.search`.
 * String vazia ou sem params → todos os campos null.
 */
export function parseDeepLinkSearch(search: string): DeepLinkParse {
  const params = new URLSearchParams(search)
  const rawAction = params.get('action')
  const action: DeepLinkAction =
    rawAction === 'compose' || rawAction === 'settings' ? rawAction : null

  const pParam = params.get('p')
  let postEventId: string | null = null
  let relayHints: string[] = []
  if (pParam) {
    try {
      const decoded = nip19.decode(pParam)
      if (decoded.type === 'nevent') {
        postEventId = decoded.data.id
        relayHints = decoded.data.relays ?? []
      }
    } catch {
      // String malformada — silenciosamente null. App.tsx loga.
    }
  }

  const peerParam = params.get('peer')
  let peerLink: PeerLinkData | null = null
  if (peerParam) {
    try {
      const decoded = nip19.decode(peerParam)
      if (decoded.type === 'npub') {
        peerLink = { npubHex: decoded.data, relayHints: [] }
      } else if (decoded.type === 'nprofile') {
        peerLink = {
          npubHex: decoded.data.pubkey,
          relayHints: decoded.data.relays ?? [],
        }
      }
    } catch {
      // String malformada — silenciosamente null.
    }
  }

  return { action, postEventId, relayHints, peerLink }
}

/**
 * Limpa `action` + `p` da URL atual via `history.replaceState`. Útil
 * pra evitar re-trigger num refresh (manifest action ou deep link).
 * Side effect — mantém fora do helper puro.
 */
export function cleanDeepLinkParams(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('action')
  url.searchParams.delete('p')
  url.searchParams.delete('peer')
  window.history.replaceState({}, '', url.toString())
}
