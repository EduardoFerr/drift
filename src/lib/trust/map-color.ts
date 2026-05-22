/**
 * pinColor — helper puro pra colorir pins do SpreadMap pelo nível de
 * confiança local (Trust Lens PPR score).
 *
 * Source: Satoshi+Ted plan D 2026-05-21. Implementação opt-in via
 * `UserPrefs.lens_show_in_map` (default OFF — Satoshi audit anterior:
 * cor por trust list vaza informação adversarial pra observer casual
 * com acesso ao device).
 *
 * Manifesto §22 — função pura, mapping discreto (não juízo subjetivo
 * contínuo). §24 — view-layer carve-out, não afeta posts.score.
 * §28 — pprScores já são local-only (computed em `recomputeLens`,
 * persisted em `lens_walks_cache` local).
 *
 * 4-tier discreto:
 *   Sem edge (sem PPR score) → cor default chartreuse atenuada
 *   PPR < 0.3 → muted blue   (cool, low-trust local OR unfamiliar)
 *   PPR < 0.7 → warm yellow  (transição, mid-trust)
 *   PPR ≥ 0.7 → highlight    (orange accent2, high-trust)
 *
 * Discreto > contínuo porque continuum cor implica precisão de trust
 * que a math não oferece (PPR Monte Carlo com variance). Tier discrete
 * é honesto sobre a uncertainty.
 *
 * Output: RGBA tuple Deck.gl format `[r, g, b, a]` ∈ [0,255].
 */

export type RGBA = [number, number, number, number]

/** Cor default chartreuse atenuada (fallback quando lens_show_in_map OFF
 *  OR quando spreader não tem edge em lens_edges). Mantém parity com
 *  cor original do social-nodes ScatterplotLayer pra zero regressão
 *  visual quando opt-in ainda OFF. */
export const PIN_COLOR_DEFAULT: RGBA = [232, 255, 90, 50]

const PIN_COLOR_LOW: RGBA = [100, 150, 180, 180] // cool blue, low-trust local
const PIN_COLOR_MID: RGBA = [200, 180, 80, 200] // warm yellow, mid-trust
const PIN_COLOR_HIGH: RGBA = [244, 130, 14, 220] // orange highlight, high-trust

/**
 * Retorna cor pra um pin do mapa baseado em `pprScore` do spreader.
 * Pure function, determinístico, testável sem mock React.
 *
 * Manifesto §28 — spreader sem edge em `lens_edges` (PPR score
 * undefined) → default. Não vaza "esse npub não está na minha rede"
 * visualmente (default é mesma cor pra TODOS os spreaders sem edge,
 * incluindo o próprio user, sybils, e anônimos).
 *
 * @param pprScore Score PPR do spreader [0, 1], ou undefined se
 *                 spreader não está em `lens_walks_cache`
 * @returns RGBA tuple Deck.gl format
 */
export function pinColor(pprScore: number | undefined): RGBA {
  if (pprScore === undefined || !Number.isFinite(pprScore) || pprScore <= 0) {
    return PIN_COLOR_DEFAULT
  }
  if (pprScore >= 0.7) return PIN_COLOR_HIGH
  if (pprScore >= 0.3) return PIN_COLOR_MID
  return PIN_COLOR_LOW
}
