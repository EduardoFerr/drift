# Research Backlog — pesquisas externas pendentes

Lista de itens que dependem de info externa atualizada e bloqueiam (ou
informam) decisões de roadmap. Quando WebFetch/WebSearch reabrir,
executar em ordem de prioridade da fase. Cada item tem **pergunta**
(o que descobrir), **por quê bloqueia** (custo de não saber),
**workaround interim** (o que dá pra fazer sem pesquisa), **fonte
ideal** (onde olhar primeiro).

Mantida pela Robin (research). Atualizar quando item for resolvido —
mover pra "Resolvido" no fim do doc.

> **Escopo deste arquivo**: research externo Phase-scoped — libs,
> RFCs, NIPs, padrões de mercado que exigem WebFetch/WebSearch pra
> resolver. Itens longos com **pergunta/bloqueia/workaround/fonte**.
>
> **NÃO confundir** com `BACKLOG.md` (raiz) — esse guarda decisões
> de sessão de chat (UX, refactors, rumos arquiteturais reportados
> pelo user). Sem overlap.

---

## Fase 6.1a (em andamento — `transport/webrtc.ts` + signaling mock)

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

---

## Fase 6 (Tauri shell — após 6.3)

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

### R21 — `@sqlite.org/sqlite-wasm` — saiu de pre-release?
**Pergunta**: pacote ainda só publica como pre-release (motivo do pin
exato em `package.json`), ou já tem versão estável `^3.x`?
**Por quê bloqueia**: pin manual em CI sangra a cada upgrade. Se
estabilizou, podemos relaxar pra `~3.51` ou `^3`.
**Workaround interim**: continuar pin exato. Funciona, só é tedioso.
**Fonte ideal**: `npmjs.com/package/@sqlite.org/sqlite-wasm`
versions tab; `sqlite.org/wasm`.

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
- **R1** (BroadcastChannel jsdom/Vitest 4.x) — ✅ resolvido 2026-05-17
  (Robin audit). jsdom 29 + Vitest 4.1.5 expõem `BroadcastChannel`
  nativamente; `tests/webrtcSignalingMock.test.ts` rodam clean com guards
  defensivos. Zero polyfill necessário.
- **R7** (STUN público confiável 2026) — ✅ resolvido por decisão
  2026-05-17 (Robin audit). Google STUN único (`stun.l.google.com:19302`)
  hard-coded em `src/lib/transport/webrtc/ice.ts`; Fase 6.4 shipped sem
  incidente. Multi-STUN só se telemetria mostrar falha.
- **R16** (Helia IPFS modular JS — release stable 2026) — ✅ resolvido
  2026-05-17 (Robin audit). `helia@^6.1.4` + `@helia/unixfs@^7.2.1`
  integrados em `src/lib/blobs.ts` + `helia.ts` + Settings UI (Track B
  IPFS opt-in). Lazy-loaded — sem custo no cold start.
- **R20** (Browser support matrix — Battery API) — 🗑 arquivado
  2026-05-17 (Robin audit, STALE). Modo `lan-wifi-only` do
  `archive/webrtc-seeding.md` virou archive sem implementar; referente
  da pergunta sumiu.
- **R22** (Análise de risco WebRTC mDNS papers 2024-2026) — 🗑 arquivado
  2026-05-17 (Robin audit, STALE). Threat model atual em
  `tests/webrtc-tor-mode-isolation.test.ts` + `audit(security)` commit
  `a0e1bc4`. Doc archive referenciado perdeu o referente.
- **R24** (`vite-plugin-pwa` + Workbox v8) — ✅ resolvido como "monitor
  passivo" 2026-05-17 (Robin audit). `vite-plugin-pwa@^0.20.0` +
  `workbox-window@^7.0.0` estáveis; Fase 5 fechada limpa. Reabrir se
  precache size virar gargalo Lighthouse.
- **R29** (Implementação NIP-56 kind 1984) — ✅ resolvido (data ≤
  2026-05-17). Drift dual-emit: `ReportModal.tsx` publica AMBOS kind
  9081 (interno) + kind 1984 (NIP-56 cross-client); `src/lib/events.ts`
  ingere kind 1984 de outros clientes. Ponte semântica entre Drift e
  ecossistema Nostr fechada.
- **R2** (RTCPeerConnection mockability 2025-2026) — ✅ resolvido como
  "decisão aceita" 2026-05-17 (Robin audit pós-cleanup). Fase 6.4 shipped
  `src/lib/transport/webrtc/` com 4 discovery mechanisms + bundle
  (commits `73c1687`). Sem mock lib externa adotada — e2e manual em 2
  abas continua workaround padrão. Reabrir se aparecer lib madura em
  2026-2027.
- **R9** (WebRTC + mDNS IP leak mitigations 2026) — ✅ resolvido como
  "monitor passivo" 2026-05-17 (Robin audit). `tests/webrtc-tor-mode-isolation.test.ts`
  ativo + `audit(security)` `a0e1bc4` cobrem threat model atual. Modo
  `always-on` documenta "vaza IP sem TURN" honesto. Reabrir se literatura
  nova mostrar vetor novo concreto.
- **R10** (Tauri Mobile estável 2026) — ✅ resolvido como "decisão
  arquitetural fechada" 2026-05-17 (Robin audit). Decisão de fato: Fase
  6.4 shipped **Tauri desktop** + Fase 7.1 antecipou **TWA Bubblewrap**
  (`v0.5.4` estável) pra Android. Tauri Mobile fica como follow-up
  oportunista — só migrar se TWA degradar. Reabrir quando Tauri Mobile
  bater 1.0 GA + tooling F-Droid maduro.

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

### R33 — Botão "atualizar" em Settings > Sobre — ✅ RESOLVIDO 2026-05-17
**Implementado em commit `4c9f5a8`**. `clearServiceWorkerAndReload`
exportado de `LazyBoundary.tsx`; `RefreshAppButton` em `AboutCardLayer`
(App.tsx). CTA sólido mint padrão novo; lazy import pra não acoplar
chunk.

---

## Cross-cutting — gaps identificados em audit 2026-05-17 (Robin)

### R34 — i18n libs 2026 — react-i18next vs FormatJS vs LinguiJS
**Pergunta**: estado 2026 das libs de internacionalização React. Drift
hoje é hardcoded PT-BR (com vocabulary lock — glossário canônico
SPREAD/BURY/DRIFT/SINK/DERIVA). Fase 7 distribuição global precisa
escolher antes de espalhar strings em 1 idioma.
**Por quê bloqueia**: bundle ratchet ≤250 KB entry — react-i18next +
ICU runtime parser podem somar +40 KB facil. Lingui (~5-7 KB compile-time)
ou Custom Zustand (~1-2 KB) cabem confortável. Decidir antes de
proliferar `t('foo.bar')` em ~80 arquivos.
**Workaround interim**: HIMYM Robin já fez recommendation curada em
sessão noite II (deliberation salva em log) — Lingui é favorito. Falta
spike de 1 dia + POC de 3 dias antes de produção.
**Fonte ideal**: bundle deltas medidos em `tests/bundle-chunks-conformance.test.ts`,
`bundlephobia.com` pra cada lib, `lingui.dev`, `react.i18next.com`,
`formatjs.io`.

### R35 — Trust Lens PPR — citation track Monte Carlo PageRank 2024-2026
**Pergunta**: papers acadêmicos recentes (2024-2026) sobre Personalized
PageRank Monte Carlo, log-transform de scores, e path diversity bonus
(Alvisi/Viswanath family). Phase 1 está implementado mas Phase 2 plan
referencia "literatura sólida" sem citation track.
**Por quê informa**: Phase 2 do Trust Lens (FORA integration, Vertex DVM,
NIP-85) será debatida em algumas semanas. Sem citation track, Robin
não consegue defender decisões arquiteturais contra reviewers externos
ou contributors novos.
**Workaround interim**: Phase 1 shipped sem precisar citation (math
limpa + conformance tests cobrem corretude). Phase 2 pode esperar
research adequada.
**Fonte ideal**: ACM Digital Library + arXiv (queries: "personalized
pagerank monte carlo", "sybil resistance random walk", "trust graph
gaming"); papers Viswanath et al. SybilLimit/SybilGuard;
`github.com/PaperWithCode/awesome-trust`.

### R37 — DriftAlert primitive variants 2026 (Sonner / Radix Toast / custom)
**Pergunta**: stack 2026 pra toast transient (não-persistent) — Sonner
(~6 KB gz), Radix Toast (~12 KB gz), react-hot-toast, ou custom Zustand
(~1 KB)? Drift hoje shipped `DriftAlert.tsx` (commit `7cf4ec0`) pra
banners persistentes (info/warning/danger). Próximo step natural é
toast transient (operação completada, erro recuperável, network status).
**Por quê informa**: bundle ratchet ≤250 KB exige escolha consciente.
Mesma família de decisão que R34 (i18n) e R36 (icons). Custom dá
controle total mas requer manutenção.
**Workaround interim**: usar DriftAlert atual com setTimeout dismiss
quando toast for necessário. Aceita pra 1-2 uses. Se virar pattern
recorrente, fetch decisivo.
**Fonte ideal**: `sonner.emilkowal.ski`, `radix-ui.com/primitives/docs/components/toast`,
`react-hot-toast.com`, `bundlephobia.com` pra deltas.

### R38 — Compose preview / draft persistence patterns 2026
**Pergunta**: como apps social tier-1 (Twitter, Bluesky, Mastodon)
implementam: (a) preview pré-publish; (b) draft persistence (RAM vs
local encrypted vs server)? Drift compose hoje é fire-and-forget.
Manifesto §4 (device descartável) + §28 (privacidade mínima) — draft
deve viver em OPFS encrypted ou só RAM?
**Por quê informa**: BACKLOG item "Publicar → Prévia do post" + risco
de UX perdida se app crash mid-compose. Decisão arquitetural antes
de implementar.
**Workaround interim**: ship "Prévia do post" sem persistence (RAM-only).
Adiciona draft layer depois se user pedir.
**Fonte ideal**: blog Bluesky engineering, Mastodon source (clients
Tusky/Ivory/Elk), Twitter compose teardown.

### R39 — Onboarding patterns p/ features novel (Trust Lens / Sua Lente)
**Pergunta**: Drift PR-5 (`c89774b`) shipped SuaLenteCard UI mas
onboarding (primeiro encontro do user com o conceito de Lente) é
hardcoded em prose. Conceito é novel — sem prior art exato. Como
Mastodon onboard "advanced settings"? Como Bluesky onboard
"algorithmic feeds" (feeds são CONCEITO novo do Bluesky AT proto)?
**Por quê informa**: user feedback "SuaLenteCard interface confusa".
Polish UX precisa research em onboarding de features opt-in advanced
antes de redesign aleatório.
**Workaround interim**: rodar HIMYM Lily quick polish (labels +
helper text + CTA "ver feed agora") em sessão dedicada.
**Fonte ideal**: Bluesky design notes, Mastodon UX research,
"onboarding for power features" pattern libraries (UX Collective,
Nielsen Norman).

### R36 — SVG icon libraries 2026 — Lucide vs Heroicons vs Phosphor vs Tabler
**Pergunta**: comparativo 2026 das libs de icon SVG React. Drift hoje
tem icons custom em `src/components/UI/Icons.tsx` (Feather-style MIT
lineage). Sprint 2-3 SVG migration recém-fechada (`bff07ad`, `f9a529f`)
adicionou ~10 icons custom. Worth migrar pra lib externa pra cobrir
mais use cases (50+ icons potenciais ao longo do app)?
**Por quê informa**: cada icon custom = ~50 linhas SVG + risco de
inconsistência stroke/size. Lib externa = manutenção zero + bundle
crescimento controlado por tree-shaking. Mas dep externa = risco
abandonware (Feather original parou em 2018).
**Workaround interim**: continuar adding icons custom à medida que
precisar (~3-5 por sprint). Decidir migration quando inventory passar
~25 icons custom (ponto onde manutenção começa a pesar).
**Fonte ideal**: `lucide.dev` (fork ativo do Feather, MIT, ~1450 icons),
`heroicons.com` (Tailwind team, MIT, ~300 icons), `phosphoricons.com`
(MIT, ~9000 icons, multi-weight), `tabler-icons.io` (MIT, ~5400 icons).
Bundle impact via `bundlephobia.com`.

---

*Documento mantido (atribuição original: papel de research/curadoria).
Última atualização: 2026-05-17 (Robin re-audit pós-cleanup).*
*Itens originais: 25 → 39 (14 novos R26-R39). Resolvidos: 15 (R1, R2,
R3, R4, R5, R7, R9, R10, R11, R12, R16, R23, R24, R25, R29, R33) + 2
STALE arquivados (R20, R22). Ativos: ~19 ainda em aberto.*
