# Docs/sessions — artefatos de sessão de trabalho

Documentos aqui são **registros pontuais** de sessões de análise,
auditoria, conformance check ou conversa sobre uma decisão específica.

**Não são documentação normativa.** Decisões derivadas de cada sessão
são extraídas pra:

- `Docs/manifesto.md` (compromissos de protocolo)
- `Docs/drift-arquitetura-v4.md` (decisões arquiteturais)
- `Docs/<fase>-roadmap.md` (status de execução)
- `Docs/known-limitations.md` (gaps documentados sem fix imediato)
- `CHANGELOG.md` (entregáveis)

Se você quer entender "o que o Drift promete", **leia o manifesto e a
arquitetura**, não estes arquivos. Eles são contexto auxiliar.

## Tipos de sessão

| Tipo | Definição | Lifecycle |
|---|---|---|
| **Audit** | Análise concluída de algo shipped (CWV, design QA, security regression) | Histórico — não muda |
| **Research** | Investigação em progresso, alimenta `Docs/research-backlog.md` | Vivo até virar decisão |
| **Dispatch** | Análise estruturada por persona LLM (Ted/Marshall/Barney/Lily/Robin/Satoshi) | Resultado → `BACKLOG.md` + manifesto/arquitetura |
| **Handoff** | Snapshot de fim de sessão maratona, contexto pro próximo dev/agent | Cronológico — todos preservados |
| **Scoping** | Pre-implementation: requirements + threat model | Histórico (post-ship) |

## Índice temático (atualizado 2026-05-20)

### Trust Lens — Phase 1 (research → ship)
- `zero-trust-survey-ted-2026-05-17.md` — survey acadêmico inicial
- `trust-lens-ted-rfc-2026-05-17.md` — RFC arquitetural Ted
- `trust-lens-L-parameter-ted-2026-05-17.md` — calibração L=6
- `trust-lens-math-review-marshall-2026-05-17.md` — Stage 1 (bugs)
- `trust-lens-math-relatoria-robin-2026-05-17.md` — Stage 2 empirical
- `trust-lens-math-stage3-himym-2026-05-17.md` — Stage 3 consensus
- `trust-lens-himym-reviews-2026-05-17.md` — reviews por persona
- `trust-lens-multilist-barney-2026-05-17.md` — Barney multilist threat
- `trust-lens-multilist-lily-2026-05-17.md` — Lily multilist UX
- `trust-lens-nodes-clusters-ted-2026-05-17.md` — Phase 2 cluster RFC
- `trust-lens-wot-deep-dive-barney-2026-05-17.md` — WoT audit

### Settings friction (Phase 1-6 + Menu Detalhado granular)
- `settings-friction-audit-2026-05-18.md` — audit + framework
- `handoff-2026-05-20-end-of-session.md` §2-4 — Phase 1-6 commits

### Map animation + Visual polish
- `map-animation-himym-2026-05-18.md` — Robin+Lily dispatch

### Security audits (Barney series)
- `barney-cwv-security-regression-2026-05-09.md`
- `barney-nsec-audit-2026-05-15.md`
- `barney-pending-review-2026-05-08.md`
- `barney-relay-health-2026-05-15.md`
- `barney-round-9-10-audit-2026-05-15.md`
- `barney-security-regression-round5-2026-05-08.md`
- `barney-test-posts-2026-05-08.md`

### Performance (Lily + Ted)
- `lily-lcp-analysis-2026-05-15.md`
- `lily-long-task-audit-2026-05-15.md`
- `lily-memory-leak-audit-2026-05-15.md`
- `cwv-final-report-2026-05-09.md`
- `cwv-research-2026-05-09.md`
- `round-11-perf-2026-05-16.md`
- `ted-bundle-audit-2026-05-15.md`

### Infra / Build
- `ci-tauri-multiplatform-2026-05-08.md`
- `deploy-vercel-protection-2026-04-29.md`
- `sri-baseline-2026-05-15.md`
- `webrtc-architecture-audit-2026-05-08.md`

### Design QA + UX
- `design-qa-baseline-2026-05-08.md`
- `design-qa-final-2026-05-08.md`
- `design-qa-regression-2026-05-08.md`
- `friction-audit-post-flow-2026-05-08.md`
- `comments-ux-audit-2026-05-08.md`
- `mobile-ux-research-2026-05-08.md`
- `text-responsivity-audit-2026-05-08.md`
- `ted-ux-spike-deployed-2026-05-08.md`

### Queue / Feed architecture
- `ted-tinder-queue-architecture-2026-05-20.md` — Ted research sobre
  card stack queue patterns (Tinder), aplicado ao Drift feed

### Algorithm audits
- `satoshi-7-algoritmos-audit-2026-05-20.md` — Satoshi adversarial
  audit dos 7 algoritmos documentados (`Docs/algoritmos.md`) — 6/7
  consistentes, 3 game-theory gaps documentados (NOP, insider brigada,
  edge-refresh)
- `satoshi-devsec-mitigations-2026-05-20.md` — Satoshi DevSec mode:
  mitigation plan + 2 fixes shipados (BUG SINK + Gap C NOP) + 2 spikes
  registrados (Gap B edge-refresh schema bump, Gap A time-window decay)
- `ted-promessas-vs-impl-sprint-plan-2026-05-20.md` — Ted audit
  "promessa vs implementação" + design lentes pluggable + Sprint N+1
  plano zero-débito (~8d full-focus)
- `lily-tinder-audit-2026-05-21.md` — Lily audit Ted Tinder doc vs
  código; 2 fixes shipados (queue cap + snapshot age UI), 1 item
  documentado pra futuro (N/2 refill quando feed crescer)
- `content-hash-dedup-deliberation-2026-05-21.md` — Satoshi+Ted dual
  dispatch sobre proposta user "hash content pra evitar spam".
  Decisão: NO-GO atual (Satoshi flagou defesa teatro + Ted Opção B
  arquitetural pronta se reabrir)
- `satoshi-ted-sprint-n2-plan-2026-05-21.md` — sprint N+2 plan
  consolidado (convergência + divergências resolvidas: lentes POC vs
  SPIKE → POC ganhou; smoke test pré-sprint → ACEITO). 8-13d
  buffer-tolerant
- `profile-picture-audit-2026-05-21.md` — Lily audit: feature MVP+1
  incompleta. Publish OK, render no feed faltando (rowToPost omite
  authorAvatar/authorAlias). Fix ~4-6h.
- `satoshi-redundancia-audit-2026-05-21.md` — Satoshi audit 10 cenários:
  7 OK / 3 parciais / 1 não-impl. Top 3 closures Sprint N+2 (~2.5h):
  auto-rebroadcast em addRelay() + auto-pin IPFS + random walk doc.

### Misc
- `15-e2e-testbed-scoping-2026-05-08.md`
- `auto-mode-detection-algorithm-2026-05-08.md`
- `auto-mode-threat-model-2026-05-08.md`
- `i18n-spike-2026-05-17.md` — pre-Phase 1A research
- `opacity-30-audit-2026-05-20.md` — cross-codebase audit
- `robin-docs-drift-audit-2026-05-15.md`
- `round-9-session-summary-2026-05-14.md`
- `sprint7-manual-2026-05-01.md`
- `sprint7-smoke-2026-05-01.md`
- `ted-delegation-plan-2026-05-08.md`
- `ted-review-2026-05-08.md`
- `track-c-debt-scoping-2026-05-08.md`

### Handoffs (cronológico, todos preservados)
- `handoff-2026-05-17-end-of-day.md`
- `handoff-2026-05-20-end-of-session.md`
- `handoff-2026-05-20-late-shift.md` ← mais recente

## Convenção de naming

`<tipo>-<contexto>-<data>.md`. Exemplos:
- `barney-nsec-audit-2026-05-15.md`
- `trust-lens-math-stage3-himym-2026-05-17.md`
- `handoff-2026-05-20-late-shift.md`

Sessões podem referenciar personas LLM (Ted, Marshall, Barney, Lily,
Robin, **Satoshi** = adversarial deep) — ver `CLAUDE.md` § "Método de
desenvolvimento" pra contexto.

## Quando archivar

Mover pra `Docs/archive/` (criar se não existir) quando:
- Fase atrelada ao doc foi shippada **E** estável por ≥30 dias
- Tema foi completamente substituído (ex: V1 design QA antes do reskin V3)
- Research virou decisão e foi extraída pra manifesto/arquitetura/known-limitations

Manter na raiz `Docs/sessions/` itens vivos OR histórico < 30 dias OR
handoffs (sempre preservados).
