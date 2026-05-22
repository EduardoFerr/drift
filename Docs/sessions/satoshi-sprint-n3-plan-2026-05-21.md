# Sprint N+3 — Plan Satoshi "Zero Débito Maduro"

**Dispatched:** 2026-05-21 (sessão maratona estendida)
**Persona:** Satoshi Nakamoto (tech lead + adversarial)
**Trigger:** "executar uma sprint para cobrir todos os débitos
técnicos já identificados"
**Target:** 8-11 dias buffer-tolerant

---

## Honestidade radical

Sprint N+3 **NÃO atinge "zero débito absoluto"** — atinge **"zero
débito maduro"**. 9 débitos ficam dependentes de condições reopener
(telemetria, decisão política, fase futura). Isso é correto:
violação dos reopeners seria shipping prematuro.

---

## Inventário (22 débitos auditados)

- **11 fecháveis** agora (P0+P1+P2)
- **6 dependentes** (telemetria/decisão/Fase 6+)
- **5 Phase 2+** (DAU>1k, Fase 6.4 transport, etc.)

---

## Sprint shape (~8-11d)

### P0 — Must-ship (3.5d)

| # | Item | Est | LOCK_VIA_TEST |
|:---:|---|:---:|---|
| 0.1 | **D3** Profile picture render feed/comments | 4-6h | feed-author-avatar.test.ts |
| 0.2 | **D2** LHCI re-measure + delta report | 1d | — (doc) |
| 0.3 | **D6** RadioGroupButton cross-component audit + WCAG | 1d | radio-active-contrast.test.ts |
| 0.4 | **D11** SuaLenteCard polish round 2 (5 pontos confusão) | 1d | — (UX) |

> **Nota:** P0.1 (Profile picture render) já foi shipado em Sprint N+2
> commit `2137243` (Lily P2.11) — confirmar com user se ainda há
> regressão visível ou pode marcar como fechado.

### P1 — Deveria caber (2.25d)

| # | Item | Est |
|:---:|---|:---:|
| 1.5 | **D1** useLensToggle hook (DRY 3 toggles) | 1d |
| 1.6 | **D4** ActionsFan visibility (drop-shadow + alpha) | 4h |
| 1.7 | **D7** Audit dialogs antigos grep `role="dialog"` | 4h |
| 1.8 | **D16** dismissRule rate-limit debounce (XSS hardening) | 2h |

### P2 — Nice-to-have (2.75d)

| # | Item | Est |
|:---:|---|:---:|
| 2.9 | **D5** ActionsFan labels PT-BR (always-on first-show) | 4h |
| 2.10 | **D21** 9 conformance it.todo → it() (6 grep + 3 Stage 3) | 6h |
| 2.11 | **D8** Banner EditProfileCard → tooltip | 2h |
| 2.12 | **D9** ComposeOverlay "Prévia do post" flow refinement | 1d |

---

## Paralelismo — 4 batches (5-6d wall-clock vs 8-11 serial)

### Batch A (4 agents paralelos — zero overlap)
- Agent 1 → **0.1** Profile picture (feed + cards)
- Agent 2 → **0.2** LHCI run (doc, isolated)
- Agent 3 → **1.6** ActionsFan visibility
- Agent 4 → **1.8** dismissRule rate-limit

### Batch B (3 agents paralelos — após A)
- Agent 1 → **0.3** RadioGroupButton audit
- Agent 2 → **0.4** SuaLenteCard polish
- Agent 3 → **2.11** EditProfileCard tooltip + **2.10** it.todo conversions

### Batch C (sequencial — depende B)
- **1.5** useLensToggle (depende 0.4 SuaLenteCard estabilizar)
- **2.9** ActionsFan labels (depende 1.6 visibility estabilizar)
- **1.7** Dialog audit (depende 0.3 não duplicar)

### Batch D (P2 stretch sequencial)
- **2.12** ComposeOverlay preview flow (scope grande, sozinho)

**Throughput:** 5-6d com 4 agents vs 8-11d serial.

---

## Veto explícito

| Item | Razão |
|---|---|
| **D14** Satoshi Lacunas 1/3/4/5 | Threat modeling dedicado primeiro (Sprint N+4) |
| **D17** Image hash hard-fail | Sem telemetria <1% legacy |
| **D22** N/2 refill feed | Sem evidência >100 posts/user |
| **D18** K-anonymity engine | DAU >1000 reopener |
| **D19** Tauri binary | Fase 6 separado |
| **D20** Random walk pós-CONNECTED | Fase 6.4 transport dep |
| **D15** RFC DAOP-001 Phase 2 | Espera adoção primitives |
| **D12** PWA SW autoUpdate vs prompt | §17 política — user decide |
| **Composição §6 lentes** (∪ ∩ −) | Defer N+4 pós feedback POC |

---

## Risco residual pós-N+3

| Cenário | Cobertura |
|---|---|
| P0+P1 garantido | ~55% débitos fecháveis · ~36% backlog total |
| P0+P1+P2 stretch | ~75% débitos fecháveis · ~55% backlog total |

**Ficam pra futuro:** 9 débitos em condições reopener explícitas.

---

## LHCI execution plan

### Dois pontos no sprint
- **Day 0** (pré-sprint): baseline pós Sprint N+2 — 50+ commits desde
  `cwv-final-report-2026-05-09.md` (86/100)
- **Day N** (pós-sprint): delta vs Day 0 + delta vs 05-09

### Métricas + thresholds

| Métrica | OK | Regressão |
|---|:---:|:---:|
| LCP | <2.5s mid-range | >2.75s (10%) |
| INP | <200ms | >220ms |
| CLS | <0.1 | >0.11 |
| TBT | <300ms | >330ms |
| Bundle entry | <250KB hard ratchet | qualquer ↑ |

### Foco changes pós-05-09

- PostViewer (-270 LoC + HintChip + SoloSpreaderWarning + ModeToggle + social-nodes)
- SINK sessionBuriedIds (useMemo extra → INP?)
- Mapa 5 refactors (Deck.gl tree-shake?)
- Primitives novos (SettingExplainer, AccordionGroup, RadioGroupButton, MenuDetailCard, AuthorChip, ActionsFan)

### Ação se regressão >10%

1. DevTools Performance trace no path regredido
2. Git bisect entre 05-09 e HEAD
3. HIMYM dispatch Ted+Lily se causa não-óbvia
4. Hotfix N+3 se P0 (LCP/INP); doc + ticket N+4 se P2 (CLS/TBT)

### Output

`Docs/sessions/lhci-2026-05-21.md`:
- Tabela 5 métricas × 3 datas
- Bundle size breakdown por chunk
- Flag verde/amarela/vermelha por métrica
- Diagnose por regressão (se houver)

---

## Game Theory veto (Satoshi)

Vetei agressivamente:
- **D14** — atacante racional explora vuln mal-modelada > vuln
  não-modelada. Shipping cego = surface area maior
- **D17, D22** — sem dados, otimização vira aposta. Apostas em
  segurança são caras
- **D12** — chave-mestra disfarçada §17. Status quo prompt protege
  user mesmo que UX seja pior
- **D19/D20** — sprint de débito ≠ sprint de feature

**Ship discipline:** 8 P0+P1 fechados > 22 começados meio-feitos.

---

## Próxima ação (quando user der GO)

Batch A dispatch (4 agents paralelos): 0.1 + 0.2 + 1.6 + 1.8.
LHCI Day 0 baseline em paralelo.

---

*Plan Satoshi 2026-05-21. Sucessor de
`satoshi-ted-sprint-n2-plan-2026-05-21.md`. Sprint começa quando
user aprovar — ou ajustar prioridades.*
