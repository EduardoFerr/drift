# Robin — Docs Drift Audit

**Date:** 2026-05-15
**Auditor:** Robin (research/docs) — análise estruturada
**Scope:** `Docs/` raiz (excl. `archive/`) + `README.md` + `CLAUDE.md` + `CHANGELOG.md`
**Método:** Cross-check de referências (file paths, function names, version
numbers, contagens, status de fase) contra `src/`, `package.json` e
output real de `npm run test`.

---

## Sumário executivo

- **Estado real do projeto (2026-05-15)**: 1032 tests passing + 6 todo
  (1038 total) em 79 test files. `@sqlite.org/sqlite-wasm 3.51.2-build9`
  pinado. React 18.3, Vitest 4.1.5, TypeScript 5.5.
- **Drifts encontrados**: 6 críticos 🔴 (contagem de tests
  desatualizada em docs canônicos), 4 menores 🟡 (datas stale,
  estatísticas cosméticas), 0 estilísticos.
- **Drifts fixados inline**: 6/6 críticos resolvidos nesta sessão
  (README.md, CLAUDE.md, drift-arquitetura-v4.md,
  manifesto-coverage-matrix-2026-05-15.md).
- **Pendente pra sprint futuro**: drifts 🟡 cosméticos (INDEX last-updated,
  CHANGELOG entries históricas com `399 tests`, RFC perf round-10 ainda
  cita 980).

---

## Estado real verificado

| Item | Doc-claim típico | Estado real (2026-05-15) |
|------|-----------------|-------------------------|
| Tests passing | "980" ou "399" | **1032** (+ 6 todo) |
| Test files | "74 files" | **79 files** |
| Stack React | "React 18" | ✅ React `^18.3.0` |
| `sqlite-wasm` | "3.51.2-build9 (PIN)" | ✅ pin exato em package.json |
| `nostr-tools` | "v2" | ✅ `^2.7.0` |
| Vitest | "Vitest" | ✅ `^4.1.5` |
| Versão do projeto | "0.6.0-alpha.4" | ✅ |
| Invariantes CLAUDE.md | "17 invariantes" | ✅ 17 (1..17, last = Relays dinâmicos) |
| `src/lib/transport/` | `wss.ts`, `tor.ts`, `webrtc/` | ✅ todos existem |
| `src/lib/transport/bundle.ts` | citado em arquitetura §31.3, §32 | ⛔ ainda não existe (Fase 6 future) — citação framed como roadmap, OK |
| `lib/identity.ts`, `lib/identities.ts`, `lib/sync.ts`, `lib/scoring.ts`, `lib/feed.ts`, `lib/protocol.ts`, `lib/events.ts`, `lib/cache.ts`, `lib/probe.ts`, `lib/rebroadcast.ts`, `lib/nip65.ts`, `lib/follows.ts`, `lib/bip39.ts`, `lib/passkey.ts` | citados em manifesto/arquitetura/CLAUDE | ✅ todos existem |
| `src/components/Identity/IdentityPanel.tsx` | arquitetura §5.6 | ✅ existe (+ `IdentitySwitcher.tsx`) |
| CSS classes `drift-spread`/`drift-bury` | design-system §1 | ✅ 17 files usam |

---

## Drifts encontrados — por severidade

### 🔴 Críticos (corrigidos inline nesta sessão)

#### D1. `README.md:105` — test count desatualizado (399 vs 1032)
- **Antes:** `npm run test  # 399 tests Vitest — funções puras (...)`
- **Depois:** `npm run test  # 1032 tests Vitest (+6 todo, 79 files) — funções puras (...)`
- **Por quê é crítico:** README é a porta de entrada de novo contributor;
  cita comando + número que parece factual mas tem 633 tests de drift.

#### D2. `README.md:152` — Fase 5 claim "399 tests Vitest" como current
- **Antes:** `Fase 5 — ... feed tabs, kvvfs fallback, **399 tests Vitest**`
- **Depois:** `Fase 5 — ... feed tabs, kvvfs fallback (399 tests Vitest
  no fechamento da fase; **1032 atuais** após Fase 6 + hardening)`
- **Por quê:** "399 tests" estava ambíguo (milestone vs current). Agora
  explicita o snapshot histórico + estado atual.

#### D3. `CLAUDE.md:512` — footer claim "980 tests Vitest (+6 todo, 74 files)"
- **Antes:** `980 tests Vitest (+6 todo, 74 files)`
- **Depois:** `1032 tests Vitest (+6 todo, 79 files)`
- **Por quê:** CLAUDE.md é a fonte de contexto pra agents — número
  desatualizado vira referência circular em outras docs.

#### D4. `Docs/drift-arquitetura-v4.md:1795` — "399 tests passando"
- **Antes:** `**Cobertura atual** (\`tests/*.test.ts\`, 399 tests passando):`
- **Depois:** `**Cobertura atual** (\`tests/*.test.ts\`, 1032 tests
  passando · 79 files · +6 todo):`
- **Por quê:** arquitetura é a fonte da verdade técnica; lista de
  cobertura por arquivo continua válida, só o número total estava stale.

#### D5. `Docs/manifesto-coverage-matrix-2026-05-15.md:7` — header com 980
- **Antes:** `**Tests Vitest**: 980 (+6 todo, 74 files)`
- **Depois:** `**Tests Vitest**: 1032 (+6 todo, 79 files)`
- **Por quê:** Doc criado HOJE (2026-05-15) mas com baseline antiga.
  Atualizado pra refletir estado verificado por `npm run test`.

#### D6. `Docs/manifesto-coverage-matrix-2026-05-15.md:105` — §34 cell
- **Antes:** `... pipeline \`onNostrEvent\` linear documentado; 980 tests reproduzíveis`
- **Depois:** `... 1032 tests reproduzíveis`

---

### 🟡 Menores (pendentes — não fixados nesta sessão)

#### M1. `Docs/INDEX.md:3` — `last-updated: 2026-04-29` stale
- **Estado:** 17 dias depois do índice; doc continua estruturalmente
  correto mas data sugere desatualizado mais do que está.
- **Recomendação:** próxima sessão de docs (`/loop` da Robin) — passar
  pra `2026-05-15` E auditar refs de "Por sessão" pós-Round 9/10.
- **Por que adiar:** mudança de data sem revisar referências internas
  seria pior que stale honesto.

#### M2. `Docs/INDEX.md:30` — claim "17 invariantes operacionais (abril 2026)"
- **Estado:** ✅ 17 invariantes confirmadas em CLAUDE.md (verificado
  por grep `### \d+\.`); só a data "(abril 2026)" desatualizou.
- **Recomendação:** trocar pra "(maio 2026)" na próxima passada de INDEX.

#### M3. `Docs/rfcs/2026-05-rfc-perf-architecture-round-10.md:40, :292, :476`
— ainda cita "980 tests" como baseline atual
- **Estado:** RFC histórico de planning round-10 (já executado). Cita 980
  como input do plano.
- **Recomendação:** **NÃO editar** — RFC é histórico de decisão num
  ponto no tempo. Próximo RFC pode citar baseline novo se quiser.
  Conforme regra "conservador em RFCs antigos".

#### M4. `CHANGELOG.md:9, :65, :246, :280` — entries `[0.6.0-alpha.4]`
citam "399 → 444 passing" e similares
- **Estado:** CHANGELOG entries são imutáveis por design (Keep a
  Changelog). Cada entry descreve o estado **da release**, não o atual.
- **Recomendação:** **NÃO editar** — modificar entries de release
  passada quebra a semântica do CHANGELOG. Próxima release (`[Unreleased]`
  → `0.6.0-alpha.5`) deve mencionar baseline novo (~1032).

---

### 🟢 Estilísticos (não-actionable)

Nenhum drift estilístico significativo encontrado. Vocabulário SPREAD/BURY
vs DRIFT/SINK consistente em manifesto, protocol-spec, design-system e
código (LOCK_VIA_TEST mantém a invariante).

---

## Anti-findings (validados como OK)

Coisas que pareciam suspeitas mas estão corretas:

1. **`Docs/drift-arquitetura-v4.md` §31.3 e §32 citam `lib/transport/bundle.ts`** —
   esse arquivo não existe em `src/lib/transport/`. Mas o contexto é
   explícito "(Fase 6)" + "Sneakernet de Último Recurso" — não é
   afirmação de estado atual, é roadmap. ✅ OK.

2. **`Docs/manifesto.md:69` `src/lib/identity.ts`** — existe, e
   `getOrCreateIdentity` é a função citada. Verificado por grep no src/.

3. **`Docs/INDEX.md` claim "34 princípios"** — manifesto.md tem
   exatamente 34 princípios. ✅.

4. **README claim "Fase 6 em curso (6.4 etapas 1-4 shipped pra
   source-builders)"** — bate com `Docs/INDEX.md:38` e
   `Docs/webrtc-6.4-plan.md` (consultado indiretamente via INDEX).

5. **`Docs/protocol-spec.md` § kinds 9078..9081** — tabela bate com
   `src/lib/protocol.ts` + tests `protocol/kinds`. ✅.

6. **CLAUDE.md "17 invariantes"** — confirmado via grep:
   1. onNostrEvent porta única
   2. Optimistic UI nunca alimenta SQLite
   3. Funções puras pra negócio
   4. SQLite roda em Web Worker
   5. Pipeline ordem importa
   6. Recalc de score debounced
   7. Sem scan automático
   8. nsec NUNCA sai do dispositivo
   9. Identidade portável
   10. Estado reativo Zustand
   11. Sem afinidade no feed
   12. Sem chave mestra
   13. Cliente NÃO deleta dados moderados
   14. Compatibilidade ecosystem Nostr
   15. Multi-identidade não confunde pipeline
   16. Funções puras críticas têm tests Vitest
   17. Relays dinâmicos sem hardcode
   = 17 ✅.

---

## Decisão de design — política de drift management

A partir desta auditoria, fica recomendado:

1. **Test count** vive em UM lugar canônico atualizado:
   `manifesto-coverage-matrix-*.md` (mais recente). Outros docs devem
   ou (a) não citar número absoluto, ou (b) citar com data
   ("1032 em 2026-05-15"). RFCs e CHANGELOG são exceção (são
   históricos por design).

2. **File paths em docs** valem a pena via grep estático em CI no
   futuro — script que extrai `\`src/lib/[\w/]+\.ts\`` e valida
   existência. Não-bloqueante pra esta sessão.

3. **Convention review**: docs com datas no header (`last-updated:`)
   devem ser auditadas a cada 30 dias. Robin owns INDEX.md.

---

## Commit gerado

`docs(audit): fix critical drifts em Docs/* + auditoria completa`

Arquivos modificados:
- `README.md` (D1, D2)
- `CLAUDE.md` (D3)
- `Docs/drift-arquitetura-v4.md` (D4)
- `Docs/manifesto-coverage-matrix-2026-05-15.md` (D5, D6)
- `Docs/sessions/robin-docs-drift-audit-2026-05-15.md` (este doc, novo)
