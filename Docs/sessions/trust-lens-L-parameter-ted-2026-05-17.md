# Trust Lens — L parameter final deliberation (Ted v2)

**Data:** 2026-05-17
**Persona:** Ted (arquitetura)
**Status:** Decisão técnica final. Reconcilia 5 posições conflitantes em 1.

## Decisão

**L = 6** para PPR Monte Carlo, com K=1000 e α=0.15.

## Math defense

- Damping α=0.15 → E[walk length] = 1/α = 6.67
- L=6 é `⌊E[len]⌋` arredondado pra par (cleaner em UI se exposto)
- P(reach hop 6) = 0.85^6 = 0.377 — ainda perde 38% da cauda, mas damping já tornou essa cauda baixa-peso
- Compute: K=1000 × L=6 = 6000 hops ≈ 75ms mid-range phone (extrapolando RFC L=4 = 50ms)
- Budget: 300ms (UX threshold pra recompute debounced) — folga 4x pra grafos densos

## Reconciliação 5 posições

| Posição | Verdict |
|---|---|
| Ted RFC original (L=4) | **Modifico** — L=4 perdia 52% da massa; foi conservadorismo de compute que não se sustenta com measurement real |
| User intervention (L=8) | **Endosso parcialmente, modifico pra L=6** — intent ("não é só vizinhos") correto; mas L=8 paga 100ms pra capturar cauda já suprimida por damping |
| Ted zero-trust survey (L=2) | **REJEITO (auto-correção)** — colapsa PPR a "FoF only", mata cold start. Argumento Sybil correto mas mecanismo errado: L baixo é slept defense, não defense real |
| Robin instrumentation-first | **Endosso como Phase 2 input, rejeito como blocker de ship** — Phase 1 precisa número defensável; telemetria roda COM L=6, não no lugar |
| Plano consolidado L=4 + telemetria | **Modifico pra L=6 + telemetria** — spirit certo, value errado |

## Defense vs Sybil ring attacks

L baixo é **slept defense**. SybilGuard/SybilLimit não funcionam por cutoff de walk length — funcionam por detecção de escape probability entre região honesta e Sybil região (path diversity / mixing time).

Ring attack de 50 nodes com 1 honest edge ganha PPR proporcionalmente à edge weight desse 1 honest follow, independente de L=2 ou L=8. L baixo apenas reduz **magnitude** do ganho, não fecha o vetor.

**Defesa real** (já no plano):
1. **Path diversity scoring** (Alvisi/Viswanath central, não polish)
2. **Cluster detection** — grafos de baixo mixing-time + alta densidade + baixa edge-out = Sybil ring flag
3. **Mandatory random walk** — walks não-greedy, evita atacante "guiar" para si

Com essas 3 defesas, L=6 é seguro. Sem elas, L=2 também não defende.

## Telemetria Phase 1.5/2 (local, nunca shipar pra relay)

- `ppr_coverage_at_L` — % walks que atingiram L sem terminar via damping
- `ppr_walk_termination_histogram` — distribuição de termination hop (1..L)
- `ppr_score_stability` — variance entre runs back-to-back
- `ppr_compute_ms_p50/p95` — budget real medido
- `graph_diameter_estimate` — BFS amostral local

Phase 2 ajusta L com base nesses 5 sinais, não em intuition.

## Constraint pra Marshall

```typescript
// src/lib/trust/constants.ts (novo)
export const PPR_PARAMS = {
  L: 6,           // max walk length
  K: 1000,        // walks per source
  ALPHA: 0.15,    // damping (restart prob)
} as const
```

**Hard-coded constants, NÃO `user_prefs`.** Razão: PPR precisa ser determinístico cross-device pra mesma identidade (manifesto §7). User-tunável quebra isso. Phase 2 telemetria pode override via build flag, não runtime setting.

Worker importa de `constants.ts`, não inline numbers.
