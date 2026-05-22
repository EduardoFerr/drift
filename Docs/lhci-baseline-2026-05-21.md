# LHCI baseline — pré-doc Sprint N+2 P1.7

**Propósito:** preparar re-measure de Core Web Vitals após sessões
maratona 2026-05-17 → 2026-05-21 (~50 commits). Este doc lista o
delta significativo desde baseline anterior e define o que deve ser
re-measured antes de declarar perf health verde.

**Audiência:** Lily/Marshall (executor da run real), Ted (verdict
gate), Robin (este doc).

**Status:** doc-only · pré-task · cap 30min.

---

## §1 Baseline anterior

Source-of-truth: `Docs/sessions/cwv-final-report-2026-05-09.md`
(Round CWV-3, 2026-05-09).

**Snapshot estimado pós-CWV-2 (não run real, mas mecanicamente
defensável):**

| Métrica | Pré-CWV (2026-05-09 manhã) | Pós-CWV-3 (estimado) | Target manifesto |
|---|---|---|---|
| Performance score | 86 | 95-98 | ≥95 |
| LCP (mobile) | 3.8s | 1.8-2.3s | ≤2.5s |
| FCP | 2.3s | 1.5-1.8s | ≤1.8s |
| TBT | 8ms | ~8ms (sem regressão) | ≤200ms |
| CLS | 0.001 | ~0.001 | ≤0.1 |
| INP | ~150ms* | ~150ms (não medido) | ≤200ms |
| Initial JS transfer (gz) | ~252 KB | ~86 KB | (hard ratchet 250 KB raw) |
| Entry chunk raw | 727 KB | 172 KB | ≤250 KB hard |

*INP não foi medido em CWV-3 (gate é Performance score Lighthouse,
INP é field metric). Estimate baseado em TBT proxy.

**Verdict CWV-3:** 🟢 ship com confidence; run real recomendada
como verificação de campo.

---

## §2 Delta 2026-05-17 → 2026-05-21 — mudanças relevantes pra perf

50 commits aproximados, divididos em buckets que IMPACTAM ou NÃO
impactam CWV:

### §2.1 Mudanças que podem impactar (re-measure obrigatório)

| Área | Commit topic | Hipótese de impacto |
|---|---|---|
| **PostViewer cleanup** | `-270 LoC dead branches` + HintChip + SoloSpreaderWarning + ModeToggle | Net **menor** entry chunk (cleanup > additions); INP em swipe handlers pode oscilar (HintChip render extra) |
| **SpreadMap refactors (5)** | loadMapDeps dynamic import + social-nodes layer + K=1 warning + WoT colors opt-in + useMapInstance hook | Map é lazy-loaded — não afeta initial. MAS network mode (nós + clusters) adiciona Deck.gl IconLayer/HexagonLayer — re-measure mapa-on quando ativado |
| **Settings card +3 toggles** | report_decay_enabled + lens_strength + WoT colors | Settings é lazy. Impact: zero em initial; +1 hydration prefs pequeno |
| **Schema migrations (2)** | `lens_edges.created_at` + novos prefs | Worker startup +1-2 ALTER TABLE. Negligible (<10ms one-time) |
| **Trust Lens GAP-1 + GAP-CLUSTER** | PPR temporal decay + LPA cluster detection | Worker computation; debounced; já garantido <200ms p95 em PR-4c. Re-measure recompute timing pós-CLUSTER landed |
| **DAOP Phase 1 + HintChip + AccordionGroup + SettingExplainer + Menu Detalhado** | Primitivos novos no UI tree | Adicionam render cost; verificar bundle delta + LCP em homepage |
| **i18n Phase 1A scaffold** | Sem string-wrapping ainda | Zero impact (só scaffold) |
| **Atomic Design adoption** | Component reorg | Zero runtime; chunk hashing pode mudar |

### §2.2 Mudanças sem impacto provável (skip)

- Doc commits (BACKLOG, manifesto-coverage-matrix updates)
- Test commits (Vitest conformance additions, 1546 → 1556 tests)
- Persona/process commits (HIMYM workflow refinements)
- Linting / type fixes (zero runtime)
- LOCK_VIA_TEST additions (compile-time só)

---

## §3 Métricas a re-measure (priorizadas)

### §3.1 Hard targets manifesto (gate de release)

| Métrica | Target | Como medir |
|---|---|---|
| **LCP mobile** | ≤2.5s | Lighthouse CI mobile preset (Moto G4 throttle, Slow 4G) |
| **CLS** | ≤0.1 | Lighthouse + manual scroll/swipe |
| **INP** | ≤200ms | Field metric — Lighthouse user-flow simulado (swipe up/down/left/right) |
| **TBT** | ≤200ms | Lighthouse (proxy de INP em lab) |
| **Bundle entry raw** | ≤250 KB | `npm run build` + check `dist/assets/index-*.js` size (hard ratchet em CI) |
| **Bundle gzip** | (informativo) | `gzip -c dist/assets/index-*.js \| wc -c` |

### §3.2 Cenários de teste

Lighthouse CI deve rodar pelo menos estes flows:

1. **Cold start** (`drift.vercel.app/`): primeira visita, sem cache
   → LCP gate principal
2. **Repeat visit** (Service Worker cache hit): warm cache → FCP
   próximo de 0
3. **Map open** (`?view=map`): lazy chunk load — verificar não
   regrediu
4. **Post viewer open** (deep link): PostViewer render path
5. **Settings open**: Accordion + SettingExplainer render

### §3.3 Anti-regression checks

- Entry chunk gz ainda < ~90 KB (CWV-3 baseline)
- Modulepreload de heavy deps (helia, maplibre, deck.gl) **não**
  retornou — `vite.config.ts` filter ainda ativo
- Font-display swap + size-adjust descriptors preservados
- Hidden sourcemaps ainda gerados (debug-only)

---

## §4 Como rodar

### §4.1 CI (preferido)

Workflow GitHub Actions: `.github/workflows/lighthouse.yml` já
existe (verificar `.lighthouserc.cjs` config).

Trigger:
- PR contra `main` → Lighthouse run automático em preview deploy
- Manual workflow_dispatch quando quiser baseline ad-hoc

Output esperado: comment em PR com delta vs baseline + score
breakdown.

### §4.2 Local (debug)

```bash
npm run build
npx serve dist -l 4173
# em outra shell:
npx @lhci/cli@latest autorun --config=.lighthouserc.cjs
```

Limitação local: throttling difere de CI (CPU host, network real).
Útil pra detectar regressão grosseira, não pra gate número exato.

### §4.3 Field measurement (Tauri/PWA real device)

Não automatizado. Manual via Chrome DevTools → Performance Insights
em cel real:
- Moto G modesto (proxy Sul Global)
- Conexão 4G real (não throttled)
- Cold start app

---

## §5 Decision gates pós-run

| Resultado | Ação |
|---|---|
| Todos targets ≤ verde | ✅ doc "lhci-results-2026-05-21.md" + close P1.7 |
| LCP > 2.5s mobile | 🔴 investigate; HIMYM dispatch Lily (perf) |
| Bundle > 250 KB hard | 🔴 hard ratchet falha CI — bloqueia release |
| INP > 200ms em swipe | 🟡 investigate handlers; possível Trust Lens recompute leak |
| CLS > 0.1 | 🔴 layout shift novo (provável SoloSpreaderWarning ou HintChip) |
| Regressão <5% em 1 métrica | 🟡 doc honestly; ship se manifesto target ainda ok |
| Regressão >10% em 1 métrica | 🔴 revert/fix antes de ship |

---

## §6 Cross-refs

- Baseline: `Docs/sessions/cwv-final-report-2026-05-09.md`
- Research base: `Docs/sessions/cwv-research-2026-05-09.md`
- Tooling: `Docs/cwv-tooling.md`
- RFC bundle strategy: `Docs/rfcs/2026-05-rfc-cwv-bundle-strategy.md`
- LH config: `.lighthouserc.cjs`
- Conformance: `tests/cwv-conformance.test.ts`
- Manifesto §1: existence-autonomy (perf como compromisso anti-exclusão)

---

*Última atualização: 2026-05-21 · pré-task P1.7 Sprint N+2 · Robin
(research/curadoria/docs persona) · cap 30min doc-only · ship status
pendente run real.*
