# Conformance Review — conversa 29-04-2026

> ⚠ **ARTEFATO DE SESSÃO** — registro pontual de auditoria, gerado em
> 2026-04-29. Não é documentação normativa. Decisões derivadas estão
> no `CHANGELOG.md`, `Docs/manifesto.md` e `Docs/drift-arquitetura-v4.md`.
> Personas LLM citadas (Marshall etc.) são papéis assumidos pelo
> Arquiteto — ver `CLAUDE.md` § "Método de desenvolvimento".

**Atribuição original**: validação realizada no papel de "Marshall" (conformance) · **Versão**: 1.0
**Escopo**: validar discussão Gemini/ChatGPT contra invariantes do `CLAUDE.md` e
princípios do `Docs/manifesto.md`. Foco: bug "spread+bury simultâneo", EigenTrust,
ataques Sybil e conformance arquitetural.

---

## 1. Bug de conformance: spread + bury simultâneo do mesmo user

### Verificação no código

| Camada | Arquivo:linha | Comportamento |
|---|---|---|
| UI handler | `src/App.tsx:248-303` (`handleSpread`), `:305+` (`handleBury`) | Bloqueia apenas se há `pending[post.id]` (optimistic em curso). NÃO checa estado já confirmado. |
| Protocolo | `src/lib/protocol.ts:100-115`, `:124-134` | `spreadPost`/`buryPost` apenas montam evento e publicam. **Sem checagem de estado prévio.** |
| Persistência | `src/lib/events.ts:131-166` (`persistSpread`, `persistBury`) | `INSERT OR IGNORE` em duas tabelas independentes. |
| Schema | `src/lib/schema.sql:60-83` | `spreads UNIQUE(post_id, spreader_pub)` e `buries UNIQUE(post_id, burier_pub)` — **independentes**. Não há constraint cruzada. |

**Conclusão**: o cliente permite o mesmo npub espalhar E enterrar o mesmo post.
A nível de **protocolo**, isso está correto e desejado (manifesto §6 — Verdade
por Eventos: cada evento é histórico imutável; mudar de opinião gera segundo
evento). A **falha está no cliente oficial**, que não impõe semântica de
"ação atual" — UI deveria mostrar a última ação prevalente e tratar a anterior
como histórico.

### Efeito no score (verificado em `scoring.ts:29-34`)

Fórmula: `(spreads - buries * 0.3) / (ageHours + 2)^1.5`

Mesmo user spread+bury contribui `1 - 0.3 = +0.7` ao numerador. **Não anula**;
ainda favorece spread. Trade-off documentável, não bug crítico de score.

### Recomendação alinhada ao manifesto

User propôs (linha 470): "apenas a última ação deveria valer". Isso é
**compatível com §6** se implementado como **camada de materialização**
(events.ts) e não no protocolo:

- Protocolo segue aceitando ambos os eventos (imutáveis na rede).
- `persistSpread`/`persistBury` consultam `MAX(created_at)` entre spread e
  bury do mesmo `(post_id, author)` e contam apenas o mais recente nas views
  agregadas (`posts.spreads`/`posts.buries`).
- Pure: `calculateScore` continua determinístico — input vem da view
  reconciliada, igual em todos os clientes que adotem essa regra.

**Ponto crítico**: regra de "última ação vence" precisa ser **especificada no
protocolo Drift** (Docs/drift-arquitetura) ou clientes divergem em score
(viola §7 determinismo, invariante #3).

---

## 2. Ataques simulados

| ID | Ataque | Defesa atual no Drift | Funciona hoje? |
|---|---|---|---|
| **A1** | Mesmo user spread+bury simultâneo | Nenhuma. Score líquido = +0.7 (spread vence) | Sim — bug de UX, baixa severidade |
| **A2** | Sybil engagement: 1000 npubs novos espalham post X | `weight.ts:calculateAntiquity` exige semanas pra peso. Mas `scoring.ts` **conta spreads sem ponderar por peso do spreader** | **Sim — alta severidade**. Score sobe linearmente com Sybils |
| **A3** | Sybil bury pra esconder post-alvo | `moderation.ts` aplica `maybeModerate` em **reports** (não buries); buries só afetam score. Score → -∞ teórico | Parcial. Bury pra censurar não dispara -999, mas afunda no feed. **Média severidade** |
| **A4** | Reputation laundering: 1000 posts internos pra inflar engagement, depois pivot pra spam | `weight.ts:calculateEngagement` usa `spreadsReceived` (não posts feitos). Atacante precisa que **outros** espalhem. Combina com A2: 1000 Sybils espalham 1 npub principal → engagement satura em 60 | **Sim — alta**. Custo = criar Sybils. Sem grafo de confiança, indistinguível |
| **A5** | Auto-spread do próprio post (1 npub espalha próprio post) | `UNIQUE(post_id, spreader_pub)` impede repetir, mas permite 1× | Sim — baixo impacto isolado, combina com A2 |
| **A6** | Eclipse via WebRTC pra suprimir buries de post atacante | Documentado em `webrtc-threats.md` T-WRTC-006/007 (Crítico) — mitigação parcial Fase 6.2 (path diversity) | Sim em 6.1a; mitigado 6.2 |
| **A7** | Report spam coordenado pra disparar -999 em post legítimo | `moderation.ts` usa **threshold dinâmico** (manifesto §26) + `getReportWeight(reporterWeight)` — Sybils novos pesam 0.5 | **Mitigado parcialmente**. Funciona em rede pequena (poucos active users → threshold baixo) |

### Ataques mitigados

- Eventos malformados / kind injection: `events.ts:73-99` `passesSchemaCheck`
  + `verifyDriftEvent` Schnorr (invariante #5).
- Replay cross-event: `INSERT OR IGNORE` por `event.id`.
- Auto-bury duplicado: `UNIQUE(post_id, burier_pub)`.

---

## 3. EigenTrust vs Drift: análise de adoção

### Comparação

| Aspecto | EigenTrust | Drift atual (`weight.ts`) |
|---|---|---|
| Trust input | Histórico de transações peer-to-peer | Antiguidade + spreads recebidos |
| Computação | Iterativa via grafo (random walk / power method) | Função pura local sobre agregado |
| Escopo | **Personalizado por viewer** (trust local) ou global (transitivo) | **Global determinístico** |
| Defesa contra colusão | EigenTrust++ adiciona penalty por feedback inconsistente entre clusters | **Nenhuma** — Drift trata cada npub isolado, sem grafo |

### O que VIOLA o manifesto se aplicado

EigenTrust **personalizado por viewer** computa trust(i, j) baseado em
caminho de confiança específico do viewer i. Isso é **personalização de
ranking** — viola **§11 (Sem afinidade no feed)** e **invariante #11**
do CLAUDE.md. Adoção direta = bolha por similaridade (medo correto do user
na linha 472).

### O que pode ser adaptado sem violar

EigenTrust **global** (uma única matriz de confiança computada igual em
todos os clientes a partir de eventos públicos) é **compatível com §22 e §7**
desde que:

1. Input = só eventos Nostr verificáveis (spreads, buries, posts).
2. Computação = determinística (mesma seed, mesma ordem de iteração).
3. Output = peso global por npub, idêntico em todos clientes.
4. **Não** entra em ranking personalizado de feed (§11/§24).

Aplicação útil: substituir `calculateEngagement` por uma função que **pondera
spreads recebidos pelo peso do spreader** — propaga trust transitivamente,
ataca A2/A4. EigenTrust++ adiciona mitigação anti-colusão (clusters de npubs
que só espalham entre si recebem peso reduzido) — útil contra reputation
laundering.

**Risco**: complexidade de convergência iterativa em SQLite WASM. Recalc
incremental não-trivial. Trade-off vs simplicidade do peso atual.

---

## 4. Recomendações priorizadas

1. **[Bug spread+bury]** Especificar "última ação vence" em
   `Docs/drift-arquitetura-v4.md` + implementar reconciliação em
   `recalculateScore` (events.ts:310). UI bloqueia ação inversa quando há
   pending confirmado. **Não** mudar protocolo.
2. **[A2/A4 Sybil engagement]** Antes de adotar EigenTrust, **ponderar
   spreads pelo peso do spreader** em `scoring.ts` — incremento mínimo,
   determinístico, ataca o vetor mais barato de Sybil. Documentar em
   arquitetura.
3. **[EigenTrust]** Tratar como **fase futura** (pós-7) com PoC em
   `Docs/scoring-eigentrust-poc.md`. Nunca personalizar por viewer.
4. **[A3 bury Sybil pra censurar]** Aplicar mesmo `getReportWeight` em
   buries pra afundar feed — avaliar se viola §23 (bury não pune autor).
   Provavelmente sim — manter como está, atacar via §16 (espalhamento
   distribuído).

---

*~780 palavras · Marshall · 2026-04-29*
