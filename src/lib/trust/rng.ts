/**
 * Trust Lens — deterministic RNG pra PPR Monte Carlo.
 *
 * Função pura. Mesmo `sourceNpub` + mesma janela de 24h → mesma seed
 * → mesma sequência de números → mesmo resultado de PPR. Garante
 * manifesto §7 (determinismo cross-device): 2 devices da mesma
 * identidade computam a mesma Lente dentro de uma janela.
 *
 * Stack:
 *   xmur3 (hash string → 32-bit seed) + mulberry32 (PRNG 32-bit).
 *
 * Sources:
 *   - Marshall Stage 1 GAP-1 (`trust-lens-math-review-marshall-2026-05-17.md`)
 *   - Stage 3 HIMYM consensus (`trust-lens-math-stage3-himym-2026-05-17.md`)
 *
 * Por que não `crypto.getRandomValues`:
 *   API web crypto é boa mas NÃO determinística — Drift precisa que 2
 *   devices da mesma identidade convirjam pra mesma ordem do feed
 *   dentro de uma janela. Crypto-random é o caso oposto (impossível
 *   de reproduzir).
 *
 * Por que não `Math.random()`:
 *   Não-seedable. Cada device geraria walks diferentes → variance
 *   Monte Carlo aparece como divergência cross-device, não como
 *   noise expected. Quebra §7.
 *
 * Conformance tests:
 *   - tests/trust-lens-math.test.ts #13 (determinismo bit-exact)
 *   - tests/trust-lens-math.test.ts #20 (boundary cross-device)
 */

/**
 * xmur3 — deterministic string → 32-bit unsigned hash.
 *
 * Avalanche behavior é "good enough" pra seed; não-criptográfico
 * intencionalmente. Custo: ~4 ops/char. Pra string de ~70 chars
 * (npub + window), execução é trivial.
 */
function hashStringSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

/**
 * mulberry32 — PRNG popular pra Monte Carlo (Tommy Ettinger).
 *
 * Period 2^32, equidistribuído em [0, 1). Não-criptográfico —
 * crítico que NÃO seja usado pra qualquer coisa de segurança
 * (nsec, signatures, encryption). É só pra random walks.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Janela de determinismo: 24h em ms. Dentro da mesma janela, mesmo
 * source produz mesmo seed → walks idênticos cross-device.
 *
 * Boundary 23:59:59 → 00:00:00 muda o seed (aceitável; recompute
 * natural acontece nessa fronteira via TTL trigger).
 */
const WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Cria PRNG pra PPR Monte Carlo de uma identidade ativa em uma
 * janela específica.
 *
 * @param sourceNpub — npub da identidade ativa (capability)
 * @param nowMs — Date.now() no momento do recompute
 * @returns função `() => [0, 1)` deterministic
 */
export function createPprRng(sourceNpub: string, nowMs: number): () => number {
  const window = Math.floor(nowMs / WINDOW_MS)
  const seed = hashStringSeed(`${sourceNpub}|${window}`)
  return mulberry32(seed)
}

/**
 * Exposto pra testes. Não usar em production code — `createPprRng` é
 * a API pública.
 */
export const __internal = {
  hashStringSeed,
  mulberry32,
  WINDOW_MS,
}
