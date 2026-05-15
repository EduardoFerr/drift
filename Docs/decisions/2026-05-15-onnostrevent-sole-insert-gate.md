# ADR — `onNostrEvent` como única porta de INSERT em domínio

**Date:** 2026-05-15
**Status:** Established (invariante histórica, locked-via-test em `346e6c4`)
**Manifesto refs:** §5, §6, §7 (eventos imutáveis, verdade por eventos, determinismo)

## Context

Drift é Event Sourcing sobre Nostr. O fluxo canônico é:

```
ESCRITA: UI → Negócio → Protocolo → Nostr → onNostrEvent() → SQLite → invalidateFeed()
LEITURA: UI ← Zustand store ← SQLite
```

`onNostrEvent()` (em `src/lib/events.ts`) recebe todo evento verificado
— vindo de subscribe de relay, broadcast local, ou recovery —, faz
schema check + Schnorr verify + `INSERT OR IGNORE` em domínio +
`scheduleScoreRecalc` + `invalidateFeed()` debounced 150ms.

Outras camadas (UI, hooks, protocolo de publicação) **nunca** falam
direto com `posts`, `spreads`, `buries`, `reports`. Optimistic UI é
`useState` local em React; quando o evento real volta via relay,
optimistic é descartado silenciosamente.

## Problem

Sem essa restrição, três falhas previsíveis aparecem:

1. **Estado divergente entre clientes.** Se a UI escreve direto no
   SQLite, e o evento Nostr nunca é publicado (rede caiu, relay
   recusou), o cliente A vê o post e o cliente B não vê. Quebra §5
   ("eventos são a verdade").

2. **Score não-determinístico.** Se um INSERT pula
   `scheduleScoreRecalc`, o ranking diverge entre dispositivos do
   mesmo user. Quebra §7 (determinismo).

3. **Feed stale.** Sem `invalidateFeed()` casado com o INSERT, a
   `useFeedStore` não re-query a tabela; UI fica congelada até
   próximo evento chegar via relay.

Há exceções controladas pra UPDATE/DELETE locais — `cache.ts:evictOldPosts`
(eviction respeitando spreads + pinned, manifesto §16) e
`moderation.ts:maybeModerate` (score = -999, manifesto §26). Ambas
documentadas em CLAUDE.md invariante §1 e ambas chamam
`invalidateFeed()` explicitamente.

## Decision

`onNostrEvent()` é a **única** porta de **INSERT** nas tabelas de
domínio (`posts`, `spreads`, `buries`, `reports`). UPDATE/DELETE em
domínio são restritos a duas funções nomeadas (eviction, moderation),
ambas obrigadas a chamar `invalidateFeed()`.

Locked-via-test em `tests/conformance-events-gate.test.ts` (`346e6c4`):
grep em `src/**/*.ts` falha o build se qualquer arquivo fora da
allowlist contiver `INSERT INTO posts|spreads|buries|reports`.

Tabelas operacionais (não-domínio) — `identity`, `identities`,
`user_prefs`, `sync_log`, `relays_user`, `peers_known`, `follows` —
seguem regras próprias, fora do gate. Manutenção de cache não cria
estado de domínio novo.

## Consequences

**Positivas:**

- Convergência entre clientes é propriedade emergente: mesmo conjunto
  de eventos → mesmo estado materializado.
- Auditoria simplificada: 1 função, 1 pipeline (kind → schema →
  Schnorr → persist → recalc → invalidate). Threat model fica num
  só ponto.
- Optimistic UI fica honestamente "local" (useState), descartada
  quando truth chega. Sem ghost-state contaminando SQLite.
- Test conformance protege contra reintrodução acidental por
  contributor novo que "só queria inserir um row pra testar".

**Negativas:**

- Latência aparente de criação: user publica → evento sai por
  relay → volta como subscribe → `onNostrEvent` persiste. Para
  cobrir: optimistic UI no componente (descartado quando confirmar).
- Curva de aprendizado pra contributors: "por que não posso só
  `db.run('INSERT ...')` aqui?". Documentação em CLAUDE.md §1 +
  esta ADR mitigam.
- Eviction e moderation precisam disciplina extra (chamar
  `invalidateFeed()` ou stale silencioso). Mitigado por revisão de
  PR e doc explícito em CLAUDE.md §1.

## Alternatives considered

1. **Permitir INSERT direto em hot paths "óbvios"** (criar post na
   UI). Rejeitado: a definição de "óbvio" sangra com o tempo, e
   o pipeline canônico perde a propriedade de ponto único de
   verificação Schnorr.

2. **Camada de repositório com gate em runtime** (todo INSERT passa
   por função `persistEvent()` que chama subscribers). Rejeitado:
   mais código sem mais garantia — runtime gate ainda permite que
   código novo chame `db.run()` direto. Test conformance estático é
   mais forte.

3. **CRDT por tabela.** Rejeitado em §30.2 da arquitetura — Drift
   não tem edições concorrentes, tem eventos imutáveis derivados.

## References

- `src/lib/events.ts` — implementação de `onNostrEvent()`.
- `tests/conformance-events-gate.test.ts` — lock estático (commit `346e6c4`).
- `CLAUDE.md` invariante §1 — doc de contributor.
- `Docs/drift-arquitetura-v4.md` §30.10 (Zustand) — co-decisão (feed reativo via invalidate).
- Manifesto §5 (eventos imutáveis), §6 (verdade por eventos), §7
  (determinismo).
