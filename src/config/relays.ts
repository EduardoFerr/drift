/**
 * Relays públicos gratuitos. A diversidade é proposital — múltiplos países,
 * múltiplos operadores. Bloquear a rede inteira exigiria coordenação
 * jurídica entre jurisdições diferentes.
 */
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
] as const

export type RelayUrl = (typeof RELAYS)[number]
