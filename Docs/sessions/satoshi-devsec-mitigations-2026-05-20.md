# Satoshi (DevSec mode) — Mitigation plan + implementação

**Dispatched:** 2026-05-20 (sessão late-shift, pós-audit dos 7 algoritmos)
**Persona:** Satoshi como **DevSecOps specialist**
**Tipo:** Dispatch / Implementation
**Trigger:** "peça ao satoshi como um especialista em devsec mitigar
os problemas e aplicar aquilo que foi identificado como débito
técnico... vamos fazer!"

---

## Priorização DevSec dos 4 issues

| Issue | Severity | Facilidade | ROI | Status |
|---|---|---|---|---|
| **BUG SINK** (promessa quebrada no guia) | CRÍTICA | ALTA | 9/10 | ✅ SHIPPED |
| **Gap C (NOP)** | LOW | ALTA | 7/10 | ✅ SHIPPED |
| **Gap B (edge-refresh)** | MEDIUM | MÉDIA | 6/10 | 📋 SPIKE registrado |
| **Gap A (insider brigada)** | MEDIUM | BAIXA | 5/10 | 📋 POC registrado |

---

## SHIP NOW — 2 fixes shipados nesta sessão

### 1. BUG SINK — promessa do guia agora cumprida

**Problema:** `guia-do-usuario.md` prometia: "Localmente: o post some do
seu feed (não aparece mais no stack atual). Você não precisa ver de
novo." Atualmente o post sumia do view atual via `advanceCursor` MAS
reaparecia em `jump-to-top` ou `EndOfFeed.onBack` porque continuava no
array `posts`.

**Fix shipado:**
- Novo state em `App.tsx`: `sessionBuriedIds: Set<string>`
- `handleBury(post)` adiciona ao set imediatamente (antes de aguardar
  buryPost confirmar — bury é "intenção visível" do user)
- `posts` agora é `useMemo` filtrado: `allPosts.filter(p => !sessionBuriedIds.has(p.id))`
- Persistência: **session-only**. Refresh = reset intencional. Bury já é
  evento Nostr 9080 público — SoT canônico está em SQLite + relays.
  Estado "vi e afundei agora" é UI ephemera; persistir seria schema
  bump sem ganho real. Manifesto §28 (privacy mínima).

**Files:**
- `src/App.tsx` (~20 LoC adicionadas)
- `Docs/guia-do-usuario.md` (promessa atualizada pra refletir fix)

**Test:** User dá ↓ no post → post some do stack → jump-to-top NÃO
mostra de novo → EndOfFeed.onBack NÃO mostra de novo → refresh do app
mostra novamente (reset intencional).

### 2. Gap C — POST NOP bloqueado no schema gate

**Problema:** POST kind 9078 com `content="{subposts:[]}"` passava
`validatePostShape` (array `[]` é Array.isArray=true) → disparava
`persistPost` → `updateUserActivity` → Sybil resetava
`inactivityDays` farmando NOPs a cada 58 dias.

**Fix shipado:**
- `validatePostShape` em `events.ts` agora rejeita
  `parsed.subposts.length === 0`
- Schema gate impede evento entrar no pipeline: sem row em posts, sem
  update em users.last_active, sem ruído downstream
- Cliente Drift oficial nunca cria POST sem subposts; atacante que
  tenta é bloqueado in-flight

**Files:**
- `src/lib/events.ts:validatePostShape` (3 LoC + comentário Satoshi)

**Validação adicional:** auditoria das 6 chamadas de `updateUserActivity`
confirmou que **kind 0 (profile) NÃO chama updateUserActivity** —
Satoshi audit anterior havia sobrestimado o vetor. Surface real era só
POST `{subposts:[]}`, agora bloqueado.

---

## SPIKE/POC registrados pra próxima sprint

### 3. Gap B — Lens edges `created_at` imutável

**Status:** Item BACKLOG criado: "SPIKE: Lens edges `created_at` imutável"

**Plano:**
- Migration additive: `ALTER TABLE lens_edges ADD COLUMN created_at INTEGER`
- Backfill: `created_at = MIN(updated_at)` por linha (conservative)
- Decay novo: `max(age_since_created, age_since_updated)` em `recomputeLens`
- Test: Sybil re-upsert do mesmo edge não reseta decay
- Estimativa: ~2h spike + ~3h impl + tests

**Defer trigger:** Telemetria mostrar `lens_ppr_decay_enabled` adoption
> 20% OR Sybil edge-refresh attack reportado.

### 4. Gap A — Time-window decay nos reports (insider brigada)

**Status:** Item BACKLOG criado: "POC: time-window decay nos reports"

**Plano candidato:**
- `effective_weight = report_weight × decay(age_report, half_life=24h)`
- Espalhar reports em 5 dias → muito menos peso que 5 reports em 1h
- Diversity bonus (cluster detection) defer Phase 2 (GAP-CLUSTER)

**Bloqueio:** Pair-review Barney+Satoshi+Marshall precisa validar que
time-decay sozinho não vira "moderação atrasada" frustrante pra
denúncias legítimas espontâneas. Re-trigger se caso de brigada real
documentado.

---

## Atualizações em docs canônicos

- `BACKLOG.md` — 2 novos items (SPIKE created_at, POC time-window decay)
- `Docs/known-limitations.md` §5b — atualizado pra refletir fix Gap C
  (PARCIALMENTE FECHADO, surface restante documentada)
- `Docs/guia-do-usuario.md` — SINK promise atualizada pra refletir
  comportamento real pós-fix
- `Docs/sessions/README.md` — entry pra este doc + ao audit Satoshi
  anterior

---

## Veredito DevSec

✅ **SHIPPED:** BUG SINK (promessa cumprida) + Gap C (NOP fechado no
schema gate). Zero breaking changes, tsc 0 errors, tests verdes.

📋 **REGISTRADO:** Gap B (SPIKE) + Gap A (POC) com plano de
implementação concreto + condições de re-trigger.

**Débito técnico tratado:**
- 1 "dizemos que fazemos mas não fazemos" (SINK guia) → agora fazemos
- 1 vetor adversarial fechado (NOP em POST)
- 2 spikes documentados em vez de "será" eterno

---

*Registrado por Satoshi (DevSec mode) dispatch 2026-05-20. Próximo:
user valida fix SINK em Vercel preview.*
