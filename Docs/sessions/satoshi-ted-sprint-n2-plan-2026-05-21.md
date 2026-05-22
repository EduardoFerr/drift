# Sprint N+2 — Plano consolidado Satoshi + Ted

**Dispatch:** 2026-05-21 (fim sessão maratona)
**Decisores:** Satoshi (game theory + adversarial) + Ted (arquitetura)
**Trigger:** "Backlog: mais uma rodada de LHCI para melhorarmos as
métricas. Peça para Satoshi e Ted decidirem a próxima sprint"
**Target:** 8-10 dias full-focus

---

## Convergência (acordo Satoshi + Ted)

| Item | Status | Estimativa | Severity |
|---|:---:|:---:|:---:|
| §16 IPFS pin automático (viral threshold) | **P0 CRÍTICO** | 2d | 🔴 manifesto core |
| Lentes pluggable (Registry + 2 lentes + UI) | **P0 CRÍTICO** | 4-5d | 🟡 arch consolidação |
| §15 Doc "instalar em país censurado" | **P0** | 1.5d | 🔴 promessa core visível |
| §25 Conformance "zero scan automático" CI | **P0** | 0.5d | 🟡 defesa em camada |

## Divergência resolvida

**Lentes pluggable — Satoshi SPIKE (2-3d) vs Ted POC (4-5d):**

→ **Decisão: POC** (Ted recomendação). Razão: SPIKE entrega só
arquitetura sem feedback real; POC entrega 2 lentes funcionais (PPR
+ Chronological) + dropdown UI, gera signal de UX antes de
composição §6 set-theory (Sprint N+3).

**Smoke test pré-sprint — Satoshi PUSH, Ted não menciona:**

→ **Decisão: ACEITO Satoshi.** ~50 commits em 4 dias sem validação
Vercel completa = risco real. 2.5h de smoke test estruturado antes
de listar P0 reduz "descoberta surpresa de débito" durante sprint.

---

## Sprint shape final

### Pré-sprint — Smoke test estruturado (~2.5h)

| Fase | Checklist | Tempo |
|---|---|:---:|
| Deploy + perf | Vercel preview build limpo? Bundle delta < 5%? LCP > 2.5s mobile? | 30min |
| Conformance | `npx vitest run` 100% pass (não só "open PRs") | 45min |
| Adversarial spot | PPR recompute trace em grafo médio (100 follows). CLS? Audio glitch? | 1h |
| Handoff ready | `BACKLOG.md` consolidado, próxima sprint navegável? | 15min |

**Gate:** se smoke test mostrar regressão >10% LCP OR >2 conformance
failures novos, sprint começa com fix dirigido (~1d) antes de P0.

---

### P0 — Must-ship (fecha promessas)

| # | Item | Est | Aceite | LOCK_VIA_TEST |
|:---:|---|:---:|---|---|
| 0.1 | §16 IPFS pin automático | 2d | `events.ts:recalculateScore` hook dispara `maybePin(postId)` quando `score > VIRAL_THRESHOLD=30`. Helia adiciona CID. Conformance trava o pattern. | `tests/viral-ipfs-pin.test.ts` |
| 0.2 | Lentes pluggable POC | 4-5d | `LensRegistry` + `PprTrustLens` refatorada bit-exact (test #19 OFF preservado) + `ChronologicalLens` alt (puro, zero deps trust) + UI dropdown em SuaLenteCard. 8-10 conformance tests. | `tests/lens-plugin-conformance.test.ts` + `lens-composition-determinism.test.ts` (foundation pra §6) |
| 0.3 | §15 Doc país censurado | 1.5d | `Docs/install-censored-country.md` tabela canais (PWA browser, Tauri+Tor, F-Droid TWA, WebRTC P2P) + step-by-step per cenário | — (doc) |
| 0.4 | §25 CI grep zero scan | 0.5d | `tests/no-scan-automatico.test.ts` valida ausência de imports PhotoDNA/Cloudflare/ML libs. CI gate hard em main. | (mesmo arquivo) |

**Total P0:** ~8d

### P1 — Deveria caber (reforça abstração)

| # | Item | Est | Por quê |
|:---:|---|:---:|---|
| 1.5 | Extract `<ActionsFan>` primitive | 1.5d | PostViewer.tsx 1216 LoC → 1100. Pattern reusable, prepara ground pra future splits |
| 1.6 | `useLensToggle(key, default)` hook | 1d | DRY 3 toggles SuaLenteCard (ReorderIndicator, PprDecay, MapColors); preparada pra Phase 2 lentes pluggable |
| 1.7 | LHCI re-measure + delta report | 1d | User pediu. Baseline conhecido: cwv-final-report-2026-05-09.md (86/100). Workflow LHCI já existe em `.github/workflows/lighthouse.yml` — só rodar contra HEAD pós-maratona |

**Total P1:** ~3.5d

### P2 — Se tiver folga

| # | Item | Est |
|:---:|---|:---:|
| 2.8 | §20 Random walk pós-CONNECTED spec | 0.5d |
| 2.9 | `Docs/architecture-phases.md` 6/7 → épicos | 1d |

---

## Veto Items — explicitamente NÃO shipar Sprint N+2

| Item | Razão |
|---|---|
| Content-hash dedup (reabrir) | Deliberação NO-GO em [ebf0ad1]. Reabrir exige evidência concreta. |
| Tinder N/2 refill | Lily honest call — sem urgência hoje (~4-10 posts reais). |
| PR-4c worker thread | ~75ms < RAIL 100ms. Premature optimization. |
| GAP-CLUSTER LPA | Sem dados pra calibrar. Defer DAU > 1000. |
| Sneakernet QR bundle | Fase 7 — exige UX approval antes de spike. |
| NIP-44 DMs UI | Fase 8+ roadmap sem data. |
| Composição §6 set-theory (lentes) | Sprint N+3 — depois do POC validar feedback UX. |

---

## Pós-sprint — Matriz coverage esperada

| Princípio | Antes | Depois | Evidência |
|---|:---:|:---:|---|
| §15 anti-censura | 🟡 | 🟡→✅(parcial) | install-censored-country.md publicado |
| §16 disponibilidade | 🟡 | 🟡→✅(maioria) | IPFS pin automático + test |
| §24 lentes pluggable | ⏳ design | 🟡→✅(POC) | LensRegistry + 2 lentes + dropdown UI |
| §25 sem scan | ✅ | ✅(locked) | Conformance test ativo |

**Zero novos débitos** se gates de smoke + conformance forem
respeitados.

---

## Conformance LOCKs ativos pós-sprint

Sprint N+2 adiciona:
- `viral-ipfs-pin.test.ts` (§16)
- `lens-plugin-conformance.test.ts` (registry + PprTrustLens parity)
- `lens-composition-determinism.test.ts` (foundation §6 futuro)
- `no-scan-automatico.test.ts` (§25 grep PhotoDNA/Cloudflare/ML)

Total estimado tests pós-sprint: ~1660+ (atual ~1620).

---

## Decisões abertas pra user (antes de start)

1. **Aprovar Sprint N+2 conforme acima?** OR ajustar prioridades
2. **Pré-sprint smoke test 2.5h:** OK fazer ou pular pra ship P0
   direto? (Satoshi recomenda FAZER; Ted neutro)
3. **Lentes pluggable POC vs SPIKE:** Ted POC (4-5d) | Satoshi SPIKE
   (2-3d) — qual escopo?
4. **LHCI prioridade:** P1 (Ted) ou separado depois (Satoshi)?

---

*Plano consolidado Satoshi + Ted. Sprint start aguarda GO do user.*
