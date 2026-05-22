# Handoff — Sprint N+2 close + bug fixes (2026-05-21)

**Status:** Sprint N+2 100% fechada + 3 bug fixes pós-sprint shipados.
Todos pushed em `main`.
**Último commit:** `64e1d59`
**Estado:** tsc 0 errors · lint 0 warnings · ~1700+ tests Vitest
(5 dist/ conformance falhas pré-existentes esperadas em dev sem
`npm run build`)

---

## 1. Visão geral

Sessão consolidou Sprint N+2 (10 itens P0/P1/P2) shipados em 3 rounds
paralelos (3 + 2 + 2 agents). Após sprint close, 3 bug fixes
ad-hoc reportados pelo user shipados em sequência.

**Trabalho via paralelismo via superpowers:** dispatching-parallel-agents
skill ativada. 7 agents background (Robin, Marshall, Ted, Lily x2,
Satoshi x2) entregaram trabalho sem conflitos cross-file.

---

## 2. Sprint N+2 — 10 itens shipados

| # | Item | Commit | Tests novos |
|:---:|---|---|:---:|
| P0.1 | §16 IPFS pin automático (viral threshold) | `11ec501` | 16 |
| P0.2 | Lentes pluggable POC (Registry + 2 lentes + UI) | `98ce60d` | 13 |
| P0.3 | §15 Doc "instalar em país censurado" | `6c5f768` | — |
| P0.4 | §25 CI grep zero scan automático | `4dcad14` | 7 |
| P1.5 | Extract `<ActionsFan>` primitive | `5591132` | 24 |
| P1.7 prep | LHCI baseline doc (re-measure defer) | `6c5f768` | — |
| P1.8 | Auto-rebroadcast em `addRelay()` (Satoshi audit) | `88d1337` | 6 |
| P2.10 | §20 Random walk doc | `6c5f768` | — |
| P2.11 | Profile picture render no feed/comments | `2137243` | 14 |
| P2.12 | `architecture-phases.md` (Fase 6/7 → épicos) | `6c5f768` | — |

**Total Sprint N+2:** 10 commits · 80 tests novos · 0 manifesto violations.

### Pendente Sprint N+2 (defer N+3)

- **P1.6 useLensToggle hook** — DRY 3 toggles em SuaLenteCard
- **P1.7 LHCI re-measure (run real)** — só baseline doc shipado
- **Composição §6 lentes** (∪ ∩ −) — design ready, defer N+3

---

## 3. Bug fixes pós-sprint (3)

| Bug | Commit | Diagnóstico |
|---|---|---|
| Long-press 5→3s + ripple CSS | `36809ef` | User pedido — substituiu progress bar + label por animação radial CSS a partir do toque |
| Layout LocationCard reflow + confusão "GPS trava" | `36809ef` | Lily audit — minHeight 88px + nota explicativa "GPS só dispara ao publicar" |
| Mapas "mesmos pins" diagnóstico | `36809ef` | Ted audit — NÃO é bug código (queries distintas); small base (~4-10 spreads). Aceito por construção. |
| Preview ComposeOverlay quebrada | `64e1d59` | Lily — `authorPub='preview'` (não-hex) → `parseInt('preview', 16)=NaN` → CSS inválido em AuthorChip identicon. Fix: guard + hex válido. |
| Ripple label removido (user clarif) | `64e1d59` | User clarif — só ondas visualmente, label fica em `sr-only` aria-live |

---

## 4. Artefatos novos (sessão completa)

### Primitives + helpers
- `src/components/UI/AuthorChip.tsx` (novo)
- `src/components/Post/ActionsFan.tsx` (extracted from PostViewer)
- `src/components/Feed/useMapDeps.ts` (DRY loadMapDeps)
- `src/lib/lens/{types,registry,init}.ts` (Lens POC)
- `src/lib/lens/strategies/{ppr-trust,chronological}.ts`
- `src/lib/trust/map-color.ts` (WoT colors)
- `src/styles/ripple.css` (long-press animation)

### Schemas + prefs
- `lens_edges.created_at INTEGER` (Gap B Sybil edge-refresh)
- `UserPrefs.lens_show_reorder_indicator`
- `UserPrefs.lens_ppr_decay_enabled`
- `UserPrefs.lens_show_in_map`
- `UserPrefs.report_decay_enabled`
- `UserPrefs.auto_pin_enabled`

### Docs canônicos
- `Docs/algoritmos.md` (7 algoritmos didáticos)
- `Docs/guia-do-usuario.md` (consequências de cada ação)
- `Docs/lens-pluggable-design.md` (Strategy Registry + §6 composição)
- `Docs/threat-model-maps.md` (5 vetores adversariais)
- `Docs/known-limitations.md` (8 gaps com Reopener)
- `Docs/install-censored-country.md` (canais distribuição)
- `Docs/architecture-phases.md` (Fase 6/7 épicos)
- `Docs/lhci-baseline-2026-05-21.md` (CWV pré-Sprint N+3)

### Sessions docs (~10)
- `lily-tinder-audit-2026-05-21.md`
- `content-hash-dedup-deliberation-2026-05-21.md`
- `satoshi-ted-sprint-n2-plan-2026-05-21.md`
- `profile-picture-audit-2026-05-21.md`
- `satoshi-redundancia-audit-2026-05-21.md`
- + outros 5

---

## 5. Metrics finais

| Métrica | Valor |
|---|---|
| Commits totais (sessão maratona estendida) | ~34 |
| Tests novos | ~170 |
| Schema migrations novas | 1 (lens_edges.created_at) |
| UserPrefs novas | 6 (todas opt-in default OFF) |
| Primitives novos | 4 (AuthorChip, ActionsFan, useMapDeps, ripple) |
| Conformance LOCKs adicionados | 7 |
| Docs canônicos novos | 8 |
| Sessions docs novos | 10 |
| tsc errors | 0 |
| lint warnings | 0 |
| Manifesto violations | 0 |

---

## 6. Pendências políticas (ainda requer user input)

| Item | O que precisa |
|---|---|
| Sprint N+3 — débitos técnicos | Satoshi planejando em background; user aprova |
| LHCI re-measure run | Vercel preview + Lighthouse audit + delta vs baseline |
| Composição §6 lentes (∪ ∩ −) | Defer N+3; design ready |
| Persistência `active_lens` em UserPrefs | Defer N+3; POC volátil OK por enquanto |
| Distribuição binária Tauri | Sem fix político ainda — Fase 6 |
| i18n Phase 1A | GO/NO-GO scheduling |

---

## 7. Estado Sprint N+3 (planejando)

Satoshi background despachado pra:
1. Inventário débitos abertos (known-limitations + BACKLOG)
2. Sprint shape P0/P1/P2 com paralelismo
3. Veto items explícitos
4. LHCI execution plan
5. Risco residual pós-N+3

Aguardando retorno pra commit do plan + start.

---

## 8. Próximos passos

1. **Aguardar Satoshi Sprint N+3 plan** (background) → user aprova
2. **Smoke test Vercel** opcional (~10min) — validar visual dos 5 fixes:
   - Long-press 3s + ripple radial
   - LocationCard layout fix
   - Profile pic no feed
   - Lens dropdown em SuaLenteCard
   - Preview ComposeOverlay (deve funcionar agora!)
3. **Execute Sprint N+3** quando aprovado — paralelismo igual N+2

---

*Última atualização: 2026-05-21. Sucessor de
`handoff-2026-05-20-late-shift.md`. Sprint N+2 fechada, Sprint N+3
em planejamento.*
