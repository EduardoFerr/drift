# Handoff — fim de sessão 2026-05-20

**Status:** sessão maratona (2026-05-17 → 2026-05-20). Tudo pushed em `main`.
**Último commit:** `314e45c`
**Estado:** CI verde (tsc 0 errors, lint 0 warnings, ~1556 tests Vitest — 6 falhas pré-existentes em `dist/` conformance que requer `npm run build`)

---

## 1. Visão geral

Sessão começou em 2026-05-17 (handoff anterior em `Docs/sessions/handoff-2026-05-17-end-of-day.md`) com 14 rounds shipped. Continuou ininterrupta até 2026-05-20 com mais ~25 commits cobrindo:

- **Settings friction Phase 1-6.1** (10 commits) — primitive `SettingExplainer` + `AccordionGroup` + 9 cards refatorados + Menu Detalhado granular com 5 flags
- **Map animation sanfona** (HIMYM Robin+Lily dispatch) — clipPath open/close
- **ActionsFan visual** (3 rounds) — container único, ícones 2px, destrutivo isolado, labels permanentes, depois toggle de labels via Menu Detalhado
- **Slim mode bug** (2 commits) — banner reposicionado + bg sólido
- **text-shadow tema-aware** (3 temas) — Cinder/Rosenholz/Velatura
- **Satoshi audit retroativo** (3 findings shipados) — upload endpoint badge, CSV validation, race-tolerant persist
- **Bootstrap UI freeze** (Barney+Robin dispatch) — auto-finish onboarding quando rules vazio + skeleton durante !feedLoaded
- **Manifesto matrix v2** + housekeeping (gitignore, BACKLOG cleanup)

---

## 2. Commits shipped nesta sessão (newest first)

| Hash | Tema |
|---|---|
| 314e45c | docs(backlog): hash Satoshi #2+#3 |
| 7eb0549 | fix(capabilities): Satoshi #2 + #3 — RULE_ID_PATTERN + race-tolerant persist |
| 05ac4d6 | fix(a11y): bulk replace text-drift-muted/30 → /60 |
| c781739 | test(conformance): LOCK_VIA_TEST AccordionGroup (22 tests) |
| f275e54 | chore(backlog): radio-group active state parcialmente fechado |
| 4ae6fad | docs(manifesto): snapshot v2 coverage matrix (2026-05-20) |
| 6a6affa | chore(backlog): fecha 5 items das Phase 1-6 |
| fadeb1b | chore(gitignore): untrack .playwright-mcp/ + screenshots |
| 2b344d0 | fix(feed): skeleton durante first-load (Barney+Robin Hyp #2) |
| 343a736 | feat(menu-detail): 5ª flag — labels ActionsFan |
| ca96ed8 | feat(settings): Phase 6 — Menu Detalhado granular (substitui binário) |
| 0ad909c | fix(settings): menu items advanced somem quando toggle off (Phase 5) |
| a936cdd | docs(backlog): hash Satoshi fix #1 |
| 2e9fa75 | fix(compose): badge upload_endpoint customizado (Satoshi #1) |
| b597301 | fix(sua-lente): Lily audit polish — track fill + label demote |
| 8468518 | feat(settings): AccordionGroup primitive + 4 cards (Ted) |
| 3a0332f | fix(onboarding): auto-finish quando applicableRules vazio (Barney+Robin Hyp #1) |
| c9727f0 | fix(settings): AdvancedToggle line-break + NetworkMode sai do limbo |
| e27a3f4 | feat(settings): Phase 3 — level=advanced gate (depois substituído na Phase 6) |
| 0350ac8 | feat(settings): Phase 2 — refactor 6 cards (allowlist zerado) |
| 45cd93f | feat(settings): SettingExplainer primitive + 3 cards (Phase 1) |
| 24bb221 | docs(audit): friction de settings + framework |

(Commits anteriores estão no handoff de 2026-05-17.)

---

## 3. Primitives novos em `src/components/UI/`

- **`SettingExplainer.tsx`** — wrapper pra settings com props canônicas (label/description/impact/defaultExplained/reversible/warning/reference). Integra com AccordionGroup quando dentro; standalone quando fora.
- **`AccordionGroup.tsx`** — React Context coordena 1-aberto-por-vez. API por `accordionId` semântico (não index). Reusa `Collapse` + `ChevronDownIcon`.

---

## 4. Schema UserPrefs — novas flags

- `menu_detail_show_details: true` — impacto/default/reversível em settings
- `menu_detail_show_manifesto: false` — links §X
- `menu_detail_show_how_it_works: false` — expandir "Como funciona"
- `menu_detail_show_algorithm: false` — nomes técnicos (PageRank, etc.)
- `menu_detail_show_action_labels: true` — labels ⋮ ActionsFan

Removida: `show_advanced_settings` (binário substituído pelas 5 flags).

---

## 5. Conformance tests novos

- `tests/setting-explainer-conformance.test.ts` — 24 tests
- `tests/accordion-group-conformance.test.ts` — 22 tests
- `tests/capabilities-conformance.test.ts` — 15 tests (+5 dos Satoshi fixes)

Total: ~1556 tests (subiu de ~1051 no handoff anterior — +505 tests).

---

## 6. HIMYM dispatches desta sessão

| Persona | Trabalho |
|---|---|
| Ted | AccordionGroup design (~400 palavras) |
| Lily | SuaLenteCard audit (5 fixes priorizados) + Settings friction audit (inline depois falha do agent) |
| Robin | Map animation patterns research (Material 3, Apple Maps, Twitter, Linear, Strava) |
| Barney+Robin | First-load UI freeze diagnosis (3 hipóteses, top fix em 5 linhas) |
| Satoshi | Audit retroativo de 4 commits → 3 findings (1 fix urgente + 2 menores) |
| Marshall | Implícito — conformance tests novos |

---

## 7. Pendências políticas (requer user input)

| Item | O que precisa |
|---|---|
| **SW root fix** | Decisão `autoUpdate` vs §17 (silent update viola "sem chave mestra"?) |
| **DAOP Phase 2 hints concretos** | Quais features ganham HintChip/Toast/Modal primeiro? |
| **i18n Phase 1A** | GO/NO-GO + Weblate hosting + initial locales |
| **Trust Lens 5 GAPs** | PPR decay, filter→edge loop, cluster detection, PR-4c timing, PR-5 toggle |
| **Atomic Design adoption** | HIMYM já deliberou; aguarda decisão de scope |
| **Ícones header escopo expandido** | HIMYM já deliberou; aguarda decisão |

---

## 8. Pendências sem bloqueio político (eu posso shipar)

| Item | Razão de esperar |
|---|---|
| **PostViewer `!embedded` dead code cleanup** | Medium risk em arquivo crítico, prefere review dedicado |
| **Audit `bg-drift-surface/30` + `border-*/30`** | 110 sites — bulk replace = catástrofe, precisa caso-a-caso |
| **Extract `<RadioGroupButton>` primitive** | Não-urgente, sintoma fechado nos cards reportados |
| **Conformance test menu_detail wiring (HomeEmpty, ComoFuncionaCollapse)** | Marshall completeness, ROI marginal |
| **Image fetch warning audit** | "BlobError: meta sem url nem cid" no console — pode ser bug ou só noise |

---

## 9. Próximos passos sugeridos (em ordem de impacto)

1. **User valida Vercel preview** — confirma que Menu Detalhado + AccordionGroup + Satoshi badge funcionam visualmente nos 3 temas
2. **Decisão SW root fix** — dispatch HIMYM completo (Ted/Barney/Lily) quando user quiser
3. **DAOP Phase 2 hints** — escolher 2-3 features pra adotar HintChip primeiro
4. **i18n Phase 1A scheduling** — GO/NO-GO + agendar sprint dedicada

---

## 10. Métricas de saúde do repo

- **tsc:** 0 errors
- **lint:** 0 warnings (hard ratchet)
- **vitest:** 1546 passing + 6 falhas pré-existentes (dist/ conformance) + 4 todo
- **bundle:** entry chunk dentro do hard cap 250 KB
- **manifesto coverage:** 22 ✅ / 9 🟡 / 0 ⛔ / 3 ⏳ (snapshot v2)
- **conformance LOCKs ativos:** manifesto, design-system primitives (1 entry allowlist), drift-alert, wcag-contrast, hint primitives, capabilities, guidance-rules, accordion-group, setting-explainer

---

*Última atualização: 2026-05-20. Commit ref `314e45c`.*
