# Handoff — fim do dia 2026-05-17

**Status:** sessão fechada. Tudo pushed em `main`. CI verde (1524/1531 tests; 7 falhas são pré-existentes em conformance de `dist/` que requer `npm run build` — não bloqueiam continuidade).

**Branch atual:** `main` (último commit: `9e2e525`)

---

## 1. O que shipou hoje (sessão tarde+noite — 14 rounds)

Em ordem cronológica reversa, com hash + 1-linha. BACKLOG.md tem detalhamento completo.

| # | Hash | Tema | Resumo |
|---|---|---|---|
| 14 | `9e2e525` | fix conformance | HintToast regex + SovereigntyCard WCAG (pré-handoff cleanup) |
| 13 | `86ff522` | i18n spike | relatório completo → LinguiJS v4 + Weblate self-host |
| 12 | `59741c6` | refactor | PostViewer `ModalWrapper` removido (dead code; allowlist 2→1) |
| 11 | `9454384` | refactor | ComposeOverlay `PreviewOverlay` → FullPageCard primitive |
| 10 | `e213c24` | feat | `SovereigntyCard` — UI pros 3 endpoints customizáveis |
| 9 | `d0b7ac5` | feat | DAOP PR3 — Hint primitives (Chip/Toast/Modal) + 15 tests |
| 8 | `3299b26` | feat | DAOP PR2 — `lib/capabilities.ts` + `appliesIf` + 12 tests |
| 7 | `ebcb735` | test | promote design-system-primitives #1 → ENFORCE |
| 6 | `c823e8f` | refactor | DAOP PR1 — `lib/guidance.tsx` declarativo + 9 tests |
| 5 | `b76245b` | feat sec | Satoshi Lacuna 2 — nsec exposure guards (passkey + rate-limit + audit) |
| 4 | `9fb525f` | refactor | ReplySheet → SlideUpOverlay bottom-sheet |
| 3 | `4c36a18` | fix UX | SuaLenteCard polish (labels descritivos + CTA "ver feed agora") |
| 2 | `7fa7280` | refactor | OnboardingOverlay → SlideUpOverlay (+ enforce #2) |
| 1 | `f8db723` | feat | UserPrefs sovereignty bump — 3 endpoints customizáveis |

**Conformance ratchet final:** `OVERLAY_LEGACY_ALLOWLIST` 4 → 1 (só `ThreadView` role="tree" resta como exceção semântica documentada).

**DAOP Phase 1 fechada:** PR1 (refactor puro) + PR2 (capabilities) + PR3 (Hint primitives). 36 conformance tests novos no domínio.

---

## 2. Onde está o código DAOP (capabilities + hints) — pronto pra ADOÇÃO

Phase 1 está SHIPPED mas hints ainda **não montados em features**. Caller decide quando montar. Caminhos óbvios pra Phase 2:

- **HintChip** passive pra "considere seguir alguém" (regra hipotética nova em `lib/guidance.tsx`) — montar em Discovery quando `hasFollow=false` e user explorou > 5 posts.
- **HintToast** reactive pós-1º-post (regra "compartilhe seu npub" se `hasFirstPost && !hasFirstSpread` por > 24h).
- **HintModal** pra backup nsec após detect de gap crítico (já tem regra `'identity'` com `appliesIf: !hasBackup`).

Próximo passo natural: **decidir 2-3 hints concretos pra Phase 2** + escrever regras + montar nos call sites.

---

## 3. Pendências priorizadas — onde retomar amanhã

### 3.1. Decisões abertas que dependem do user (não shipável sem input)

Em ordem de impacto:

1. **i18n GO/NO-GO Phase 1A** ([86ff522] relatório completo em `Docs/sessions/i18n-spike-2026-05-17.md`)
   - Custo: 10 dias dedicados, +8 KB bundle
   - Decisões pendentes: scheduling, Weblate hosting (VPS?), initial locales (só PT-BR+EN, ou + ES?), autor de `CONTRIBUTING-i18n.md`

2. **Satoshi Lacunas 1/3/4/5** — registradas em [BACKLOG.md:163-176](BACKLOG.md) com 4 hipóteses candidatas (PPR gaming / eviction silenciosa / NIP-65 fingerprint / reports doxxing). Precisa **HIMYM Satoshi dispatch dedicado** pra threat-modelar + priorizar antes de shipping cego.

3. **Trust Lens politics** — 5 GAPs abertos em [BACKLOG.md:129-156](BACKLOG.md):
   - GAP-1 PPR decay temporal (sem decay / exp 30d / score-based?)
   - GAP-2 filter → edge feedback loop (UX vs anti-Sybil hack)
   - GAP-CLUSTER detecção LPA (Phase 2 candidato; aguarda dados de uso)
   - PR-4c worker thread timing (Phase 1.5 vs 2?)
   - PR-5 toggle "mostrar lente reordenou" (validar inspector chip primeiro)

4. **Robin multi-list research re-dispatch** — agente background da sessão; respawn ou abort?

### 3.2. Itens shippeáveis sem decisão (pegar e fazer)

- **DAOP Phase 2 hints concretos** — montar HintChip/Toast/Modal em features reais (ver §2). Pode ser ~3-4 hints pra começar.
- **PostViewer `!embedded` cleanup completo** — branches dormentes do ModalWrapper removido em [59741c6]. Comentário no código já avisa; cleanup separado documentado.
- **ActionsFan visibilidade sobre fotos** ([BACKLOG.md:279-298](BACKLOG.md)) — bg/85 + drop-shadow no SVG. Marshall pattern.
- **Atomic Design adoption decision** ([BACKLOG.md:197-203](BACKLOG.md)) — HIMYM já deliberou; aguarda decisão de scope (refactor grande vs grandfather existente).
- **Header icons (🌐 + 📍) escopo expandido?** ([BACKLOG.md:188-195](BACKLOG.md)) — HIMYM deliberou; aguarda decisão.

### 3.3. Pendências técnicas conhecidas

- **`dist/` conformance tests falham sem `npm run build`** — 5 falhas em `sri-conformance.test.ts` + `sourcemap-stripped.test.ts`. Pré-existentes, não-bloqueio em dev.
- **Branches `!embedded` em PostViewer** — dead-code dormente após [59741c6]; cleanup oportunístico.

---

## 4. Estado dos invariantes / saúde do repo

- **tsc --noEmit:** 0 errors
- **Lint:** 0 warnings (hard ratchet preservado)
- **Vitest:** 1524/1531 verdes (7 falhas pré-existentes em `dist/` build-conformance — esperado em dev sem build)
- **Conformance LOCKs ativos:** manifesto-conformance ✅, design-system-primitives 3/3 enforce ✅, drift-alert-api ✅, wcag-contrast ✅, hint-primitives (novo) ✅, capabilities (novo) ✅, guidance-rules ✅
- **OVERLAY_LEGACY_ALLOWLIST:** 1 entry (ThreadView semantic exception)
- **Manifesto coverage matrix:** snapshot 2026-05-15 ainda fonte da verdade (22 ✅ / 9 🟡 / 0 ⛔ / 3 ⏳) — esta sessão não mudou status políticos, só polish + infraestrutura DAOP. Bumpar matrix data quando Phase 6 distribuição binária Tauri shipar.

---

## 5. Arquivos novos criados hoje (referência rápida)

- `src/lib/capabilities.ts` — store + queries SQLite + dismissedRuleIds bag
- `src/lib/guidance.tsx` (refactor PR1; PR2 add `appliesIf`)
- `src/components/UI/HintChip.tsx`
- `src/components/UI/HintToast.tsx`
- `src/components/UI/HintModal.tsx`
- `src/components/Settings/SettingsCards.tsx` (+ `SovereigntyCard` no fim)
- `tests/capabilities-conformance.test.ts`
- `tests/hint-primitives-conformance.test.ts`
- `Docs/sessions/i18n-spike-2026-05-17.md`
- `Docs/sessions/handoff-2026-05-17-end-of-day.md` (este arquivo)

---

## 6. Onde retomar amanhã — sugestão de ordem

**Caminho A (continuar shipping):**
1. Decidir 2-3 hints DAOP concretos + escrever regras + montar (~½ dia)
2. Atomic Design decision (sim/não/parcial) — aguarda só user input
3. ActionsFan visibilidade sobre fotos (1-2h)

**Caminho B (decisões políticas pesadas):**
1. Trust Lens GAP-1 (PPR decay) — escolher uma das 3 opções via HIMYM
2. Satoshi Lacunas dispatch — threat-model das 4 hipóteses
3. i18n Phase 1A GO/NO-GO + scheduling

**Caminho C (manifesto coverage):**
1. Status dos 3 ⏳ no manifesto matrix (provavelmente Fase 6 Tauri / Fase 7 distribuição)
2. Re-audit dos 9 🟡 — algum virou ✅ depois da sessão?

Recomendação: começar dia com Caminho A (1-2 hints concretos) pra mostrar valor do DAOP shipping; abrir B em paralelo se HIMYM tiver banda.

---

*Última atualização: 2026-05-17 23:00 · Commit `9e2e525` · Branch `main` · Tudo pushed*
