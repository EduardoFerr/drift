# Handoff — late-shift 2026-05-20

**Status:** sessão extra após `handoff-2026-05-20-end-of-session.md`.
Tudo pushed em `main`.
**Último commit:** TBD (este handoff comita por último)
**Estado:** tsc 0 errors · lint 0 warnings · ~1620 tests Vitest (5 dist/
conformance falhas pré-existentes esperadas em dev sem `npm run build`)

---

## 1. Trigger desta sessão

User instrução: "quero que vc faça todos, coloque todos em um pool de
tarefas e execute um a um" — autorização explícita pra fechar **14 items**
pendentes do BACKLOG (mix de implementação + decisão registrada).

Pool foi tracked via TaskCreate MCP; cada item commitado isolado, com
HIMYM+Satoshi pair-review na dúvida (chamado conforme instrução).

---

## 2. Commits shipped (newest first)

| Hash | Tema |
|---|---|
| `<este>` | docs(handoff): late-shift + correções pair-review |
| `8e815b9` | docs(backlog,locales): fecha 3 — opacity audit + atomic + i18n |
| `e3415d3` | feat(ui): RadioGroupButton primitive + 11 conformance |
| `d70cb1b` | refactor(post-viewer): cleanup dead !embedded (~270 LoC) |
| `2de0fc0` | feat(trust-lens): GAP-1 PPR decay temporal (opt-in) |
| `e2f0acc` | docs(backlog): fecha 4 Trust Lens items via decisão |
| `ac262ca` | feat(trust-lens): PR-5 toggle ReorderIndicator |
| `fee8ccc` | feat(daop): HintChip backup-after-post (1ª PR3) |
| `ddf5fdd` | fix(image): demote 'no-source' BlobError debug |

---

## 3. Por item do pool

| # | Item | Resultado |
|---|---|---|
| 1 | Robin multi-list re-dispatch | ABORT (research já consolidado) |
| 2 | Ícones header escopo | STATUS QUO (HIMYM anti-overload) |
| 3 | Image BlobError audit | FIX [ddf5fdd] — debug em vez de warn |
| 4 | DAOP Phase 2 hint | SHIP HintChip backup-after-post [fee8ccc] |
| 5 | Trust Lens PR-5 toggle | SHIP [ac262ca] — default OFF |
| 6 | Trust Lens GAP-1 PPR decay | SHIP [2de0fc0] — opt-in 30d half-life |
| 7 | Trust Lens GAP-2 filter→edge | NÃO IMPLEMENTAR (anti-Sybil) |
| 8 | RadioGroupButton primitive | SHIP [e3415d3] + 11 conformance tests |
| 9 | PostViewer !embedded cleanup | SHIP [d70cb1b] — 270 LoC removidas |
| 10 | Trust Lens PR-4c worker thread | NÃO SHIP AGORA (75ms < RAIL) |
| 11 | Trust Lens GAP-CLUSTER LPA | DEFER Phase 2 (sem dados pra calibrar) |
| 12 | i18n Phase 1A scaffold | STRUCTURAL ONLY [8e815b9] (sem lib install) |
| 13 | Atomic Design adoption | GRANDFATHER + GUIDELINE FORWARD |
| 14 | Opacity /30 cross-codebase audit | STATUS QUO + doc registrado |

---

## 4. HIMYM+Satoshi pair review (pós-pool, final da sessão)

Conforme instrução user: "Pode chamar HIMYM (os 5) + Satoshi, separe em
pares". 3 pares dispatchados em paralelo:

### Ted + Marshall (arquitetura + conformance)
- **Veredito**: SHIP-AS-IS
- Falso positivo inicial sobre DEFAULT_USER_PREFS (já estava na linha 533)
- Polish opcional (backlog): RadioGroupButton test não valida que callsites
  passem `ariaLabel` (defesa em camada: undefined é HTML válido mas sem
  semântica)

### Barney + Satoshi (security + game theory)
- **Veredito**: REQUIRES-MITIGATION
- **Real**: Sybil edge-refresh bypassa decay GAP-1 → fix correto requer
  `created_at` coluna em lens_edges (schema bump). **Documentado como
  KNOWN LIMITATION + item novo no backlog** ("Lens edges: column
  created_at imutável"). Defer Phase 2.
- **Sutileza §28**: HintChip dismiss persiste comportamento — futuro
  attacker pode correlacionar dismiss timing com first-post recency se
  alguém adicionar telemetria. Comments no código já registram zero-export;
  LOCK_VIA_TEST de "never-sync" pode ser hardening futuro (não bloqueia ship).

### Lily + Robin (UX + docs)
- **Veredito**: PUBLISH + TWEAK
- **Tweak shipped**: helper text "mais visível" → concreto ("chip lente
  fica preenchido + glyph ↕")
- **Doc gap shipped**: este handoff + BACKLOG update fechando GAP-1+PR-5
  com hash

---

## 5. Schema bumps desta sessão

UserPrefs ganhou 2 flags opt-in (defaults preservam comportamento existente):

```ts
lens_show_reorder_indicator: boolean   // default false
lens_ppr_decay_enabled:      boolean   // default false
```

prefs.ts deserialize + DEFAULT_USER_PREFS + serialize cobertos.
Nenhuma migration SQL necessária (user_prefs é key/value).

---

## 6. Primitives novos

- `src/components/UI/RadioGroupButton.tsx` — genérico `<T extends string>`,
  consumido por LocationCard + NetworkModeCard. Previne regressão de
  contrast em Velatura (active state `/15 +` solid accent, não `/30`).

---

## 7. Conformance tests novos

- `tests/radio-group-button-conformance.test.ts` — 11 tests (active state
  classnames + a11y + callsite migration + API stability)
- `tests/trust-lens-math.test.ts` — +6 tests (#22-#27) para `temporalDecay`
  (bit-exact, monotonia, NaN guards, underflow protection)

Total Vitest passou de ~1604 → ~1620 (~+16 tests).

---

## 8. Pendências políticas (continuam abertas — requer user input)

| Item | O que precisa |
|---|---|
| SW root fix (registerType change) | Decisão `autoUpdate` vs §17 |
| i18n Phase 1A GO/NO-GO | + Weblate hosting + initial locales |
| Distribuição binária Tauri | Sem fix político ainda |
| Lens edges `created_at` column | Schema bump quando attack real surgir |

---

## 9. Decisões shipped que fecharam pendências do handoff anterior

- ✅ Audit `bg-drift-surface/30` — doc-only, mantém status quo
- ✅ PostViewer dead code cleanup — 270 LoC removidas
- ✅ RadioGroupButton primitive — backlog item Lily/Marshall coverage
- ✅ Atomic Design — decisão GRANDFATHER registrada
- ✅ DAOP Phase 2 hints — 1ª HintChip live
- ✅ Trust Lens 4 GAPs decididos (1 shipado, 3 deferred/rejected)

---

## 10. Métricas finais

- **tsc:** 0 errors
- **lint:** 0 warnings (hard ratchet)
- **vitest:** ~1615 passing + 5 dist/ falhas esperadas + 4 todo
- **bundle:** entry chunk ≤ 250 KB hard ratchet
- **PostViewer.tsx:** 1410 → 1142 LoC (~-270)
- **SettingsCards.tsx:** -56 LoC (RadioGroupButton refactor)
- **Conformance LOCKs ativos:** manifesto, design-system, drift-alert,
  wcag-contrast, hint primitives, capabilities, guidance-rules,
  accordion-group, setting-explainer, **radio-group-button (novo)**

---

## 11. Próximos passos sugeridos

1. **User valida Vercel preview** — verificar 3 toggles novos em SuaLenteCard
   + HintChip em EndOfFeed funcionam visualmente nos 3 temas
2. **Decisão SW root fix** (autoUpdate vs prompt) — dispatch HIMYM completo
3. **Decisão i18n Phase 1A** (GO/NO-GO + scheduling)
4. **Telemetria local Trust Lens** — monitorar adoption rate dos novos
   toggles antes de decidir Phase 2 (cluster detection, worker thread,
   created_at schema bump)

---

*Última atualização: 2026-05-20 (late shift). Sucessor de
`handoff-2026-05-20-end-of-session.md`. 14 items BACKLOG fechados +
3 pair-reviews HIMYM/Satoshi.*
