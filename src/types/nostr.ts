/**
 * Re-exports dos tipos Nostr que usamos. Centralizar aqui evita
 * espalhar imports do nostr-tools por toda a base.
 */

export type { Event as SignedEvent } from 'nostr-tools'
