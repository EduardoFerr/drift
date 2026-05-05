# Drift — Protocol Specification

**License:** CC0 1.0 Universal (public domain dedication).
**Status:** descritivo. Esta especificação documenta o que o protocolo
Drift é; qualquer cliente que cumpra o que está aqui é um cliente
Drift. Esta spec não cobre nem prescreve detalhes de UI, persistência
local, ou stack de implementação — esses são escolhas da implementação.

---

## 1. Sumário

Drift é um sub-protocolo construído sobre [Nostr](https://github.com/nostr-protocol/nips)
(NIP-01). Define quatro `kind`s na faixa de regular events imutáveis
(1–9999):

| Kind | Nome (spec) | Label UI | Função |
|------|-------------|----------|--------|
| 9078 | POST        | (post)   | publicar conteúdo |
| 9079 | SPREAD      | DRIFT (↑) | sinalizar interesse positivo |
| 9080 | BURY        | SINK (↓)  | sinalizar interesse negativo |
| 9081 | REPORT      | (report)  | reportar conteúdo a comunidade |

**Convenção léxica.** Spec, código e manifesto usam **SPREAD** e **BURY**
(nomes técnicos eternos, gravados em eventos imutáveis). UI user-facing
usa **DRIFT**, **SINK** e **DERIVA** (substantivo da métrica de score).
Mantida separação evita refactor cascata em refs de protocolo quando UI
copy muda. Glossário em [`design-system.md`](design-system.md) §1.

Drift assume conformidade NIP-01 sem extensões obrigatórias. Eventos
Drift coexistem com eventos `kind: 1` e outros — clientes Nostr não
Drift os ignoram silenciosamente; clientes Drift filtram pelos kinds
listados.

## 2. Princípios

Toda implementação cliente Drift cumpre:

1. **Eventos imutáveis.** Não há `kind: 5` (delete request) tratado
   como autoritativo; cliente Drift exibe ou não, mas não apaga.
2. **Score determinístico.** Ranking é função pura dos eventos
   recebidos. Mesma entrada → mesmo ranking. Sem afinidade por usuário,
   sem personalização, sem "feed por bolha".
3. **Sem chave mestra.** Não existe entidade com poder de remover
   conteúdo, banir usuário globalmente, ou modificar score
   centralmente. Clientes que adicionam tais poderes não são clientes
   Drift conformes.
4. **Verificação Schnorr.** Todo evento é verificado conforme NIP-01
   antes de ser processado. Verificação inválida = evento descartado.
5. **Identidade portável.** Identidade Drift = `nsec1` secp256k1
   conforme Nostr. Funciona em qualquer cliente Nostr sem perda de
   dados na rede.

Princípios extensos em [manifesto.md](manifesto.md).

## 3. Kind 9078 — POST

```json
{
  "kind": 9078,
  "tags": [
    ["d", "<post-id-curto>"],
    ["drift-version", "1"],
    ["client", "<nome-cliente>", "<versao>"],
    ["category", "<categoria-opt>"],
    ["location", "<geohash-opt>", "<granularidade-opt>"],
    ["content-warning", "nsfw|violence|spoiler|ad"]
  ],
  "content": "<JSON>",
  "pubkey": "<32-byte-hex>",
  "created_at": <unix-seconds>,
  "id": "<32-byte-hex>",
  "sig": "<64-byte-hex>"
}
```

**Tags obrigatórias:**

- `d`: identificador curto único por pubkey (não confundir com `id` do
  evento; usado pra subposts e referências internas).
- `drift-version`: distingue eventos Drift de outros kinds 9078 que
  possam aparecer (currently `"1"`).

**Tags opcionais:**

- `client`: identificação livre da implementação que assinou o evento.
- `category`: categoria livre do post.
- `location`: geohash conforme NIP-52, com indicador de granularidade
  (precisão reduzida intencional pra preservar privacidade).
- `content-warning`: auto-classificação **voluntária** do autor.
  Manifesto §27. Cliente leitor decide o que fazer (blur, esconder,
  mostrar) — política local, não remota.

**Content:** JSON serializado com a estrutura:

```json
{
  "subposts": [
    {
      "text": "<string>",
      "media": [{"url": "...", "hash": "...", "alt": "..."}]
    }
  ]
}
```

Múltiplos subposts permitem fluxo "swipe lateral" entre cards de um
mesmo post. Implementações com UI diferente podem mapear como entender.

## 4. Kind 9079 — SPREAD

```json
{
  "kind": 9079,
  "tags": [
    ["e", "<post-id>"],
    ["p", "<author-pubkey>"],
    ["location", "<geohash-opt>"]
  ],
  "content": "",
  ...
}
```

Sinaliza que o `pubkey` do evento espalha o post `e`. Equivale ao
"like" social mas com semântica de **redistribuição** — espalhar
implica ofertar-se como peer disposto a servir esse conteúdo (ver
manifesto §16).

`content` é string vazia; toda informação está nas tags.

## 5. Kind 9080 — BURY

```json
{
  "kind": 9080,
  "tags": [["e", "<post-id>"]],
  "content": "",
  ...
}
```

Sinaliza desinteresse. **Bury não pune** — manifesto §23. Spread + bury
do mesmo `pubkey` no mesmo post resolve por `created_at` mais recente
(última ação vale). Bury reduz score local mas não esconde fora do
limiar de moderação.

## 6. Kind 9081 — REPORT

```json
{
  "kind": 9081,
  "tags": [
    ["e", "<post-id>"],
    ["p", "<author-pubkey>"],
    ["reason", "spam|nsfw|illegal|harassment|other"]
  ],
  "content": "",
  ...
}
```

Reports são insumo pra moderação reativa comunitária — manifesto §26.
Implementações cliente derivam decisão local (esconder do feed,
marcar) a partir de threshold dinâmico que considera quantidade de
reports e peso (`weight`) dos reportadores. Não há autoridade central
que age em reports.

## 7. Score determinístico

Score de um post é função pura de:

- soma do `weight` dos `pubkey`s que espalharam (kind 9079);
- subtração da soma do `weight` dos `pubkey`s que enterraram
  (kind 9080) — peso simétrico, manifesto §23;
- decay temporal por idade (`created_at` vs now);
- override `score = -999` quando reports ultrapassam threshold
  (manifesto §26).

Reference impl: `src/lib/scoring.ts` (Drift cliente). Qualquer cliente
que produza ranking diferente sobre o mesmo conjunto de eventos
diverge da spec — invariante forte, protege determinismo (manifesto §7).

`weight` é função pura do histórico do `pubkey` (idade da identidade,
diversidade de espalhamentos, etc.). Reference impl: `src/lib/weight.ts`.

## 8. Pipeline de processamento

Ordem canônica (manifesto §5–9):

```
1. Cheap: kind ∈ {9078, 9079, 9080, 9081}? Se não, descartar.
2. Cheap: schema validation (presença de tags obrigatórias).
3. Caro: verify Schnorr (NIP-01).
4. Persistir + atualizar score derivado.
5. Notificar UI (debounced).
```

Verificação Schnorr **depois** de cheap checks evita gasto de CPU em
spam óbvio. Implementações que invertem essa ordem ainda são corretas;
apenas menos eficientes.

## 9. Compatibilidade Nostr

Drift respeita:

- **NIP-01:** todos os eventos são NIP-01 strict.
- **NIP-02 (follows):** kind 3 é interpretado como rede de seguidores
  (input pra `weight`, opcional).
- **NIP-06 (BIP39):** opt-in para derivar `nsec` de mnemonic.
- **NIP-44 (encrypted DMs):** signaling WebRTC P2P (Fase 6).
- **NIP-52 (geo):** tag `location` em POST/SPREAD.
- **NIP-65 (relay list):** kind 10002 pra discovery dinâmico de relays.
- **NIP-94 (file metadata):** previsto pra distribuição de blobs
  (Track B do roadmap — `imeta` + IPFS CID).

Drift **não** introduz NIPs novos. Tag `drift-version` é o único
marker; restante é Nostr puro.

## 10. Conformidade

Um cliente é **Drift-conforme** se:

- Implementa kinds 9078–9081 conforme §3–6.
- Implementa pipeline §8 (com verificação Schnorr obrigatória).
- Implementa score determinístico §7 (impl literal de
  `lib/scoring.ts` ou equivalente verificável).
- Não implementa "chave mestra" — manifesto §17 + invariante #12 do
  CLAUDE.md.
- Não escaneia conteúdo automaticamente (PhotoDNA, ML, blocklists
  embutidas) — invariante #7 do CLAUDE.md, manifesto §25.

Clientes que cumprem o acima podem usar o nome "Drift" livremente.
Clientes que não cumprem são clientes Nostr genéricos que **podem ler**
eventos Drift mas não os interpretam corretamente.

---

## Histórico

- 2026-05: extração desta spec a partir de `drift-arquitetura-v4.md`
  pra reduzir acoplamento spec ↔ implementação. Origem da numeração
  de kinds: `archive/` planos de fases 1–2.
