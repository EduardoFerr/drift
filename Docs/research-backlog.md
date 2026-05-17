# Research Backlog — pesquisas externas pendentes

Lista de itens que dependem de info externa atualizada e bloqueiam (ou
informam) decisões de roadmap. Quando WebFetch/WebSearch reabrir,
executar em ordem de prioridade da fase. Cada item tem **pergunta**
(o que descobrir), **por quê bloqueia** (custo de não saber),
**workaround interim** (o que dá pra fazer sem pesquisa), **fonte
ideal** (onde olhar primeiro).

Mantida pela Robin (research). Atualizar quando item for resolvido —
mover pra "Resolvido" no fim do doc.

---

## Fase 6.1a (em andamento — `transport/webrtc.ts` + signaling mock)

### R1 — BroadcastChannel em jsdom / Vitest 4.x
**Pergunta**: o jsdom default que vem com Vitest 4.1.5 expõe
`BroadcastChannel` nativamente, ou os tests de `signaling-mock.test.ts`
vão precisar polyfill?
**Por quê bloqueia**: `webrtc-6.1a-plan.md §8.1` lista isso como
armadilha. Sem clareza, os tests de signaling mock podem falhar em CI.
**Workaround interim**: começar implementação. Se jsdom não tem,
fallback é `happy-dom` env (que tem) ou polyfill manual de ~30 linhas
com `EventTarget` + Map global por canal.
**Fonte ideal**: `github.com/jsdom/jsdom` CHANGELOG (procurar
"BroadcastChannel"); `vitest.dev` docs sobre environments; comparativo
com `happy-dom`.

### R2 — RTCPeerConnection mockability em ambiente de teste
**Pergunta**: existe lib mantida em 2025-2026 que mock
`RTCPeerConnection` + `RTCDataChannel` pra Vitest, ou todo teste de
`webrtcTransport` real precisa ser e2e manual?
**Por quê bloqueia**: plano atual aceita "tests unit cobrem só
matchFilter + signaling mock". Se aparecer mock decente, ganhamos
coverage automatizada do pipeline §5 (kind→verify→entrega).
**Workaround interim**: e2e manual em 2 abas (já documentado em
`webrtc-6.1a-plan.md §9`). Aceitável pra 6.1a.
**Fonte ideal**: npm `wrtc`, `@koush/wrtc` (forks pós-deprecation),
`werift` (TypeScript WebRTC). Verificar manutenção 2026.

---

## Fase 6.1b (próxima — signaling real via Nostr DM NIP-44)

### R3 — `nostr-tools` v2.7+ exporta NIP-44 estável?
**Pergunta**: `nostr-tools@^2.7.0` (instalado) exporta `nip44.encrypt`
/ `nip44.decrypt` como API estável ou ainda como módulo experimental?
A v2.x quebrou API entre minors no passado.
**Por quê bloqueia**: decisão entre usar lib (zero deps novas) vs
implementar NIP-44 v2 inline (~150 linhas, ChaCha20 + HMAC-SHA256 +
HKDF). Inline é mais auditável mas é mais código pra revisar.
**Workaround interim**: olhar `node_modules/nostr-tools/nip44.*` —
se exporta funções nomeadas e tem tests, usa. Se for `experimental_*`
prefix, inline.
**Fonte ideal**: `github.com/nbd-wtf/nostr-tools` releases + README;
`github.com/nostr-protocol/nips/blob/master/44.md` pra spec.

### R5 — Privacidade NIP-44 (gift wrap NIP-59)
**Pergunta**: pra signaling WebRTC vazar mínimo de metadata
(quem-fala-com-quem), faz sentido envolver os DMs em gift wrap
(NIP-59) ou é overkill nessa fase?
**Por quê bloqueia**: opção arquitetural. Manifesto §28 cobra
"privacidade pelo mínimo". Sem gift wrap, sender/receiver são
visíveis no relay; com gift wrap, só o receiver.
**Workaround interim**: 6.1b sem gift wrap (mais simples). Marcar
como follow-up de 6.2.
**Fonte ideal**: NIP-59 spec + análises de adoção.

---

## Fase 6.2 (peer registry + path diversity)

### R6 — Path diversity scoring — referência acadêmica/prática
**Pergunta**: existem métricas publicadas (Bitcoin/IPFS/libp2p) de
path diversity scoring contra Sybil adaptativo, ou vamos cunhar a
fórmula?
**Por quê bloqueia**: invariante #14 e manifesto §20 prometem path
diversity scoring. Implementação ad-hoc é vulnerável a ataques que
literatura já mapeou.
**Workaround interim**: começar com heurística simples
(N caminhos independentes / N total > threshold). Refatorar quando
houver referência sólida.
**Fonte ideal**: papers libp2p Kademlia, IPFS Bitswap, Bitcoin Erlay;
RFC sobre eclipse attacks (Heilman et al. 2015).

---

## Fase 6.3 (STUN/TURN policy)

### R7 — STUN públicos confiáveis em 2026
**Pergunta**: Google STUN (`stun.l.google.com:19302`) ainda é gratuito
sem rate limit em 2026? Cloudflare Calls oferece STUN público
incondicional? Existem listas curadas tipo `pradt2/always-online-stun`
ainda mantidas?
**Por quê bloqueia**: vai hard-coded em `transport/webrtc.ts`.
Mudança = bump versão + push ao cliente. Errar = NAT traversal
silenciosamente quebra pra usuários atrás de NAT simétrico.
**Workaround interim**: lista híbrida (Google + Cloudflare + 2-3
alternativas). Observar via UI métrica de health pra detectar STUN
caindo.
**Fonte ideal**: `developers.cloudflare.com/calls/turn`,
`webrtc.github.io/samples`, GitHub `pradt2/always-online-stun`,
`stun-protocol.org`.

### R8 — TURN gratuito ou auto-hospedado em 2026
**Pergunta**: Cloudflare Calls ainda tem free tier de TURN (10GB/mês)?
Existe lista de TURN comunitário pro Drift agregar? Custo estimado
de auto-hospedar `coturn` num VPS pra TURN do default Drift?
**Por quê bloqueia**: NAT simétrico (~8% dos usuários, alto em mobile)
exige TURN. Sem TURN, esses users não conseguem WebRTC. Manifesto §15
(anti-censura) fica capenga em mobile.
**Workaround interim**: documentar limitação; modo `relay-mode` no
seeder usa TURN do user (BYO TURN). 6.3 entrega "best effort com STUN
puro".
**Fonte ideal**: Cloudflare Calls pricing; `coturn` GitHub;
`numb.viagenie.ca` (já morreu? confirmar).

### R9 — WebRTC + mDNS IP leak mitigations 2026
**Pergunta**: o quanto os browsers de 2026 ainda obfuscam ICE
candidates locais com mDNS (`xxx.local`) por default? Safari/Firefox
mantêm o comportamento? Existe novo vetor de leak via
`navigator.connection`?
**Por quê bloqueia**: privacidade IP é compromisso de §28. Modo
`always-on` declara "vaza IP" — precisamos validar exatamente o que
vaza pra ser honesto na UI.
**Workaround interim**: assumir worst-case (IP público sempre vaza
sem TURN); UI conservadora.
**Fonte ideal**: `webrtc-security.github.io`, `caniuse.com mdns ice`,
draft IETF `mmusic-mdns-ice-candidates`, Mozilla bug tracker.

---

## Fase 6 (Tauri shell — após 6.3)

### R10 — Tauri Mobile (Android/iOS) status estável 2026
**Pergunta**: Tauri 2.x Mobile saiu de beta? Build pra Android via
Tauri vs TWA via Bubblewrap — qual decidir como caminho oficial?
**Por quê bloqueia**: Fase 6 prevê "cliente nativo Tauri". Se Tauri
Mobile é estável, pula F-Droid TWA → F-Droid Tauri. Se ainda beta,
TWA continua sendo o caminho Android.
**Workaround interim**: Tauri pro **desktop** (comprovado v2.x), TWA
pro Android. Reavaliar quando Tauri Mobile bater 1.0 GA.
**Fonte ideal**: `tauri.app/blog`, `github.com/tauri-apps/tauri`
releases, Reddit r/tauri.

### R11 — `arti` (Tor em Rust) bindings JS/Tauri 2026
**Pergunta**: `arti` (Tor em Rust pelo TPO) tem binding pra Tauri /
Node 2026? Maturidade comparada com `tor` C tradicional via sidecar?
Suporta hidden services v3?
**Por quê bloqueia**: Manifesto §12 promete Tor no cliente nativo.
Decisão: bindar `arti` (in-process, melhor) vs sidecar `tor` C
(processo separado, mais rodado).
**Workaround interim**: documentar trade-off; começar PoC com sidecar
(menos integração) e migrar pra arti se maduro.
**Fonte ideal**: `gitlab.torproject.org/tpo/core/arti` README + roadmap;
crates.io `arti-client`.

---

## Fase 7.1 (TWA — antecipada, em manutenção)

### R13 — Digital Asset Links / Chrome 2026
**Pergunta**: requisitos do Asset Links API mudaram pós-Chrome 130?
Existe novo campo obrigatório no `assetlinks.json` pra TWA não
mostrar barra Chrome?
**Por quê bloqueia**: TWA é o caminho Android default. Bug invisível
no asset links transforma TWA em Chrome Custom Tab degradado.
**Workaround interim**: monitorar manual via curl + Asset Links API
endpoint (já documentado em `twa.md §"Arquitetura — quando algo dá
errado"`).
**Fonte ideal**: `developers.google.com/digital-asset-links`,
`developer.chrome.com/blog` (filtros TWA).

---

## Fase 7.2 (F-Droid)

### R14 — F-Droid build server requirements 2026
**Pergunta**: `fdroidserver` aceita Node 22 + Java 17? `buildserver`
Docker oferecido em 2026 ainda é Debian-based? Limites de RAM/CPU
durante build pra evitar OOM?
**Por quê bloqueia**: Fase 7.2 estima 4h de submissão; se
incompatibilidade aparecer, vira semanas iterando com reviewers.
**Workaround interim**: rodar `fdroid build --latest` local em Docker
oficial antes da MR (já planejado em `fdroid.md §5.6`).
**Fonte ideal**: `gitlab.com/fdroid/fdroidserver` README; thread no
`forum.f-droid.org`.

### R15 — Reprodutibilidade Bubblewrap 2026
**Pergunta**: existe receita pública de build reproduzível pra
TWA-Bubblewrap (SOURCE_DATE_EPOCH consistente, ordem de zip
determinística)? Outros TWAs no F-Droid resolveram?
**Por quê bloqueia**: F-Droid prefere builds reproduzíveis;
manifesto §17 (build reproduzível) também. Sem receita, eternalmente
"não-reproduzível mas aceito sob NonFreeNet".
**Workaround interim**: `fdroid-check.yml` em PRs (já planejado);
documentar diffoscope output como "best effort".
**Fonte ideal**: `f-droid.org/docs/Reproducible_Builds`, issues em
`bubblewrap` sobre `--no-deterministic`.

---

## Fase 7.3+ (IPFS pin, run-your-own-relay, sneakernet)

### R16 — Helia (IPFS modular JS) — release stable 2026
**Pergunta**: `helia` (sucessor de `js-ipfs`) atingiu 1.0 GA?
Compatível com browser via WebRTC transport? Bundle size atual
(árvore minimizada)?
**Por quê bloqueia**: Fase 7 §16 promete IPFS pin de posts virais.
Decisão entre helia (moderno, modular) vs js-ipfs legacy
(arquivado mas funcional). Bundle size impacta PWA cold start.
**Workaround interim**: pinar via service externo (Pinata API) sem
helia local. Não cumpre §17 (sem chave mestra) plenamente — Pinata
pode censurar.
**Fonte ideal**: `github.com/ipfs/helia` releases;
`bundlephobia.com/package/helia`; benchmarks comunitários.

### R17 — Pinning services com free tier persistente 2026
**Pergunta**: Web3.Storage / NFT.Storage / Pinata / Filebase /
4everland — quais ainda tem free tier permanente em 2026? Quais
exigem KYC (incompatível com manifesto §4)?
**Por quê bloqueia**: pin inicial de viral-content precisa custar 0
pro user (default). Sem fonte gratuita, feature vira paywall.
**Workaround interim**: documentar opção "BYO pinning service"; user
aporta API key. Default = sem pin externo, só re-broadcast WSS.
**Fonte ideal**: comparativo em `awesome-ipfs`; sites oficiais
(verificar pricing 2026); HackerNews threads.

### R18 — IPFS gateway censorship-resistant 2026
**Pergunta**: gateways públicos confiáveis pra fetch de CIDs em
2026 (cloudflare-ipfs, ipfs.io, dweb.link)? Algum descontinuado?
Latência típica?
**Por quê bloqueia**: leitura de pins (pra confirmar disponibilidade)
depende de gateway. Se Cloudflare desligou (já houve rumor 2024),
cliente quebra silenciosamente.
**Workaround interim**: rotacionar gateways (lista no client); mostrar
falha explícita se todos falharem.
**Fonte ideal**: `ipfs.github.io/public-gateway-checker`, status
pages oficiais.

### R19 — `strfry` vs `nostr-rs-relay` em 2026 (run-your-own-relay)
**Pergunta**: pra tutorial "auto-hospede um relay Drift" (manifesto
§14, Fase 5+), qual implementação recomendar? Strfry continua
performance leader? `nostr-rs-relay` ainda mantido?
**Por quê bloqueia**: tutorial público de auto-hospedagem é
compromisso §14. Recomendação errada = users frustrados.
**Workaround interim**: documentar 2 opções com trade-offs (strfry
performance vs relay-py simplicidade).
**Fonte ideal**: `nostr.watch`, comparativos em blogs nostr,
GitHub stars/issues de cada.

---

## Cross-cutting

### R20 — Browser support matrix 2026 — Battery API, Network Info
**Pergunta**: `navigator.getBattery()` ainda funcional em
Chrome/Firefox/Safari 2026, ou foi deprecated por privacy?
`navigator.connection.type` cobre quais browsers?
**Por quê bloqueia**: gating de seeding (Fase 7.1) depende disso
(`archive/webrtc-seeding.md §"Modos operacionais"`). Se Battery API foi
removida, modo `lan-wifi-only` precisa heurística diferente.
**Workaround interim**: feature-detect com fallback `'always-on'`
explícito (user opt-in mais forte).
**Fonte ideal**: `caniuse.com/battery-status`, `caniuse.com/netinfo`,
MDN deprecation notices.

### R21 — `@sqlite.org/sqlite-wasm` — saiu de pre-release?
**Pergunta**: pacote ainda só publica como pre-release (motivo do pin
exato em `package.json`), ou já tem versão estável `^3.x`?
**Por quê bloqueia**: pin manual em CI sangra a cada upgrade. Se
estabilizou, podemos relaxar pra `~3.51` ou `^3`.
**Workaround interim**: continuar pin exato. Funciona, só é tedioso.
**Fonte ideal**: `npmjs.com/package/@sqlite.org/sqlite-wasm`
versions tab; `sqlite.org/wasm`.

### R22 — Análise de risco WebRTC — IP leak via mDNS 2026
**Pergunta**: papers ou advisories recentes (2024-2026) sobre
des-anonymização de WebRTC mesmo com mDNS hostnames? Novos vetores
descobertos?
**Por quê bloqueia**: threat model do `archive/webrtc-seeding.md §Riscos` é
de Abril 2026. Se literatura nova mostra que mDNS já é furável,
default `lan-wifi-only` perde valor de privacidade.
**Workaround interim**: doc atual já marca limitação ("não somos
mixnet"). Honesto.
**Fonte ideal**: USENIX Security, IEEE S&P proceedings 2024-2026;
`webrtc-security.github.io` issues recentes.

### R24 — `vite-plugin-pwa` + Workbox v8 status
**Pergunta**: Workbox v8 saiu? `vite-plugin-pwa@^0.20` em
`package.json` está em latest, ou existe upgrade significativo
(performance, precache shrink) disponível?
**Por quê bloqueia**: Fase 5 fechou PWA polish, mas precache size é
recorrente. Versão nova pode resolver.
**Workaround interim**: aceitar tamanho atual; medir com Lighthouse.
**Fonte ideal**: `github.com/vite-pwa/vite-plugin-pwa` releases;
`developer.chrome.com/docs/workbox` blog.

---

## Resolvido

- **R3** (NIP-44 estável em `nostr-tools` v2.7+) — ✅ resolvido (2026-04-29).
  `nostr-tools` 2.7.0 exporta `nip44` com `getConversationKey/encrypt/
  decrypt`. Usado em `src/lib/webrtc-signaling-nostr.ts` (Fase 6.1b,
  shipado em `0.6.0-alpha.1`). Zero deps novas.
- **R5** (privacidade NIP-44 + gift wrap mínimo) — ✅ resolvido em 6.1b
  (2026-04-29). Gift wrap kind 1059 minimal sem NIP-17 seal — decisão
  documentada em `Docs/archive/webrtc-6.1b-plan.md`.
- **R11** (arti bindings Tauri 2026) — ✅ resolvido (2026-05-01). Crates
  `arti-client = 0.41` + `tor-rtcompat = 0.41` + `tokio` (full features)
  + rustls compilam clean junto com Tauri 2.11. Ver `Docs/webrtc-6.4-plan.md
  §4.1` e commit `22d3e11`.
- **R21** (`@sqlite.org/sqlite-wasm` saiu de pre-release?) — 🟡 parcial
  (2026-05-01). Continua em pre-release upstream; `package.json` mantém
  pin exato `3.51.2-build9` (sem `^`). Tema persistente mas operacionalmente
  ok — sem incidente atribuído ao pin desde Fase 1. Re-checar quando o
  upstream estabilizar minor.
- **R4** (NIP-44 v2 vs NIP-04 deprecation) — ✅ resolvido implicitamente
  pela decisão "Drift só fala com Drift via DM". Drift signaling é
  peer-Drift, não cross-client; clientes que ainda só falam NIP-04
  ignoram nossas DMs sem prejuízo de protocolo.
- **R12** (Bubblewrap CLI quirks 2025-2026) — ✅ resolvido. TWA shipped
  estável em `v0.5.4`; workflow com `expect` driver + `NODE_OPTIONS=
  --max-old-space-size=4096` cobre os pontos identificados. Sem
  incidente novo desde então.
- **R23** (Vercel COOP/COEP em 2026 + alternativas) — ✅ resolvido
  (2026-05-02). `vercel.json` ganhou CSP restritiva no commit `4402acc`
  alinhada com Tauri config; COOP/COEP funcionais em prod (`crossOriginIsolated
  === true` confirmado no boot). Alternativa Cloudflare Pages permanece
  como contingency mas não acionada.
- **R25** (MapLibre vs Mapbox bundle size) — ✅ resolvido como "monitor
  passivo". Estado atual aceitável; reabrir só se UX queixar de load
  de mapa. Sem trabalho ativo.

---

## Fase 7+ (descoberta de relays moderados — adicionado 2026-05-17)

### R26 — Relays Nostr com moderação / "family friendly"
**Pergunta**: quais relays públicos hoje aplicam moderação (hate speech,
NSFW, illegal, harassment)? Quais são pagos vs gratuitos, whitelist
vs blacklist, NIP-56 (kind 1984) consumers vs producers?
**Por quê informa**: Drift hoje ships `SEED_RELAY_CONFIGS` neutro. Pra
users que querem feed family-friendly por default (manifesto §24 — sem
afinidade no ranking, MAS user pode escolher relay que filtra antes do
cliente), precisa lista curada. Não é censura — é opt-in.
**Workaround interim**: docs explicam como adicionar relay manualmente
em Settings > Relays. Falta curated list + UX de descoberta.
**Fonte ideal**: `relay.nos.social` (Tagr Bot), `nostr.how/relays`,
relay directory wikis (`nostr.directory`?), discussão de NIP-56 no
GitHub `nostr-protocol/nips`.

### R27 — Relays sem moderação (extremo oposto)
**Pergunta**: quais relays são absolute-free-speech / sem-moderação?
Privacidade vs censura — onde users dissidentes / leakers buscam?
**Por quê informa**: Drift §15 anti-censura por país. Cliente precisa
oferecer ambos os polos pro user — moderado pro casual, sem-moderação
pro ativista. Curated list por categoria.
**Workaround interim**: SEED_RELAY_CONFIGS atual é mainstream — não
expõe paranoia tier. Adicionar comentário no config sobre quais são
neutros vs moderados.

### R28 — Como criar relay próprio com filtro de IA
**Pergunta**: stack atual pra rodar relay Nostr + classificador
NSFW/hate/spam? `strfry` é o backend dominante? Hooks pra plugar
classifier (OpenAI API, local LLM via llama.cpp, ML5)? Performance
overhead aceitável (eventos/seg)?
**Por quê informa**: Fase 7 contempla "run-your-own-relay" como
distribuição. Comunidades Drift podem rodar relay próprio com
moderação adaptada. Cliente Drift NÃO escaneia (§7/§25), mas relay
operator é livre — manifesto §17 não estende a operator de relay.
**Fonte ideal**: `github.com/hoytech/strfry` + plugins, blogs de
operadores (Damus, Nos), `nostr-protocol/nips` PR de moderação.

### R29 — Implementação completa de NIP-56 (kind 1984)
**Pergunta**: schema exato de kind 1984, tags obrigatórias, como
clientes amplos (Damus, Snort, Iris, Coracle) consomem labels e
renderizam? Drift hoje ships kind 9081 (REPORT) próprio — qual a
ponte semântica com NIP-56?
**Por quê informa**: kind 9081 é Drift-only — outros clientes não
entendem. NIP-56 é padrão. Drift pode emitir AMBOS (9081 pro pipeline
interno + 1984 pro ecossistema Nostr) ou só 1984 com tag drift-specific.
Decidir antes de inflar adoption.
**Fonte ideal**: `nostrbook.dev/kinds/1984`, NIP-56 spec no
`nostr-protocol/nips`, source de Damus/Snort handlers.

### R30 — Arquitetura de moderação Nos/Primal/Damus
**Pergunta**: como cada cliente top-tier do Nostr lida com moderação?
- Damus: client-side filters? NIP-56 consume? Bot pipeline próprio?
- Primal: server-side aggregation + filtering?
- Nos: integração Tagr Bot + NIP-56 labels (já documentado)
- Snort/Iris: blocklists, mutelist?
**Por quê informa**: ROI vs reinventar. Drift pode adotar pattern
consolidado em vez de inventar pipeline próprio.
**Workaround interim**: Drift ships `moderation-local.ts` (block/mute
locais) + `kind 9081` (reports globais com threshold dinâmico §26).
Funcional mas isolado do resto do ecossistema.

### R31 — strfry + plugins pra Drift run-your-own-relay
**Pergunta**: minimal viable stack pra comunidade Drift rodar relay
próprio em VPS de $5/mes (DigitalOcean, Hetzner)? `strfry` + nginx
reverse proxy + Let's Encrypt + opcional Tor onion? Backup strategy?
**Por quê informa**: Fase 7 "run-your-own-relay" precisa receita
copy-paste. Sem isso, manifesto §16 (disponibilidade distribuída)
fica retórica.
**Fonte ideal**: `github.com/hoytech/strfry/blob/master/docs/`, blogs
de relay operators amadores.

### R32 — Filtros automáticos via OpenAI API vs LLM local
**Pergunta**: trade-off financeiro + privacidade entre OpenAI Moderation
API (free pra dev, log-no-policy) vs local LLM (llama.cpp + small model,
self-hosted)? Latência (relay precisa decidir aceitar/recusar em <500ms),
acurácia (false positive rate de NSFW classifier).
**Por quê informa**: complementa R28. Operator de relay Drift precisa
decisão informada. Cliente NÃO usa esses (manifesto §25), mas relay-
side é jogo aberto.

---

## Fase 5/6 (UX pequeno — adicionado 2026-05-17)

### R33 — Botão "atualizar" em Settings > Sobre
**Pergunta**: trivial — apenas implementação. Trigger de service worker
update (`skipWaiting` + `clients.claim`), hard reload, cache nuke.
**Por quê informa**: user reporta que app fica em versão stale após
deploy. PWA service worker pode demorar até 24h pra detectar nova
versão. Botão manual em Sobre dá agência ao user.
**Workaround interim**: cache nuke já existe no LazyBoundary retry
button (auto on chunk fail). Falta entrada manual.
**Fonte ideal**: própria — implementar reusando `clearServiceWorkerAndReload`
de `LazyBoundary.tsx`. Botão em `AboutCardLayer` (App.tsx).

---

*Documento mantido (atribuição original: papel de research/curadoria).
Última atualização: 2026-05-17.*
*Itens originais: 25 → 33 (8 novos R26-R33). Resolvidos até 2026-05-01: 4 (R3, R5, R11, R21 parcial).*
