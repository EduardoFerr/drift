// Funções do app que a simulação da lente usa (empacotadas por build-lens.mjs).
export { computePpr, computePprExact, viewMultiplier, normalizePpr } from '../../src/lib/trust/ppr'
export { createPprRng } from '../../src/lib/trust/rng'
export { PPR_PARAMS, VIEW_MULTIPLIER } from '../../src/lib/trust/constants'
export { mixNetwork, canonicalCompare } from '../../src/lib/lens/order'
