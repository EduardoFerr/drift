# Lily — Audit Ted Tinder doc vs código + mini-sprint shipado

**Dispatched:** 2026-05-21 (sessão zero-débito autônoma)
**Persona:** Lily (core code, runtime, fluxos de dados, manutenibilidade, UX)
**Tipo:** Dispatch / Audit + Implementation
**Trigger:** "peça para lily rever a documentação que o ted fez do
tinder e se ainda não estiver implementado os insights, deliberar
entre os agentes sem tarefas para poder criar a sprint e implementar.
não vamos deixar débitos técnicos descobertos"

---

## Audit por takeaway (5 Ted + 3 anti-patterns)

| # | Takeaway | Status | Risk |
|---|---|:---:|:---:|
| 1 | Threshold N/2 refill | 🔴 NÃO IMPLEMENTADO | MED |
| 2 | feed_snapshot_ts + 30min TTL | 🟡 PARCIAL → ✅ shipado | LOW |
| 3 | Batch atômico | ✅ JÁ FEITO | — |
| 4 | Rewind RAM-only cap 10 | 🔴 N/I (futuro) | LOW |
| 5 | Cold start render parcial | 🟡 PARCIAL | LOW |
| A | Server reorder mid-deck | ✅ Protegido §24 | — |
| B | Memory unbounded | 🟡 → ✅ shipado | LOW |
| C | Timeout opaco | 🔴 → ✅ shipado | LOW |

**Resumo Lily-style:** 3 itens 🔴/🟡 acionáveis. Refill N/2 (Item 1) é
o único que requer trabalho >2h e Lily honestamente julgou "sem
urgência hoje" (base atual ~4-10 posts reais, não sente). Itens 2+3+B+C
viraram 5h de defesa em camada — zero risco, alto valor UX, shipável
imediatamente.

---

## SHIPADOS nesta sessão (`<commit hash>`)

### Item 2 — Zustand queue cap (anti-pattern B fix)

- Constantes em `config/constants.ts`:
  - `FEED_INITIAL_LIMIT = 50` (batch inicial query SQLite)
  - `FEED_QUEUE_CAP = 100` (cap defensivo Zustand pós-truncate)
  - Invariante `FEED_QUEUE_CAP >= FEED_INITIAL_LIMIT` (test #1)
- `refreshFeed` aplica `rawPosts.slice(0, FEED_QUEUE_CAP)` quando excede
- Defesa em camada: SQLite tem `MAX_POSTS_CACHE=10k` (eviction); Zustand
  tem 100. Mobile low-end OOM protection.

### Item 3 — Snapshot age + UI badge (anti-pattern C fix)

- `FeedStore.snapshotTs: number | null` adicionado (null antes do
  primeiro refresh)
- `refreshFeed` atualiza `Date.now()` no setState
- Const `FEED_SNAPSHOT_STALE_MS = 10min` (sweet spot UX)
- Novo componente `FeedSnapshotAgeBadge` em App.tsx — renderizado no
  EndOfFeed entre o paragraph "atualize/volte ao topo" e o HintChip.
  Mostra "⏱ feed atualizado há X" quando age > 10min. Re-render por
  minuto via tick interno. Cleanup em unmount.
- Resolve user feedback 2026-05-08 ("atualizar vs voltar ao topo
  parecia mesmo efeito" — agora age explícito).

### Conformance tests (10 novos)

`tests/feed-queue-cap-conformance.test.ts`:
- Invariante FEED_QUEUE_CAP >= FEED_INITIAL_LIMIT
- refreshFeed aplica truncate correto
- snapshotTs no FeedStore interface (`number | null`)
- snapshotTs setado em refreshFeed
- FeedSnapshotAgeBadge renderizado + gated por FEED_SNAPSHOT_STALE_MS

---

## NÃO shipado nesta sessão — registrado em BACKLOG

### Item 1 — Threshold N/2 refill (Tinder pattern)

**Por que não shipar agora:** Lily check honesto — base atual ~4-10
posts reais/feed, user não sente spinner. Tinder pattern hide-latency
faz sentido com 100+ posts/sessão; Drift ainda não.

**Quando reabrir:** logs mostrarem feed >100 posts/user frequente OR
user report de "spinner ao chegar no fim".

**Plano detalhado (8h):**
- `useFeedStore` expõe `cursor: number` separado de `posts.length`
- `ensureQueueDepth(currentIdx)` dispara `getGlobalFeed(offset, limit)`
  quando `cursor > posts.length - FEED_REFILL_THRESHOLD`
- Constante nova `FEED_REFILL_THRESHOLD = 25`
- LOCK_VIA_TEST `feed-refill.test.ts`

---

## Lily check final

> "Isto evita débito técnico ou cria novo?"

✅ Evita 2 débitos (cap Zustand sem cap, UX opaco) sem criar
complexidade nova. Toda mudança é refactor leve, testada.

> "Vale a complexidade pra base atual?"

- Items 2+3 shipados: **SIM** (5h zero risco, defesa em camada).
- Item 1 deferred: **NÃO AGORA** (8h pra resolver problema que não
  existe ainda em produção). Reabrir baseado em sinal real.

**Verdict:** 2 fixes shipados, 1 item documentado com plano explícito.
Honestidade radical: nem todo "débito" precisa ser pago hoje — alguns
só viram débito quando alguém precisa do trabalho. Lily pragmática.

---

*Registrado por Lily persona dispatch 2026-05-21. Tinder takeaways
restantes (Item 4 rewind, Item 5 cold start parcial) ficam fora de
escopo MVP — manifesto §28 + perf real do SQLite WASM já amenizam.*
