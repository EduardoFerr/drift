# Architecture Decision Records — Índice

> last-updated: 2026-05-15 · curador: Robin (research)

Esta página lista todos os ADRs (Architecture Decision Records) do
Drift e cataloga decisões arquiteturais relevantes que **ainda não
têm ADR dedicada** (vivendo hoje em `manifesto.md`,
`drift-arquitetura-v4.md` §30.x, ou commits + CLAUDE.md invariantes).

Convenções e quando criar uma ADR estão em [README.md](README.md).

---

## ADRs aceitas

| Data | ADR | Status | Resumo |
|------|-----|--------|--------|
| 2026-05-15 | [F-09 PostViewer body tap removido](2026-05-15-f09-removal.md) | Accepted | Tap em área neutra do card não avança mais subpost; nav exclusivamente via swipe horizontal + Instagram-style bar. Resolve disputa arquitetural entre lightbox/swipe/tap-cycle. |
| 2026-05-15 | [`onNostrEvent` como única porta de INSERT](2026-05-15-onnostrevent-sole-insert-gate.md) | Established | Tabelas de domínio (posts/spreads/buries/reports) recebem INSERT só via `onNostrEvent()`. Locked-via-test em `346e6c4`. Garante convergência e determinismo. |
| 2026-05-15 | [CSP estrita em produção](2026-05-15-strict-csp.md) | Accepted | CSP restritiva no `vercel.json` com cada diretiva permissiva justificada em `Docs/security/csp-policy-2026-05-15.md`. Bloqueia exfiltração de master key via XSS / injeção de telemetria externa. |
| 2026-05-15 | [Sourcemaps strippados em produção](2026-05-15-sourcemaps-stripped-prod.md) | Accepted | `build.sourcemap = 'hidden'` + `scripts/strip-sourcemaps.mjs` + 4 invariantes conformance. Anti-telemetria + dist.zip ~14MB menor. |
| 2026-05-15 | [LazyMotion + `m.*` + `domAnimation`](2026-05-15-lazymotion-m-migration.md) | Accepted | Migração `motion.*` → `m.*` + pointer events nativos em SwipeHandler/ReplySheet → `domAnimation` em vez de `domMax`. Entry chunk 308 → 200 KB. |
| 2026-05-15 | [Multi-identidade compartilha master key](2026-05-15-multi-identity-shared-master-key.md) | Established | 1 master key AES-GCM por device cifra N nsec em `identities`. Trade-off documentado: UX baixa fricção vs isolation per-identity. Cliente alternativo pode implementar isolation. |

---

## Decisões já documentadas — não precisam de ADR dedicada

Estas decisões têm tratamento canônico no manifesto, na arquitetura
ou nos invariantes do `CLAUDE.md`. ADRs novas só fazem sentido se a
decisão for **revista, parcialmente revertida ou complementada**.

| Decisão | Tratada em | Comentário |
|---------|------------|------------|
| Nostr como transporte primário | `drift-arquitetura-v4.md` §30.3 | Decisão fundadora; ADR redundante. |
| SQLite WASM vs IndexedDB | `drift-arquitetura-v4.md` §30.4 | Notion benchmark + 20% perf; ADR redundante. |
| Gun.js descartado | `drift-arquitetura-v4.md` §30.1 + manifesto "tecnologias proibidas" | Decisão duplicaria. |
| CRDT (Automerge/Yjs) descartado | `drift-arquitetura-v4.md` §30.2 | Decisão duplicaria. |
| Kinds 9078..9081 (regular events vs 30078+ replaceable) | `drift-arquitetura-v4.md` §30.6 | Tem racional + alternativas — qualidade de ADR já. |
| Inicialização robusta do worker SQLite + bootstrap singleton | `drift-arquitetura-v4.md` §30.7 + `CLAUDE.md` "Bootstrap fora do React" | Pragmatic; bem documentado. |
| Portabilidade de identidade (Fase 2.5) | `drift-arquitetura-v4.md` §30.8 + `CLAUDE.md` invariantes §8, §9 | Coberta. |
| Compromisso vinculante do manifesto (Fase 6) | `drift-arquitetura-v4.md` §30.9 + `manifesto.md` v2.2 | Coberta. |
| Estado reativo via Zustand sem poll | `drift-arquitetura-v4.md` §30.10 + `CLAUDE.md` §10 + padrões Zustand | Coberta (mas tem co-decisão com ADR `onNostrEvent`). |
| Sem scan automático no cliente oficial | `drift-arquitetura-v4.md` §30.11 + manifesto §25 + `CLAUDE.md` §7 | Densamente coberta. |
| Anti-Sybil dentro do transport (não DDP paralelo) | `drift-arquitetura-v4.md` §30.12 + manifesto §20 | Coberta (RFC formal histórico). |
| BIP39 (NIP-06) + Passkey como opt-ins | `drift-arquitetura-v4.md` §30.13 | Coberta. |
| Score recalc debounced 100ms | `CLAUDE.md` invariante §6 + `src/lib/events.ts:scheduleScoreRecalc` | Otimização documentada; ADR overkill. |
| Optimistic UI nunca alimenta SQLite | `CLAUDE.md` invariante §2 | Curto, claro, locked por convenção. |
| Funções puras pra negócio (determinismo §7) | `CLAUDE.md` invariante §3 + tests Vitest | Coberta. |
| Pipeline `onNostrEvent` (kind → schema → Schnorr → persist → recalc) | `CLAUDE.md` invariante §5 | Coberta; ordem documentada. |
| Compatibilidade NIP-01 sem extensões obrigatórias | `manifesto.md` §28-30 + `drift-arquitetura-v4.md` §30.12-13 + `CLAUDE.md` §14 | Coberta. |
| Relays dinâmicos via `relays_user` (não hardcode pós-seed) | `CLAUDE.md` invariante §17 + `src/lib/relays.ts` | Coberta. |

---

## Decisões pendentes de ADR (gaps reconhecidos)

Decisões reais com racional não-óbvio que **ainda não estão formalizadas**
em ADR nem cobertas adequadamente em outro doc canônico. Candidatas a
ADRs futuras — prioridade pelo risco de "virar folclore".

| Decisão | Tratada hoje em | Por que merece ADR | Prio |
|---------|-----------------|--------------------|------|
| Pointer events nativos em swipe (Framer drag descartado) | Commits `b31fc4b` + `1d0c998` + ADR LazyMotion (parcial) | LazyMotion ADR cobre o "porquê" via budget de bundle; aspecto de gesture-ownership (real root cause de bugs `4f4ed83`, `017b3cb`, `d2ff4fd`) merece ADR técnica própria. | média |
| `relay-health` adaptativo (demote flaky + HTTPS pre-probe NIP-11) | Commits `dd3f147` + `4ce500b` | Behavior surprising (relays não-listados num boot voltam noutro); contributor pode pensar que é bug. | média |
| App-level Error Boundary com recovery actions | Commit `ec68878` | Decisão de UX postural — "user reproduz crash localmente" — derivada de §4 (anti-telemetria). Tie-in interessante mas curto. | baixa |
| SRI (Subresource Integrity) baseline em dist artifacts | Commit `e6f90a8` + status line "SRI sha384 baseline" | Postura anti-tampering pra distribuição via mirror/CDN não-confiável; cumpre §17. | média |
| BIP39 (NIP-06) + Passkey opt-in *como ADR formal* | `drift-arquitetura-v4.md` §30.13 | §30.13 é denso e tem todos os ingredientes; promover a ADR dedicada melhora discoverability sem reescrever conteúdo. | baixa |
| Eviction de cache respeita spreads + pinned | `CLAUDE.md` invariante §1 exceção + manifesto §16 + `src/lib/cache.ts` | Decisão sensível (apaga dados locais!) com cláusula crítica (NUNCA evict post espalhado). Vale ADR pra blindar contra "otimização" futura que ignore a cláusula. | alta |
| Moderation via threshold dinâmico + score = -999 (NÃO delete) | `CLAUDE.md` invariantes §1 e §13 + manifesto §26 + `src/lib/moderation.ts` | Distinção "esconder vs deletar" é compromisso forte. ADR formal protege contra "simplificação" futura. | alta |
| Lazy bootstrap (webrtc/tor diferidos pra `requestIdleCallback`) | Commits `714385a` + `8a27a7e` | Decisão de boot-order com impacto em first paint + manifesto §15 (anti-censura disponível mas não no critical path). | baixa |
| `kvvfs` fallback (Safari/iOS sem OPFS) | `drift-arquitetura-v4.md` §30 menção + bootstrap | Fallback silencioso que muda durabilidade; user/dev deveria saber por contrato. | média |
| Auto-classificação `content-warning` (Compose informativo TM-3) | Commit `b68b240` + manifesto §27 | Distinção entre informar autor vs forçar tag = manifesto §25/§27 borderline; vale ADR. | baixa |
| Long-press 5s = abrir moderação | Commit `a6e517f` + `2297f14` (label 600ms) | Decisão de UX/safety (acidente pra reportar próprio post). | baixa |

---

## Como propor uma nova ADR

1. Crie `YYYY-MM-DD-slug.md` seguindo template em [README.md](README.md).
2. Atualize esta tabela ("ADRs aceitas") na PR.
3. Se a ADR substitui ou contradiz uma anterior, marque a antiga como
   `Superseded by <link>` (nunca apaga).
