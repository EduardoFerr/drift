/**
 * Cálculo de score de post. Função pura — sem side effects, sem
 * leitura de relógio interno (passamos `now` explicitamente).
 *
 * Determinismo: dado o mesmo input, qualquer cliente Drift no mundo
 * chega ao mesmo número. Esta é a base do "algoritmo humano" — não
 * existe ranking secreto, é tudo derivado de eventos públicos.
 *
 * Fórmula:
 *   score = (spreads - buries * 0.3) / (ageHours + 2) ^ 1.5
 *
 * Por quê:
 *  - spreads pesam 1, buries pesam 0.3 — enterro é julgamento estético,
 *    não punição. Reduz menos do que espalhar adiciona.
 *  - +2 nos ageHours evita divisão explosiva nos primeiros minutos.
 *  - expoente 1.5 dá decaimento suave; um post fica relevante por
 *    horas, não minutos.
 */

export interface ScoreInput {
  spreads: number
  buries: number
  /** unix seconds (mesmo formato dos eventos Nostr) */
  createdAt: number
  /** unix seconds — passado explicitamente para preservar pureza */
  now: number
}

export function calculateScore(input: ScoreInput): number {
  const { spreads, buries, createdAt, now } = input
  const ageHours = Math.max(0, (now - createdAt) / 3600)
  const netEngagement = spreads - buries * 0.3
  return netEngagement / Math.pow(ageHours + 2, 1.5)
}

/** Conveniência: usa o relógio atual. Use apenas em paths de
 *  materialização (recalculateScore), nunca em testes. */
export function calculateScoreNow(
  spreads: number,
  buries: number,
  createdAt: number,
): number {
  return calculateScore({
    spreads,
    buries,
    createdAt,
    now: Math.floor(Date.now() / 1000),
  })
}
