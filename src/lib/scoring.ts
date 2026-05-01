/**
 * Cálculo de score de post. Função pura — sem side effects, sem
 * leitura de relógio interno (passamos `now` explicitamente).
 *
 * Determinismo: dado o mesmo input, qualquer cliente Drift no mundo
 * chega ao mesmo número. Esta é a base do "algoritmo humano" — não
 * existe ranking secreto, é tudo derivado de eventos públicos.
 *
 * Fórmula:
 *   score = (spreadWeight - buryWeight * 0.3) / (ageHours + 2) ^ 1.5
 *
 * Por quê:
 *  - spreadWeight = SOMA dos pesos dos spreaders (cada spreader
 *    contribui com seu próprio `weight` de identidade Drift, 0..100).
 *    Sybil novo tem weight ~0 → spread vale ~0 (manifesto §22 + §32).
 *  - Buries idem com burier weight, multiplicado por 0.3 — enterro é
 *    julgamento estético, não punição. Reduz menos do que espalhar.
 *  - +2 nos ageHours evita divisão explosiva nos primeiros minutos.
 *  - expoente 1.5 dá decaimento suave; um post fica relevante por
 *    horas, não minutos.
 *
 * **Mudança 2026-04-29** (pré-Fase-6): score deixou de contar EVENTOS
 * (`COUNT(*) FROM spreads`) e passou a somar PESOS dos spreaders/buriers.
 * Justificativa em `Docs/sessions/conformance-conversa-29-04.md`
 * §"Recomendação central" (papel: revisão de conformance). Mitiga
 * Sybil engagement (1000 npubs novos auto-espalhando = peso ~0).
 *
 * **Mudança "última ação vale"**: cada (post_id, user_pub) contribui
 * com APENAS sua ação líquida — última cronologicamente entre seus
 * spreads e buries. Implementado em `events.ts:recalculateScore`.
 * Manifesto §23 (mudança de opinião). Detalhes em
 * `Docs/sessions/conversa-29-04-analise.md` §Seção 2.
 */

export interface ScoreInput {
  /** Soma de pesos dos spreaders cuja ação líquida é 'spread'. */
  spreadWeight: number
  /** Soma de pesos dos buriers cuja ação líquida é 'bury'. */
  buryWeight: number
  /** unix seconds (mesmo formato dos eventos Nostr) */
  createdAt: number
  /** unix seconds — passado explicitamente para preservar pureza */
  now: number
}

export function calculateScore(input: ScoreInput): number {
  const { spreadWeight, buryWeight, createdAt, now } = input
  const ageHours = Math.max(0, (now - createdAt) / 3600)
  const netEngagement = spreadWeight - buryWeight * 0.3
  return netEngagement / Math.pow(ageHours + 2, 1.5)
}

/** Conveniência: usa o relógio atual. Use apenas em paths de
 *  materialização (recalculateScore), nunca em testes. */
export function calculateScoreNow(
  spreadWeight: number,
  buryWeight: number,
  createdAt: number,
): number {
  return calculateScore({
    spreadWeight,
    buryWeight,
    createdAt,
    now: Math.floor(Date.now() / 1000),
  })
}
