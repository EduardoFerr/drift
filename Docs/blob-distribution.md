# RFC — Blob Distribution (Track B)

**Status:** Draft · **Versão:** 0.2 · **Data:** 2026-05-03
**Manifesto:** §16 (Disponibilidade Distribuída), §17 (sem chave mestra),
§22 (score determinístico), §28 (privacidade pelo mínimo).
**License:** CC0 1.0 Universal (manifesto + spec do Drift são domínio público).

> Documento de proposta. Decisões aqui ainda podem ser revisadas antes de B.1
> (Helia spike). Comentários via PR ou issues; revisão crítica das 5
> perspectivas LLM pendente antes de mover pra "Final".

---

## 1. Resumo

Drift hoje publica blobs (imagens em posts) via `nostr.build` hardcoded em
[`src/lib/upload.ts:38`](../src/lib/upload.ts). Isso **viola na prática** o
manifesto §16: se `nostr.build` cair, for confiscado, ou bloquear o user,
o blob desaparece. Manifesto §16 promete "o que a comunidade espalhou, a
comunidade guarda" — hoje só guarda o evento Nostr (kind 9078) + URL,
não o byte da imagem.

**Esta RFC propõe:**

1. Camada de distribuição de blobs **endereçada por hash** (CID IPFS via
   Helia) coexistindo com endpoint HTTP (`nostr.build` ou outro).
2. Reuso de **NIP-94** (tag `imeta` com `x` = SHA-256) como camada
   primária. NIP-94 cobre o caminho feliz (URL + hash + mime); o que
   ele **não** cobre vira **convenção interna Drift** (não NIP novo).
   Detalhamento honesto dos gaps em §3.5. Compat com ecossistema Nostr
   preservada (manifesto §28): cliente não-Drift recebendo kind 9078
   com `imeta` renderiza via `url`, ignorando convenções nossas — sem
   quebra.
3. **"Favorito = mirror automático"**: quando user marca post como
   favorito, cliente pina o blob no Helia local. Distribuição cresce
   organicamente sem violar §22 (score) ou §17 (chave mestra).
4. **HTTP gateway fallback**: se Helia falhar (browser sem WebRTC, peer
   isolado), fetch via gateway IPFS público. Degradação graceful.

**Fora do escopo (rejeitado em rounds anteriores):**
- Erasure coding 6:10 (Reed-Solomon) — overkill pra blobs sociais 1-10MB
- DBDP custom protocol — Helia + NIP-94 cobre 90% sem inventar protocolo novo
- DHT como discovery primário — overlay social NIP-65/NIP-02 já cobre
- Onion-only forçado — quebra disponibilidade pra users sem Tor
- Bordas/regiões/feeds-por-região — viola §11/§22/§24

---

## 2. Estado atual (gap concreto)

| Componente | Hoje | Gap §16 |
|---|---|---|
| Evento Nostr (kind 9078) | Replicado em N relays via `publishToRelays` | ✓ disponível mesmo se 1 relay cair |
| Blob da imagem | URL única apontando pra `nostr.build` | ✗ depende de 1 host comercial |
| Hash de integridade | Não armazenado em lugar nenhum | ✗ blob trocado silenciosamente passa despercebido |
| Auto-pin / mirror | Inexistente | ✗ "espalhar = seedear" não vale pra blob, só pra evento |

**Implicação política:** §16 fala de "comunidade guarda" mas cliente
oficial entrega `nostr.build` como SPOF. Há 2-3 vetores de censura em
escala não cobertos pela arquitetura atual.

---

## 3. Postura adotada (decisões herdadas de rounds anteriores)

Estas decisões foram firmadas em sessões anteriores via consulta às 5
personas LLM (HIMYM round). Não revisitar sem motivo novo:

- ✅ **Helia** como camada IPFS no PWA (~500KB bundle estimado, MIT)
- ✅ **NIP-94 reuse** — tag `imeta` com `x` SHA-256 + `url` HTTP fallback
- ✅ **HTTP fallback gracioso** — se Helia indisponível, gateway público
- ✅ **"Favorito = mirror automático"** — pin opt-in via ação social existente
- ✅ **RFC-first** — este doc, antes de spike Helia (B.1)

### 3.5 Convenções Drift sobre NIP-94 (o que NIP-94 não diz)

NIP-94 foi pensado pra kind 1063 (1 evento = 1 arquivo, file metadata).
Drift kind 9078 carrega N subposts × M imagens cada, com pin opt-in via
SPREAD, e usa Helia como fonte primária. Coisas que NIP-94 **não**
codifica e que viram **convenção Drift** (sem NIP novo, sem quebrar
compat):

#### 3.5.1 Formato do CID
NIP-94 `x` é SHA-256 hex. CID Helia é multihash + multicodec — não é só
`ipfs://<hex>`. Convenção: CIDs Drift sempre usam **codec `raw`** +
**multihash `sha2-256`**. Helper local `cidFromHash(x): CID` documenta
a conversão; reverse `hashFromCid(cid): hex` valida invariante. Cliente
não-Drift que tenta resolver `ipfs://...` formado dessa forma funciona
em qualquer node IPFS — convenção é sub-conjunto válido do CID space.

#### 3.5.2 Pin signaling via SPREAD (kind 9079)
"Espalhar = mirror" é semântica Drift, não NIP-94. Quando user emite
SPREAD pra um post, cliente **automaticamente** chama `pinBlob(cid)` no
Helia local pra cada `imeta` do post. Outros clientes Nostr veem o
SPREAD como engagement social genérico (compat NIP-25-like); só Drift
respeita a semântica de pin.

**Não** publicamos kind separado "I am pinning X" — manifesto §17 (sem
inventar discovery próprio paralelo a Nostr) + §22 (pin não é
score-driven, é ação social explícita).

#### 3.5.3 Mapeamento subposts → imeta tags
Convenção: tags `imeta` aparecem na **mesma ordem** em que aparecem nos
`subposts[i].media[j]` do `content` JSON. Reader processa `imeta`
sequencialmente; cada `imeta` consumido vincula à próxima referência
de mídia no JSON.

Cliente não-Drift sem suporte ao formato JSON do `content` ainda
consegue listar os blobs via tags `imeta` (cada uma standalone com
url/hash/mime).

---

## 4. Arquitetura proposta

### 4.1 Camadas

```
┌──────────────────────────────────────────────────────────┐
│  UI (Image component, post composer, favorite button)    │
└───────────────────────┬──────────────────────────────────┘
                        │
            ┌───────────▼────────────┐
            │  blobs.ts (orchestrador)│  ← novo, lib local
            │  - upload(file)         │
            │  - fetch(cid|url)       │
            │  - pin(cid)             │
            └───────────┬────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼────┐   ┌──────▼──────┐  ┌────▼─────┐
   │ Helia   │   │  upload.ts  │  │ HTTP gw  │
   │ (IPFS)  │   │ (nostr.build│  │ (fallback│
   │ local   │   │  ou outro   │  │  públ.)  │
   │ pin     │   │  endpoint)  │  └──────────┘
   └─────────┘   └─────────────┘
```

### 4.2 Componentes

- **`src/lib/blobs.ts`** (novo) — orquestrador: tenta Helia primeiro, HTTP
  endpoint depois, gateway último. Exporta `uploadBlob`/`fetchBlob`/
  `pinBlob`/`unpinBlob`/`listPinned`.
- **`src/lib/helia.ts`** (novo, B.1 spike) — wrapper Helia: init, pin,
  unpin, fetch CID, listing local. Lazy-loaded (não no precache PWA).
- **`src/lib/upload.ts`** (existe) — refatorado em B.2: deixa de ser
  `nostr.build`-only; vira plugável via `UserPrefs.upload_endpoint`
  (default `nostr.build`, configurável).
- **NIP-94 helpers** em `nostr.ts` — montar tag `imeta`, parsear de
  evento recebido.

---

## 5. Fluxos

### 5.1 Upload de blob (usuário cria post com imagem)

```
1. User seleciona imagem → ImagePicker
2. blobs.uploadBlob(file):
   a. Compressão local (já existe — upload.ts)
   b. Calcula SHA-256 do blob comprimido (cripto.subtle.digest)
   c. Tenta `helia.add(blob)` → CID
   d. Tenta upload HTTP (nostr.build/UserPrefs.upload_endpoint) → URL
   e. Retorna { cid?, url, hash, size, mimeType }
3. Composer monta tag NIP-94 imeta:
   ['imeta',
    'url <url>',
    'x <hash>',
    'm <mimeType>',
    'size <size>',
    'cid <cid>']  // opcional, extensão Drift compat
4. Evento kind 9078 publicado normalmente
```

**Falhas:**
- Helia falha mas HTTP OK → publica com `url` + `x` (sem `cid`). NIP-94 puro.
- HTTP falha mas Helia OK → publica com `cid` + `x` (sem `url`). Reader
  com Helia consegue; reader só-HTTP precisa de gateway → degraded.
- Ambos falham → erro pro user (sem post).

### 5.2 Fetch de blob (reader vê post)

```
1. Reader recebe evento kind 9078, parseia tag imeta
2. blobs.fetchBlob({ cid, url, hash }):
   a. Se cid e helia disponível → helia.cat(cid) (peer local ou rede)
   b. Senão se url → fetch direto
   c. Senão se cid → gateway IPFS público (cf-ipfs / dweb.link)
   d. Verify SHA-256 contra `x` da tag (rejeita se mismatch)
3. Retorna Blob → <img>
```

**Verificação de hash é obrigatória** se `x` está na tag. Manifesto §17:
hash é a única coisa que distingue "blob legítimo" de "ator no caminho
trocou". Sem verify, gateway público vira chave mestra.

### 5.3 Favorito = mirror automático

```
1. User toca "favoritar" no post → kind 9079 (SPREAD) já emite
2. Em paralelo, blobs.pinBlob(cid):
   a. Se cid já está em helia local → no-op (idempotente)
   b. Senão → helia.pins.add(cid) (force fetch + pin)
3. Notifica UI: "servindo N blobs a M peers" (B.3)
```

**Critério:** só pina se o user **explicitamente** sinalizou favorito
(SPREAD kind 9079). Não pina automaticamente em scroll ou view.
Manifesto §22: pin segue ação social explícita; sem reputation-driven.

### 5.4 Eviction (limite de espaço local)

User configurável: cap default 500MB de pins locais. Quando atinge:
- Pinned items mais antigos (LRU por `last_accessed`) são unpinned
- Item nunca é unpinned se user re-favoritou recentemente

**Não há eviction automático fora da config do user**. Cliente não
decide o que vale a pena guardar — user decide via favorito.

### 5.5 Race conditions e ordenação publish ↔ replicação

**Problema:** se cliente publica kind 9078 referenciando `cid X` antes
de Helia confirmar que o blob foi armazenado/replicado, reader recebe
o evento, tenta fetch, falha (peer ainda não tem o byte). UX ruim
("imagem quebrada"); pior em redes lentas onde o gap é segundos.

**Solução:** `blobs.uploadBlob()` **serializa**:
1. Compressão local
2. Hash SHA-256
3. `helia.add(blob)` → CID (ainda só local)
4. **Em paralelo, mas espera ambos:** (a) HTTP upload pro endpoint
   atual; (b) helia advertise (peer registry recebe announce).
5. Retorna `{ cid, url, hash }` apenas após pelo menos **2 confirmações
   de disponibilidade** (Helia local sucesso + 1 entre HTTP/peer
   advertise).
6. Composer só publica evento Nostr após `uploadBlob` resolver.

Trade-off: latência maior do "post" (segundos extras). Aceito —
manifesto §16 (durabilidade) > UX rápido falso. UI mostra spinner
"Garantindo cópias..." durante a espera.

**Failure de "2 confirmações":** se só 1 confirma, cliente pergunta
ao user: "Apenas 1 cópia disponível. Publicar mesmo assim?". Default
botão = "esperar mais"; opt-in pra "publicar agora" (degrade aceito).

---

## 6. Wire format (NIP-94 imeta dentro de kind 9078)

NIP-94 ([nips.nostr.com/94](https://nips.nostr.com/94)) define `imeta`
como tag opcional anexada a metadado de arquivo. Reuso direto:

```json
{
  "kind": 9078,
  "tags": [
    ["d", "<post-id>"],
    ["drift-version", "1"],
    ["client", "drift-official"],
    ["imeta",
      "url https://nostr.build/i/abc.jpg",
      "x e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "m image/jpeg",
      "size 245678",
      "dim 1920x1080"
    ],
    ["imeta",
      "url ipfs://bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3...",
      "x e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "m image/jpeg"
    ]
  ],
  "content": "<JSON com subposts referenciando os imeta acima>"
}
```

**Múltiplas tags `imeta`** com mesmo `x` (hash) = mesmo blob, diferentes
formas de obter. Reader escolhe a que conseguir resolver.

**Compat:** clientes Nostr não-Drift com suporte a NIP-94 renderizam
normalmente via `url`. Clientes só com Drift + Helia preferem `ipfs://`.

---

## 7. Failure modes + degradação graceful

### 7.1 Tabela de modos de falha

| Falha | Comportamento esperado |
|---|---|
| Helia init falha (browser sem WebRTC, iframe restrito) | Cliente vira HTTP-only; sem pin local; UI esconde "servindo N blobs" |
| Endpoint HTTP fora (nostr.build down) | Upload falha graciosamente; user vê erro acionável; pode trocar endpoint em Settings |
| Gateway IPFS público bloqueado | Fetch via cid falha; user vê placeholder + opção "tentar de novo via outra rota". Cliente itera lista local de gateways (`config/gateways.ts`) com timeout 5s + circuit breaker. |
| Hash mismatch (`x` ≠ blob baixado) | Reader **rejeita** o blob; renderiza placeholder + warning. Não armazena. |
| Pin storage atingido | Eviction LRU (favoritados antigos saem); user vê banner discreto "limite de cache local atingido" |
| Helia peer count zero | Cliente continua publishing (other peers verão eventualmente); UI mostra "0 peers — tente abrir mapa pra descobrir spreaders" |
| Blob > tamanho cap local (default 10MB pós-compressão) | Upload rejeita antes de hash; user vê erro com sugestão de recomprimir. Cap configurável em UserPrefs. |

### 7.2 Limitações assumidas (decisão honesta, não bug)

Manifesto §16 promete "o que a comunidade espalhou, a comunidade
guarda" — é compromisso **conditional**, não absoluto. Estes são
limites assumidos do design:

- **Sem garantia de durabilidade temporal**: nenhum NIP existente
  codifica "comprometo-me a manter este CID por X dias". Drift
  também não cria isso. Pin segue ação social explícita (SPREAD);
  sem favorito, blob desaparece quando uploader rotacionar pin
  storage. Trade-off aceito: durabilidade ∝ engajamento real, não
  promessa de cliente.
- **Sem coordenação cross-peer de garbage collection**: cada peer
  decide localmente quando dropar pin (LRU + protected window de
  30 dias pós-spread). Sem mensagem "tô precisando de espaço,
  alguém pega esse CID?". Heurística local; aceitamos perda de
  blobs com 0 spreaders ativos como característica, não falha.
- **Replicação não-determinística**: número de réplicas é
  emergente do número de spreads. Posts virais → muitas cópias;
  posts nicho → potencialmente 1 (uploader). Adequa-se a §22
  (popularidade vira durabilidade), aceita o risco de blob nicho
  sumir.
- **Sem TTL formal de blob**: blobs efêmeros (DM-equivalentes
  futuros, snapshots de stories) não cabem nesta RFC. Reabrir se
  features assim entrarem no roadmap.

Honestidade > teatro: estes não são "TODOs" — são **propriedades
desejadas** do desenho. Manifesto §17 (sem chave mestra) implica
que ninguém pode forçar peers a manter blobs; durabilidade tem que
emergir, não ser comandada.

---

## 8. Backwards compat

- **Eventos kind 9078 publicados antes desta RFC** continuam tendo
  `url` mas nem sempre `imeta` formal. Reader trata ausência de `imeta`
  como "sem hash conhecido, usa URL" (mesma semântica que hoje).
- **Endpoint `nostr.build`** continua sendo default da seed config —
  refator do upload.ts (B.2) torna configurável mas não muda default.
- **Sem migração de dados local**: SQLite schema de domínio inalterado.
  Tabela nova `pinned_blobs` (B.2) trata estado IPFS local separado.

---

## 9. Privacy considerations

### 9.1 Vetores conhecidos
- **IP exposto a gateway IPFS público** quando Helia local não tem o
  blob — gateway vê hash + IP. Mitigação base: TLS obrigatório,
  preferir gateway que declara não logar (cf-ipfs.com).
- **Peer-to-peer Helia expõe IP a outro peer**. Mesma característica do
  WebRTC — não pior que o que já temos em Fase 6 transport.
- **NIP-94 `url` HTTP** continua expondo IP do reader pro endpoint.
  Herdado do nostr.build atual.
- **EXIF stripping** já é feito hoje em `upload.ts` (preserveExif: false).
  Mantém-se em `blobs.ts` antes de hash + upload — hash é do blob já
  desexifado.

### 9.2 Integração com Fase 6.4 (Tor)

Combinação `network_mode` + Helia:

| `network_mode` | Helia behavior | Gateway HTTP |
|---|---|---|
| `clearnet` (default) | WebRTC P2P + DHT direto | Gateway clearnet (cf-ipfs/dweb.link/etc.) |
| `tor` | WebRTC pode vazar IP via STUN; **opção: Helia P2P desabilitado**, fetch só via gateway sobre SOCKS5 arti | Gateway clearnet rota via Tor (IP do user invisível pro gateway) |
| `onion-only` | P2P desabilitado (Tor não cobre WebRTC). Apenas gateway. | **Apenas gateways `.onion`** (cf-ipfs tem mirror onion; lista mantida em `config/gateways.ts`) |

Em modo `onion-only`, durabilidade degrada (sem peers próprios servindo)
— trade-off explícito do user que escolheu paranoia máxima. Documentar
em UI de Settings.

Lista de gateways inclui versões `.onion` quando disponíveis pra cada
provedor (auditoria periódica — falha de mirror onion não é fatal,
cliente fail-over pra próximo).

---

## 10. Migration / phasing

| Fase | Scope | Esforço | Critério de aceite |
|---|---|---|---|
| **B.0** (este doc) | RFC | ~3h | Persona review pass; user aprova direção |
| **B.1** | Helia spike | ~4h | POC: helia init + add blob + cat + pin em PWA. Mede bundle real (espera ~500KB). Sem UI. |
| **B.2** | NIP-94 + auto-pin no favorito | ~6h | upload.ts refatorado configurável; blobs.ts orquestrador; tag imeta emitida em kind 9078; pin disparado por kind 9079 |
| **B.3** | UI "servindo N blobs a M peers" | ~4h | Settings panel mostra estado Helia local; total bytes pinados; peer count; toggle helia on/off |
| **B.4** | Integração PoI seeder + Helia | ~2-4h | `lib/seeder.ts` (Fase 7.1a) sinaliza pra Helia "esses peers possuem CIDs Y"; melhora resolution latency |

**Cada fase é shipável independente.** B.1 spike pode parar se bundle
sair muito acima de 500KB (revisar Helia vs alternativa). B.2 pode
shippar sem B.3 (só logs DEV em vez de UI). B.4 é polish, não bloqueia
cumprimento de §16.

---

## 11. Open questions

1. **Bundle size real do Helia 2.x** — ~500KB é estimativa pré-spike.
   Se chegar acima de 1MB, considerar lazy load por route (mapa carrega
   Helia, feed simples não) ou alternativa (libp2p mais minimal).
   Bloqueia B.1 — primeira coisa a medir.
2. **Persistência do pin storage**: IndexedDB Helia default vs OPFS
   manual. OPFS dá mais cap (~1GB+ tipicamente) mas exige integração
   custom. Decidir em B.1.
3. **Peer discovery message protocol entre clientes Drift** — §3.5.2
   diz que SPREAD = pin, mas como outro peer fica sabendo "eu pinei"
   sem flooding rede? Proposta: piggyback no peer registry da Fase 6.2
   (`peers_known` SQLite). Quando peer conecta via signaling Nostr,
   troca **CID announcement curto** via DataChannel WebRTC (lista de
   CIDs pinados nas últimas N horas). Detalhar em B.2 — wire format,
   cap de tamanho da lista, frequência. Não cria NIP novo.
4. **Encryption no blob** (e2ee opcional pra blobs em DM-equivalentes
   futuros): out-of-scope desta RFC. Reabrir se DM/group blobs
   entrarem no roadmap.
5. **Gateway IPFS default lista + curadoria** — cf-ipfs, dweb.link,
   ipfs.io? Curar 3-5 (clearnet) + 1-2 onion mirrors. Configurável em
   Settings, fail-over automático com timeout. Lista inicial em
   `config/gateways.ts` (B.2). **Critério de inclusão**: TLS válido +
   declaração pública de não-logging + mirror `.onion` quando possível.
6. **TWA Android compat com Helia**: WebView Chrome geralmente OK; a
   confirmar se algum recurso (Web Worker pool size) limita. Smoke
   test em B.1.
7. **Convenção exata pra imeta multi-formato com mesmo `x`**: NIP-94
   permite múltiplas tags `imeta` com mesma `x` (hash). Formato Drift
   usa pelo menos uma com `url` (HTTP) e uma com `url ipfs://...`. Há
   hint formal pra reader sobre preferência (ex.: ordem importa)? Hoje
   convenção Drift é "tenta na ordem listada"; documentar em
   `protocol-spec.md`.

---

## 12. References

- [NIP-94 — File Metadata](https://github.com/nostr-protocol/nips/blob/master/94.md)
- [Helia (IPFS browser)](https://github.com/ipfs/helia) (MIT)
- [`Docs/manifesto.md` §16, §17, §22, §28](manifesto.md)
- [`Docs/protocol-spec.md`](protocol-spec.md) (CC0 single source dos kinds)
- [`Docs/continuity.md`](continuity.md) — relação com resilência geral
- [`Docs/roadmap-v060.md`](roadmap-v060.md) Track B — agendamento
- [`src/lib/upload.ts`](../src/lib/upload.ts) — código atual a ser refatorado em B.2

---

## Histórico

- **2026-05-03 v0.1**: Draft inicial. Afirmação imprecisa "Helia +
  NIP-94 cobre 90% sem inventar protocolo novo" no §1.
- **2026-05-03 v0.2**: revisão honesta dos 10% não cobertos por
  NIP-94/Helia:
  - §1 reformulado — sem hand-wave sobre cobertura.
  - §3.5 (novo) — Convenções Drift sobre NIP-94: formato CID, pin via
    SPREAD, mapeamento subposts→imeta. Documenta extensões internas
    sem inventar NIP novo.
  - §5.5 (novo) — Race conditions e ordenação publish↔replicação.
    `uploadBlob` serializa pra esperar 2 confirmações antes de retornar.
  - §7.2 (novo) — Limitações assumidas (não bugs): sem garantia
    temporal, sem coordenação cross-peer GC, replicação não-determinística,
    sem TTL formal. Manifesto §16 é compromisso conditional, não absoluto.
  - §9.2 (novo) — Integração com Fase 6.4 Tor (clearnet vs tor vs
    onion-only, gateways `.onion`).
  - §11 — open questions expandido (peer-discovery message protocol,
    gateway curation criteria, hint multi-imeta).
  - Pendente revisão crítica das 5 personas LLM antes de B.1 spike.
