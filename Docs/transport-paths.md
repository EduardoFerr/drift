# Drift — caminhos de publish/subscribe

> Doc normativo · matriz de decisão pra dev escolhendo onde plugar feature.

Drift tem 3 caminhos pra subscribe e 2 pra publish, intencionalmente —
não inércia. Este doc mapeia onde cada caminho vive, quando usar qual, e
o porquê de coexistirem.

## TL;DR — escolha rápida

| Quero… | Use |
|---|---|
| Publicar evento Drift normal (post, spread, bury, report) | `nostr.ts:publishToRelays()` (que chama `orchestrator.publish`) |
| Inscrever no feed global (kinds 9078-9081) | `sync.ts:startSync()` (que chama `orchestrator.subscribe`) |
| Inscrever em filtro custom (rebuild, signaling Nostr) | `wssTransport.subscribe(filter, handlers)` direto |
| Publicar em UM relay específico (rebroadcast oportunista) | `pool.publish([url], event)` direto |
| Adicionar transporte novo (ex: Tor real, IPFS pin) | `orchestrator.registerTransport(t, opts)` em `bootstrap.ts` |

Se nenhum acima cabe: fala com a arquitetura antes de adicionar 4º caminho.

---

## Os 3 caminhos de subscribe

### 1. `orchestrator.subscribe` — caminho canônico

**Quem usa**: `sync.ts:startSync()` (única chamada hoje).

**Comportamento**: fan-out pra TODOS os transports registrados. Cada
transport (WSS, WebRTC) recebe o filter e dispara `onevent` quando vê
match. Orchestrator faz dedup via LRU(1000) por `event.id` — mesmo
evento via 2 transports diferentes só dispara handler 1x.

**Quando usar**: subscribe global do app (feed, sync de identidade
ativa). Eventos que devem chegar via qualquer caminho disponível.

**Quando NÃO usar**: subscribes pontuais com filter específico que
queremos rodar APENAS em WSS clearnet (ex: rebuild de identidade
histórica em relays específicos). Veja caminho 2.

### 2. `wssTransport.subscribe` — direto, sem fan-out

**Quem usa**:
- `webrtc-signaling-nostr.ts` — DMs cifrados de signaling WebRTC.
  Não faz sentido fan-out via WebRTC porque WebRTC PRECISA do
  signaling pra existir.
- (legado: `sync.ts:rebuildIdentityHistory` migrou pro orchestrator,
  mas o pool ainda é exportado pra outros casos pontuais)

**Comportamento**: chama `pool.subscribeMany(readRelays, filter, ...)`
direto. Sem dedup cross-transport.

**Quando usar**: subscriptions que devem rodar APENAS em WSS, ou que
o caller controla diretamente (recebe `Unsubscribe` e quer cancelar
em pontos específicos).

**Quando NÃO usar**: feed normal — orchestrator é o caminho.

### 3. `pool.subscribeMany` direto — escape hatch

**Quem usa**: nenhum chamador "público" hoje. `pool` é re-exportado
de `wss.ts` pra casos especiais que precisam de controle fino do
SimplePool (pool de conexões, lifecycle de WS, etc.).

**Quando usar**: nunca, em código de feature normal. Reservado pra
debug, scripts de migração, ou integração com lib externa que precisa
do pool nativo.

---

## Os 2 caminhos de publish

### 1. `orchestrator.publish` (via `nostr.ts:publishToRelays`)

**Quem usa**: `protocol.ts` (createPost, spreadPost, buryPost,
reportPost) — toda escrita de evento Drift normal.

**Comportamento**: fan-out pra todos os transports registrados.
WSS (peso 10) faz `pool.publish(writeRelays, event)`. WebRTC (peso 5)
distribui pros peers conectados. Resultado agregado é `{ ok, failed,
perRelay[] }` somado dos transports.

**⚠ Caveat (Ted item 2)**: a semântica de `ok` cross-transport é
heterogênea — WSS conta como `ok` quando relay confirma armazenamento;
WebRTC pode contar como `ok` apenas quando peer recebe o frame
(não há ack de re-publicação subsequente). Quando peer count subir
significativamente, considerar separar `publishOk` (relay storage
ack) de `transportDelivered` (peer hop ack).

### 2. `pool.publish` direto

**Quem usa**:
- `rebroadcast.ts:rebroadcastToRelay` — re-broadcast oportunista
  pra UM relay específico que o user acabou de adicionar (manifesto
  §16). Não faz sentido fan-out — alvo é específico.
- `webrtc-signaling-nostr.ts:send` — DMs cifrados via `transport.publish`
  injetado, mas `transport` lá é o `wssTransport` (que internamente
  chama `pool.publish`). Conta como esta categoria.

**Quando usar**: publish dirigido a um conjunto específico de relays,
fora da política de write-relays default. Sempre justificar em
docstring por que não foi pelo orchestrator.

---

## Por que coexistem (intencional)

A tentação de "tudo pelo orchestrator" foi rejeitada por 3 razões:

1. **Signaling WebRTC não pode fan-out via WebRTC** — circular. Tem
   que ir por WSS especificamente.
2. **Rebroadcast oportunista é sobre 1 relay específico** — fan-out
   distorce o ato (objetivo é "este relay novo recebe meu histórico",
   não "todos os relays recebem de novo").
3. **Future-proofing**: quando IPFS pin chegar (Fase 7), vai ser um
   transport no orchestrator. Mas quando alguém precisar pinar UM
   post em UM gateway específico, vai querer escape hatch — manter o
   pattern já aberto evita refactor depois.

## Risco gerenciado

Adicionar 4º caminho = revisar este doc primeiro. Se não estiver
listado aqui e não cair nas 3 razões acima, é porque deveria ir pelo
orchestrator. Se realmente é caso novo, atualizar este doc + manifesto
seção relevante.

Manifesto §12 (múltiplos transportes) + Ted Sprint 5 follow-up.
