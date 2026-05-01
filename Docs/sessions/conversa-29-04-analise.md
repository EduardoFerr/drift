# Análise da conversa 29-04-2026 (Gemini + ChatGPT)

> ⚠ **ARTEFATO DE SESSÃO** — registro pontual gerado em 2026-04-29.
> Não é documentação normativa. Personas LLM citadas (Ted, Marshall)
> são papéis assumidos pelo Arquiteto — ver `CLAUDE.md` § "Método de
> desenvolvimento". Conformance complementar em
> [`conformance-conversa-29-04.md`](conformance-conversa-29-04.md).

Análise arquitetural da conversa do user com Gemini/ChatGPT sobre Drift, salva em `conversa29-04-2026.txt`. Atribuição original: produzida no papel de "Ted" (arquitetura); revisada no papel de "Marshall" (conformance) — ambos no documento companion citado acima.

## Seção 1 — Síntese da Parte 1 (PoI, bootstrap, manifesto)

### O que JÁ ESTÁ na arquitetura

| Ideia (linhas) | Onde já existe |
|---|---|
| PC como relay especializado Drift, kind filter | `Docs/webrtc-seeding.md` cobre filosoficamente; Fase 7 "run-your-own-relay" no manifesto + CLAUDE.md:329 |
| Client como relay local (94-135) | `webrtc-seeding.md:1-60` — Proof of Interest cobre exatamente isso |
| Celular como relay efêmero (137-180) | `webrtc-seeding.md:9-17` (TL;DR) e `:85-100` (modos `lan-wifi-only`, `always-on`) |
| **"Mapa aberto = vira seeder"** (182-231) | `webrtc-seeding.md` inteiro — gatilho `useSpreadMap(postId)` |
| Indicador "você está semeando" | `webrtc-seeding.md:121` — sub-fase 7.1c |
| Bootstrap a partir de relay próprio | manifesto §14 |
| Re-ignição da rede após apagão | manifesto §16 + invariante #13 |

**Veredicto:** ~80% do que Gemini propõe já está documentado/comprometido. Validação externa de design.

### IDEIAS NOVAS aproveitáveis

1. **"Cofre do Gênesis" — PC do Eduardo como guardião perpétuo**: prática operacional (não código). Documentar: "Eduardo opera relay strfry whitelistado em [endpoint] como seed durante Fase 0–4". Ajuda §16.

2. **Postagens de Ancoragem do manifesto** (linhas 406-425): conteúdo real publicado como kind 9078 pelo Arquiteto, citando o manifesto literalmente. Vira material onboarding orgânico (manifesto §882-917 já agendou na Fase 4). **Spawn como tarefa de conteúdo, não código.**

3. **Hard forks pré-comunidade** (446-450): legítimo — manifesto §31 explicitamente trata bumps; estamos em fase confortável pra mudar schema.

### Conflita com manifesto

- **"Acúmulo de Reputação de Rede" + "Conquistas Visuais"** (256-260): gamificação de seeding com pontos visíveis no perfil. **Viola §22** (Score Determinístico, Não Reputação Subjetiva) e tangencia §17. Aceitável: contador local privado de seeding (transparência §28). **Inaceitável**: visível no perfil de outros, ou ponderando peso/score.

- **"Bots de Infraestrutura" (Cronista, Indexador)**: PERIGOSO — viola §22 se "Indexador" categoriza, e potencialmente §11/§24 se vira ranker. Aceitável apenas como nsec separado publicando posts honestos.

- **"Geolocalização Estratégica… mapa de caça ao tesouro"** (424): location é opt-in default OFF (manifesto §28). Se o Arquiteto marca posts próprios com geo, é livre — direito do user. **Não pode** virar feature do cliente que recomenda.

## Seção 2 — Espalhar + enterrar simultâneo (BUG REAL)

### Estado atual do código

`src/App.tsx:248-330`: `handleSpread` e `handleBury` checam `if (pending[post.id]) return` — guarda **apenas a operação em vôo**. Não consulta SQLite. Após o evento confirmar, `pending` é limpo via `useEffect`, e o user pode disparar a ação oposta livremente.

`src/lib/events.ts:131-166` (`persistSpread` / `persistBury`): `INSERT OR IGNORE` em `spreads` e `buries`. **Sem nenhum check** de exclusão mútua: o mesmo `(post_id, userId)` pode ter linha em ambas as tabelas.

`src/lib/protocol.ts`: pure publishers — não consultam estado.

**Bug confirmado:** o cliente permite que `userX` espalhe E enterre o `postY`. Ambos eventos vão pra rede, ambos persistem, **score conta os dois**. Score líquido `+0.7` (spread vence, fórmula `scoring.ts:33`). Não anula. Vetor de manipulação de score.

### Manifesto §23 vs evento contraditório

§23: "Bury reduz score do post (peso 0.3x do spread); bury **não** reduz engajamento do autor". Não diz nada sobre exclusão mútua. Mas §22 (score determinístico) e §11 ("sem afinidade") implicam que o mesmo user contribuir simultaneamente +1 e -0.3 ao mesmo post é semanticamente incoerente.

### Proposta: "última ação vale" (mudança de opinião)

**Restrição imutável:** §5/§6 (eventos imutáveis, append-only). Não dá pra "deletar" o spread anterior.

**Solução:** dedup determinístico no scoring. A função pura conta **uma ação líquida por (postId, userId)** baseada em qual evento tem `created_at` maior (desempate por `event.id` lex).

- `recalculateScore` muda: em vez de `COUNT(*)` em spreads e buries separados, faz `SELECT post_id, spreader_pub, MAX(created_at) FROM spreads UNION ... buries ...` agrupando por `(post_id, user)` e pegando última ação.
- SQL fica feio mas determinístico — mantém §7. Nada some do banco (§13).

**Argumento:** "pessoas mudam de opinião" é legítimo. **Adotar como semântica oficial Drift:** *"O cliente Drift conta a ação mais recente de cada user em cada post. Eventos anteriores ficam no banco e nos relays — auditáveis — mas não duplicam contribuição ao score."*

**Cliente UX:** após espalhar, botão de bury fica disponível. Se clica bury, optimistic mostra -0.3 e some +1. UI fica mais coerente.

**Mitiga ataque:** adversário com 10k Sybils oscilando spread↔bury só conta 1 ação líquida por Sybil. Antes contava 2.

## Seção 3 — EigenTrust análise

### Resumo

**EigenTrust** (Kamvar et al, 2003): trust global em P2P via cálculo iterativo tipo PageRank. Cada peer rateia transações com vizinhos, matriz é normalizada e iterada até convergir num vetor de trust global.

**EigenTrust++** (Fan et al, 2014, "Attack Resilient Trust Management"): adiciona resistência a colusão via **detecção de feedback inconsistente** e **decay de trust** — peers cujo padrão de avaliação destoa estatisticamente do consenso são descontados.

### Comparação com Drift hoje

| Dimensão | EigenTrust | Drift (`scoring.ts` + `weight.ts`) |
|---|---|---|
| Granularidade | trust **entre peers** (subjetivo) | weight **objetivo de identidade** |
| Cálculo | iterativo, convergência global | função pura local |
| Subjetividade | rating sub do peer A pro peer B | zero — só agrega eventos públicos |
| Personalização | trust(A→B) ≠ trust(C→B) | weight(B) único pra todos |

### O que BATE

- Ambos derivam autoridade de comportamento histórico verificável
- EigenTrust++ "decay temporal" já existe como `DAILY_INACTIVE -1` em `weight.ts:75`
- Defesa anti-Sybil ponderada: weight 0 → maxSubposts 1 já é EigenTrust-light (peer novo vale pouco)

### O que ATACA invariantes

- **EigenTrust original calcula trust subjetivo entre pares**: viola §22 frontalmente. Cada cliente teria visão diferente da rede → quebra §7 (determinismo).
- **Personaliza ranking por user**: viola invariante #11 (CLAUDE.md:131-135) e §24. Filter bubble = exatamente o que Drift se propõe a substituir. **NÃO ENTRA NO DRIFT, ponto.**
- **Convergência global iterativa**: requer "estado da rede inteira" — incompatível com cliente local determinístico (invariante #1).

### EigenTrust++ — onde pode ser destilado

Detecção de "spread ring" (grupo de pubkeys que sempre espalham os mesmos posts em janela curta) como **modulador de peso de report** (`getReportWeight` em `moderation.ts`), não como modulador de score do post. Resposta a colusão fica reativa via §26, não preditiva via reputação.

### Risco "bolha por similaridade"

Medo do user é correto: EigenTrust original aplicado a recommendation vira filter bubble. Manifesto §24 escreveu essa proteção: *"Afinidade no feed é o que cria bolha. Estamos construindo o mesmo algoritmo central que o Drift se propõe a substituir."*

**Como extrair valor sem virar bolha:** EigenTrust++ defesa anti-colusão pode informar **detecção de fraude no protocolo de seeding WebRTC** (Fase 6.2) — peer que serve dados inconsistentes com o consenso é flagado pelo `probe.ts`. Trust é **da camada de transporte** (path diversity, §20), não do conteúdo. Lugar legítimo do conceito.

## Seção 4 — Recomendação executiva

### A. Entra no roadmap (curto prazo)

1. **Bug "espalhar+enterrar simultâneo" → Fase 5.x ou 6.0**
   - Mudar `recalculateScore` pra contar ação líquida por `(post_id, user_pub)` via MAX(created_at)
   - Mudar UI: após qualquer ação, oposta fica disponível; pending guarda última ação local
   - Tests em `scoring.test.ts` pro caso "user espalhou e enterrou — vale a última"
   - Documentar em manifesto §23 ou seção nova: "Mudança de opinião"
   - **Tamanho:** ~1 dia. Critério Fase 5.x.

2. **Spread weighted (ponderado por weight do spreader)** — Marshall recomenda como melhoria mínima de scoring:
   - Atacante Sybil novo tem weight ~0 → spread vale ~0
   - Determinístico, simples, ataca vetor mais barato
   - ~0.5 dia

3. **Postagens de Ancoragem do manifesto** — conteúdo real do Arquiteto

### B. Vira spawn-task (Fase 6.2)

4. **EigenTrust++ defesa anti-colusão para `probe.ts` / `peerRegistry.ts`**:
   - Aplicar detecção de desvio estatístico **na camada WebRTC**, não no scoring
   - Já há gancho em `webrtc-seeding.md:109` ("path diversity") + plano 6.2

### C. Descartar

5. **Pontos visuais de "Reputação de Rede" por seeding.** Viola §22. OK contador local privado, sem cross-user.
6. **"Bots de Infraestrutura" do Arquiteto.** Risco de fundador-com-mais-poder (§17/§18).
7. **"Versículo de abertura" novo.** Já temos epigrama no manifesto.
8. **EigenTrust como ranker de feed.** Viola §11/§24. Não-negociável.

### Critical Files

- `src/lib/events.ts` (persistSpread/persistBury — alvo de mudança de semântica)
- `src/lib/scoring.ts` (recalc precisará considerar ação líquida)
- `src/App.tsx` (handleSpread/handleBury — UI da mudança de opinião)
- `Docs/manifesto.md` (registrar §23 estendido)
- `Docs/webrtc-seeding.md` (referência cruzada: validação externa pelo Gemini)
