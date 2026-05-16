/**
 * Gateways IPFS HTTPS para fallback de fetch quando Helia local não tem
 * o CID e não consegue resolver via libp2p (peer isolado, browser sem
 * WebRTC, etc).
 *
 * **Critério de inclusão** (RFC blob-distribution.md §11.5):
 *   1. TLS válido (HTTPS obrigatório)
 *   2. Declaração pública de não-logging ou TOS razoável
 *   3. Suporte a `https://<gateway>/ipfs/<CID>` path resolution
 *   4. Mirror `.onion` quando disponível (futuro — `network_mode=tor`)
 *
 * **Failover:** cliente tenta gateways na ordem listada com timeout
 * curto (5s). Falha de um → tenta próximo. Lista intencionalmente
 * curta — gateway flakiness compensa-se em rotação rápida, não em
 * depth.
 *
 * **Opt-out:** users podem editar via UserPrefs em B.3 UI; cliente
 * fail-safe pra HTTP url da tag `imeta` se TODOS gateways falham.
 *
 * **Privacidade:** fetcher expõe IP + CID pro gateway. Em modo
 * `network_mode=tor` (Fase 6.4), gateways são roteados via SOCKS5
 * arti — IP do user invisível pro gateway. Em `onion-only`, lista
 * é restrita a mirrors `.onion` (vide RFC §9.2).
 */

export interface IpfsGateway {
  /** URL base, sem path. Ex: `https://cf-ipfs.com`. */
  url: string
  /** Nome curto pra UI/diagnóstico. */
  name: string
  /** Timeout específico em ms. Default 5000. */
  timeoutMs?: number
}

/**
 * Lista default de gateways clearnet. Ordem reflete preferência.
 *
 * **CARE:** lista curta e auditável. Não inflar — cada gateway novo
 * é um vetor de privacidade adicional.
 */
export const DEFAULT_IPFS_GATEWAYS: IpfsGateway[] = [
  { name: 'dweb.link', url: 'https://dweb.link', timeoutMs: 5000 },
  { name: 'w3s.link', url: 'https://w3s.link', timeoutMs: 5000 },
  { name: 'ipfs.io', url: 'https://ipfs.io', timeoutMs: 8000 },
]

/**
 * Constrói URL HTTP de gateway pra um CID específico.
 *
 *   gatewayUrl(g, 'bafy...') → 'https://cf-ipfs.com/ipfs/bafy...'
 */
export function gatewayUrl(gateway: IpfsGateway, cid: string): string {
  // Normaliza: remove trailing slash do gateway
  const base = gateway.url.replace(/\/$/, '')
  return `${base}/ipfs/${cid}`
}
