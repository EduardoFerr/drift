/**
 * Relays públicos gratuitos. A diversidade é proposital — múltiplos países,
 * múltiplos operadores. Bloquear a rede inteira exigiria coordenação
 * jurídica entre jurisdições diferentes.
 *
 * Fase 6.4: cada relay pode ter um alias `.onion` opcional pra modo Tor.
 * Em `NetworkMode='tor'`, `activeReadRelays`/`activeWriteRelays` preferem
 * o `.onion` quando disponível; em `'onion-only'` filtra fora os relays
 * sem `.onion`. Ver `lib/relays.ts`.
 */

/**
 * Configuração de um relay seed.
 * - `url`: WSS clearnet (sempre presente).
 * - `onion`: alias `.onion` opcional (Fase 6.4). Quando undefined, o relay
 *   é clearnet-only — não aparece em modo `onion-only`.
 */
export interface RelayConfig {
  url: string
  onion?: string
}

/**
 * Seed list com configs (clearnet + onion opcional).
 *
 * MVP Fase 6.4: nenhum seed conhecido publica `.onion` oficial ainda;
 * entradas ficam clearnet-only por enquanto. Quando surgirem aliases
 * conhecidos (damus, nos.lol etc. publicam onion via NIP-11), entram aqui.
 * O user pode adicionar relays `.onion` manualmente via Settings (a coluna
 * `onion` em `relays_user` chega na migration v8 — sessão futura).
 */
// nostr.wine removido do seed list (2026-05-08): paid relay — write
// requer assinatura, retorna erro de permissão em cada publishToRelays
// poluindo console + criando ruído de network. User pode adicionar
// manualmente em Settings → relays se tiver assinatura.
export const SEED_RELAY_CONFIGS: readonly RelayConfig[] = [
  { url: 'wss://relay.damus.io' },
  { url: 'wss://nos.lol' },
  { url: 'wss://relay.nostr.band' },
] as const

/**
 * Lista plana de URLs clearnet — mantida pra compat com `lib/relays.ts`
 * (`ensureSeedRelays` e fallback anti-eclipse). Derivada de
 * `SEED_RELAY_CONFIGS` pra evitar duplicação.
 */
export const RELAYS: readonly string[] = SEED_RELAY_CONFIGS.map((r) => r.url)

export type RelayUrl = (typeof RELAYS)[number]
