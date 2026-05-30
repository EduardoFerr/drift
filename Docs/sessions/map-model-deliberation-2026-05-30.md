# Modelo dos 3 mapas — deliberação Satoshi+HIMYM (2026-05-30)

Decisão de design convergida após deliberação (privacidade × honestidade ×
WoT emergente). Toca manifesto §22/§24/§25/§28 + invariante #11.

## Premissa que trava tudo
Evento SPREAD (kind 9079) carrega `[e=post, p=autor, location?]`. **NUNCA "via
quem"**. Logo a transmissão real (quem-viu-de-quem) NÃO existe nos dados —
registrá-la (tag `via`) vazaria o grafo de atenção → deanon. O protocolo
deliberadamente não captura caminho de transmissão (privacy-correct).

## Os 3 modos (distintos)

| Modo | Modelo | Lente? |
|---|---|---|
| **global** | estrela geográfica agregada (origem do post → spreader). Verdade canônica, compartilhada entre clientes. | ❌ nunca |
| **post** | **cascata viral HONESTA**: árvore estimada por tempo+proximidade (`lib/cascade.ts`). origem→spreader = LITERAL; spreader→spreader = `inferred` (tracejado + rótulo §28 "rota estimada"). | ❌ nunca |
| **network** | MINHA WoT emergente (PPR local) + sinais mecânicos pra podar a rede (pontes K=1, cluster isolado, filtro-hit). | ✅ só aqui |

## Princípios fixados
- **Lente só no network** (§24): canônico (global/post) nunca personalizado.
  `s_local` nunca persiste em `posts.score`, nunca vai pro Nostr (invariante #11).
- **Cascata = estimativa rotulada** (§28): nunca afirma transmissão registrada.
  A "sensação de infecção" vem do eixo TEMPORAL (scrubber), não de elos falsos.
- **WoT emergente, observador-relativo** (§17/§25): não existe "a rede decidiu".
  PPR brota da topologia pública vista do MEU nó. Tua lente ≠ minha lente →
  sem verdade global = sem chave-mestra. Anti-Sybil de graça (Sybil sem aresta
  de entrada da minha rede confiável → PPR ~0).
- **Saúde da rede = MECÂNICA, não moral** (§22/§25): "PPR baixo na sua lente",
  "ponte K=1", "cluster isolado" — descritivo, EU decido podar. NUNCA rótulo
  "saudável/tóxico" na pessoa (= reputação subjetiva / chave-mestra). NO-GO.

## NO-GOs registrados
- tag `via` (cadeia de transmissão registrada) → vaza grafo de atenção.
- rótulo moral "saudável/tóxico" em pessoa → reputação §22 + chave-mestra §25.
- lente no global/post → feed canônico personalizado §24.

## Implementação (fases)
- ✅ **Fase 1** (commit pendente): post → árvore honesta (`lib/cascade.ts` +
  arcos `inferred` tracejados + rótulo §28 no MapExplainer). Unit lock
  `tests/cascade.test.ts` (6) + E2E `propagation-model.spec` reescrito (5/5).
- ⏳ **Fase 2**: network → `lib/wot.ts` (PPR real + pontes K=1 + cluster +
  filtro-hit), cores mecânicas, lente gateada SÓ no network (hoje
  `lens_show_in_map` pode pintar global → restringir).
