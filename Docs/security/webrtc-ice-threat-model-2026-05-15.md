# Threat Model — WebRTC ICE Leakage

| Field         | Value                                                            |
|---------------|------------------------------------------------------------------|
| Title         | WebRTC ICE leakage — auditoria de superfície + roadmap mitigação |
| Date          | 2026-05-15                                                       |
| Author        | Barney (peer review crítico — security)                          |
| Status        | Draft · pendente sign-off Marshall (conformance) + Ted (arch)    |
| Manifesto     | §4 (anonimato), §15 (anti-censura), §17 (sem chave mestra), §28 (privacidade) |
| Arquitetura   | v5.3 §30.13 (WebRTC off em modo Tor)                             |
| Relacionado a | RFC Fase 6 Tor integration (`Docs/rfcs/2026-05-rfc-fase6-tor-integration.md`, commit `12327cf`), `Docs/webrtc-threats.md` (T-WRTC-001/002/003 — 2026-04-28) |
| Escopo        | T1–T6: vetores de **leak/correlação** especificamente ligados a ICE candidates, STUN/TURN servers e à coexistência com modo Tor |

Este documento é **complementar** ao threat model genérico de WebRTC
(`Docs/webrtc-threats.md`, T-WRTC-001..023) e **complementar** à RFC
Fase 6 Tor (commit `12327cf`). O foco aqui é mais estreito e mais novo:
**leakage de identificadores de rede via ICE/STUN** sob o modelo de
ameaça de §15 (adversário Estado-nação observador de tráfego do user) e
§28 (mínimo necessário de privacidade).

T-WRTC-001/002/003 do doc 2026-04-28 cobrem **leak peer-to-peer** (peer
hostil aprende IP da vítima durante handshake). Aqui o foco é a
**dimensão mais ampla**:

- Adversário tem capacidade de observar **redes STUN públicas** (T1).
- Adversário tem capacidade de observar **signaling Nostr** (T2).
- Usuário deliberadamente escolheu **Tor** como camada de anonimato (T3).
- Logs/telemetria do próprio cliente expõem ICE state (T4).
- Cruzamento de STUN srflx com **geolocation databases** públicas (T5).
- Host candidates revelam **topologia LAN** completa, não só IP único (T6).

Por que doc novo em vez de extensão do existente: T-WRTC-001 e T-003 do
doc 2026-04-28 estão classificados como "Aceito com mitigação" baseado
em modos `lan-wifi-only`/`relay-mode`/`tor-mode` — **modos que nunca
foram implementados como tal**. Em 2026-05-15 o gate efetivo é
`network_mode ∈ {tor, onion-only}` desativando WebRTC inteiro
(`bootstrap.ts:333`, `seeder.ts:65-75`). O resto é clearnet padrão.
Re-classificar lá quebra a história datada do doc; criar threat model
novo permite avaliar o estado atual com lente atualizada e linkar com a
RFC Tor (que tem custos UX/operacionais pendentes mas é a única defesa
real hoje contra T1/T5/T6 no PWA).

---

## 1. Modelo de adversário

| Adversário                                  | Capacidade                                                                                          | Aplicável a |
|---------------------------------------------|-----------------------------------------------------------------------------------------------------|-------------|
| **A1 — Operador STUN público**              | Observa todos os STUN requests; mantém log {timestamp, IP src, port src, requested peer}            | T1, T5      |
| **A2 — Relay Nostr passivo**                | Lê event metadata kind 1059 (signaling DM): {from_pubkey, to_pubkey, created_at, IP do publisher}   | T2, T5      |
| **A3 — ISP / observador de rede do user**   | Capacidade Wireshark/DPI; vê SNI, IPs destino, padrões temporais                                    | T1, T3, T6  |
| **A4 — Estado-nação com gag order**         | Combina A1+A2+A3; subpoena providers; correla bases de dados (BGP, GeoIP, registros telecom)        | T1, T3, T5  |
| **A5 — Atacante in-process (cliente comprometido)** | Pode forjar `Date.now()`, ler IndexedDB, exfiltrar nsec                                     | Out-of-scope (já é game-over) |

Adversário-base de referência: **A4** (estado-nação). Manifesto §15
estabelece isto explicitamente — defesa contra ISP e estado-nação é
compromisso, não aspiração. A1 e A2 separados também são adversários
realistas (Google opera STUN público; relay operators tem visibilidade
de metadata).

---

## 2. Threats T1–T6

### T1 · STUN correlation — operador STUN mapeia pubkey ↔ IP WAN

| Campo            | Valor |
|------------------|---|
| Adversário       | A1 (operador STUN) + A2 (relay) cruzando logs |
| Vetor            | Cliente Drift em clearnet abre RTCPeerConnection com `iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]` (`webrtc/ice.ts:23-25`). Browser envia STUN Binding Request → server responde com IP:port WAN (server-reflexive). Operador STUN registra request. Simultaneamente, signaling Nostr kind 1059 (em modo Nostr) é publicado pela mesma instância (`webrtc-signaling-nostr.ts:251-255`). Cruzando timestamps + IP src visto pelo relay + timestamp do STUN request, A1+A2 derivam `pubkey ↔ IP WAN` com confiança alta. |
| Pré-requisito    | (a) WebRTC habilitado, (b) network_mode = `clearnet`, (c) STUN público padrão (Google) |
| Impacto          | **Confidentiality — alto**. Deanonimização do npub. Pseudonimato Drift colapsa. |
| Probabilidade    | **Alta**. Acontece em todo handshake — não requer "ataque", é o protocolo. |
| Severidade       | **Crítica** — viola manifesto §4 e §28 sob A1+A2 cooperando. |
| Diferença vs T-WRTC-001 | T-WRTC-001 trata **peer hostil** como adversário (peer aprende IP). T1 trata **operador STUN passivo** que nunca participou do handshake (sabe só de um lado). Surface é maior — qualquer client que **tente** WebRTC sangra pro Google STUN, mesmo se a conexão P2P jamais completar. |

### T2 · Eavesdrop signaling — relay Nostr correla pubkey, target, padrão temporal

| Campo            | Valor |
|------------------|---|
| Adversário       | A2 (relay) — kind 1059 NIP-44 DM é cifrado, mas metadata é público |
| Vetor            | `webrtc-signaling-nostr.ts:35` define `SIGNALING_KIND = 1059`. Cada offer/answer/ice trickle gera um kind 1059 (`webrtc-signaling-nostr.ts:251-255`). Relay vê: `{event.pubkey (sender npub), tags[0]=['p', target_npub], created_at, IP TCP src}`. Não lê SDP/ICE (NIP-44 cifrado), mas obtém **grafo bidirecional** A↔B + frequência. Combinado com NIP-02 follows (`kind:3` desabridos no mesmo relay), atacante mapeia "quem WebRTC com quem". |
| Pré-requisito    | WebRTC habilitado + signaling Nostr real (flag `VITE_USE_NOSTR_SIGNALING=1`, hoje OFF default em prod) |
| Impacto          | Confidentiality — **médio-alto**. Não vaza conteúdo, vaza **grafo social P2P**. Sob A4, grafo + IP src público (visto pelo relay no TCP socket) compõem identificação. |
| Probabilidade    | Média hoje (flag default OFF). **Alta** quando WebRTC P2P sair de dev (Fase 6.x). |
| Severidade       | **Alta** quando ativado. |
| Diferença vs T-WRTC-005 | T-WRTC-005 trata interesse semântico ("quem segue quem"). T2 trata **infra P2P** (quem tenta abrir DataChannel com quem). É observação mais fina e ocorre fora da camada de conteúdo. |

### T3 · WebRTC durante Tor — usuário sob anonimato perde IP via STUN

| Campo            | Valor |
|------------------|---|
| Adversário       | A1 + A3 — qualquer um sozinho consegue |
| Vetor            | User selecionou `network_mode = 'tor'` em `NetworkModeCard`. Esperativa: nenhum identificador de rede vaza. Realidade pre-fix: WebRTC `RTCPeerConnection` usa **socket nativo do browser**, não a `WebSocket` injetada (`TorWebSocket`). STUN packet é **UDP direto** (browser sequer roteia via SOCKS5). User abre `SpreadMap` (component que dispara `seedFromSpreaders`) → `connectTo(peerNpub)` → `new RTCPeerConnection({ iceServers: [...] })` → STUN request **escapa o tunel Tor** e vaza IP WAN claro pro Google. A4 observando ISP vê tráfego pra `stun.l.google.com:19302` UDP simultâneo com tráfego Tor TCP — assinatura clara de cliente Drift. |
| Mitigação atual  | Gate em `bootstrap.ts:333` (`if (networkMode === 'clearnet') { registerTransport(webrtcTransport, …) }`) — **só registra transport quando clearnet**. Reforço em `seeder.ts:65-75` (gate idêntico na porta de discovery). Combinado: em modo Tor/onion-only WebRTC nunca é carregado (lazy import `bootstrap.ts:334` nem dispara) e seeder retorna 0. Decisão registrada em arquitetura §30.13 e referenciada em RFC Tor (commit `12327cf`) §1 ponto 6 "Onion-only mode interage mal com WebRTC". |
| Pré-requisito    | (a) User selecionou Tor, (b) bug de regressão que removesse o gate, OU (c) novo call site abrindo RTCPeerConnection sem checar `network_mode`. |
| Impacto          | **Confidentiality — crítico**. User pediu anonimato; cliente vaza tudo. Quebra promessa §4 explícita. |
| Probabilidade    | Baixa hoje (gate existe + 2 layers). **Média** sob refactor: novo desenvolvedor toca apenas `bootstrap.ts` e esquece `seeder.ts`, ou inverso. Não há test cobrindo o gate. |
| Severidade       | **Crítica** se regredir — manifesto §4 viola direto. |
| Linkage com RFC Tor | RFC 2026-05 commit `12327cf` §1 ponto 6 documenta que "WebRTC fica off em modo `tor` puro (não onion-only) também", remetendo a decisão pra arquitetura §30.13. RFC §3 ("Non-goals") reafirma: "NÃO substitui WebRTC P2P por Tor". RFC §4.3 (TorIntroDialog) lista isso como limitação a comunicar pro user pré-toggle. |

### T4 · ICE candidate logs — telemetria local vaza candidates pra disco/sentry

| Campo            | Valor |
|------------------|---|
| Adversário       | A5 + A3 indireto (se logs forem exportados, supplyported para sentry/analytics externo) |
| Vetor            | `peer.ts:88-98` registra `pc.onicecandidate` que faz `ch.send({ type: 'ice', candidate: ev.candidate.toJSON() })` — envia via signaling pro peer (esperado). **Mas adicionalmente**: se algum dia algum logger console (`console.log`/`console.warn`) imprimir o candidate completo (host IP, srflx IP, raddr, rport, foundation), o IP vai parar em telemetria local (DevTools, Sentry, qualquer wrapper de logs do user). Hoje `peer.ts:164` loga só `remoteId.slice(0, 8)` (8 chars do npub) em ICE timeout — **não vaza candidate**. `health.ts:103-108` também não loga candidate. **Risco residual**: nenhum lint rule impede log futuro. PR descuidado adicionando `console.log('ICE candidate:', ev.candidate)` pra debug e esquecendo de remover vaza host IP em prod. |
| Pré-requisito    | (a) Regressão de log negligente, OU (b) integração Sentry/Datadog/analytics que capture `console.warn`, OU (c) telemetria de erro que serialize objeto exception incluindo `RTCIceCandidate.candidate` field como string SDP-like. |
| Impacto          | Confidentiality — **médio**. Logs locais não vazam até serem exfiltrados; mas Sentry/wrapper já é exfiltração-por-design. |
| Probabilidade    | Baixa hoje. Média sob crescimento de tooling de observabilidade. |
| Severidade       | Média — pré-condições são detectáveis em review. |

### T5 · Geo correlation — srflx IP + GeoIP públicos derivam cidade/ISP da vítima

| Campo            | Valor |
|------------------|---|
| Adversário       | A1 ou A4 com acesso a base GeoIP comercial (MaxMind, IP2Location) |
| Vetor            | Server-reflexive candidate contém IP WAN do user (T1 ou T-WRTC-001). IP WAN + MaxMind GeoIP-City = `(país, cidade, ASN, ISP, lat/lon ±5 km)`. Em país pequeno + ISP regional, isso é deanonimização efetiva. Combinado com `location` tag opcional em posts Drift (kind 9078 manifesto §27, mas off-default Fase 3), atacante cruza "user posta de cidade X (location tag, opt-in)" com "WebRTC srflx vem de IP de ISP Y em cidade X" → confirma identidade física. |
| Pré-requisito    | (a) STUN srflx exposto (T1 path), (b) acesso a base GeoIP (comercial, ~$0-$100/mês — barreira mínima pra A4) |
| Impacto          | Confidentiality — **alto**. Manifesto §28 lista geolocation como compromisso explícito a preservar. |
| Probabilidade    | Alta sob A4. Adversário-base do manifesto §15 tem isso trivialmente. |
| Severidade       | **Alta**. T1 sem T5 já é ruim; T5 é o ataque que torna T1 conversível em ação física (visita, subpoena). |

### T6 · Local IP via host candidates — topologia LAN inteira vaza

| Campo            | Valor |
|------------------|---|
| Adversário       | Peer remoto B (caso T-WRTC-003 expandido) + A4 quando peer remoto for cooptado |
| Vetor            | Host ICE candidates carregam todos os IPs interface-locais: `192.168.1.42` (LAN doméstica), `10.0.0.5` (VPN corp), `fe80::*` (link-local IPv6), eventualmente IPs Tailscale/ZeroTier/WireGuard. Chrome 76+ ofusca por mDNS hostname (`*.local`) mas (a) Firefox não ofusca por default em todos os contextos, (b) mDNS é apenas hostname — quando o peer remoto **responde STUN** ele descobre o IP real, (c) raddr/rport em prflx candidates leakam mesmo com mDNS. Peer remoto B aprende não apenas o IP WAN da vítima mas o **mapa interno**: subnet do roteador (192.168.1.0/24 → roteador é 192.168.1.1), número de interfaces, presença de VPN. Pra A4 cooptando B (cooperação forçada, NSL-style), isso é recon completo da rede da vítima sem nunca tocar nela. |
| Mitigação parcial | mDNS hostname obfuscation (Chrome) cobre **host** candidates apenas. Não cobre srflx (T1) nem prflx (peer reflexive). `iceTransportPolicy: 'relay'` em RTCConfiguration suprimiria host completos forçando todo tráfego via TURN, **mas hoje não está configurado** (`webrtc/peer.ts:69` cria PC com `iceServers` only, sem `iceTransportPolicy`). |
| Pré-requisito    | WebRTC em clearnet + peer remoto receptivo (ICE chega ao ponto de trocar candidates). Sob caps de MAX_PEERS+blacklist um peer hostil único é abafado, mas vetor existe na janela pré-blacklist. |
| Impacto          | Confidentiality — **alto**. T-WRTC-003 do doc 2026-04-28 cataloga isso como "Aceito com avisos default `lan-wifi-only`" — mas modo `lan-wifi-only` nunca foi implementado como tal. O default real é "host + srflx vaza". |
| Probabilidade    | Alta — comportamento default. |
| Severidade       | Média-Alta. Cresce sob A4 cooptando peers via NSL. |

---

## 3. Mitigações atuais — evidência file:line

### Gate principal — WebRTC OFF em modo Tor/onion-only

| Local | Linhas | Evidência |
|---|---|---|
| `src/lib/bootstrap.ts` | `333-341` | `if (networkMode === 'clearnet') { void import('./transport/webrtc').then(({ webrtcTransport }) => { registerTransport(webrtcTransport, { weight: 5 }) }) }` — lazy import gateado por modo. Em modo Tor/onion-only o módulo `webrtc/` **não baixa** (chunk webrtc não entra no bundle desta sessão), `webrtcTransport` nunca é registrado no orchestrator, publish via `wssTransport` (que tunelado por TorWebSocket — `torWebSocket.ts:298-304`). |
| `src/lib/seeder.ts` | `65-75` | `if (networkMode !== 'clearnet') return 0` — gate adicional. `SpreadMap` chama `seedFromSpreaders(postId)` ao abrir map; o gate aqui previne que `connectTo()` seja chamado mesmo se algum call site futuro carregar `webrtcTransport` por engano. Defesa em profundidade. |
| `src/lib/transport/torWebSocket.ts` | `298-304` | `installTorWebSocketImpl()` substitui `WebSocket` global do `nostr-tools/pool` por `TorWebSocket`. Garante que **tráfego WSS** roteia via Tor. Não cobre WebRTC (UDP/STUN). |

Cobertura efetiva: em modo Tor, **nenhum RTCPeerConnection é criado**.
T3 é fechado pelo design, **desde que o gate sobreviva refactors**.

### Mitigações de defesa-em-profundidade contra peer hostil (cat 1/2)

| Threat        | Local                                  | Linhas    | Mitigação |
|---------------|----------------------------------------|-----------|-----------|
| T-WRTC-001/T1 | `webrtc/config.ts`                     | `54-56`   | `MAX_PEERS: 32` — cap absoluto. Reduz superfície de quantos peers aprendem IP. |
| T-WRTC-006/T2 | `webrtc/peer.ts`                       | `57-67`   | `peerCount() >= WEBRTC_LIMITS.MAX_PEERS` → reject. |
| T-WRTC-006/T2 | `webrtc-signaling-nostr.ts`            | `54-55`   | `RATE_LIMIT_PER_SENDER = 10` em janela 60s — bot Sybil custa caro. |
| T2 (signaling) | `webrtc-signaling-nostr.ts`           | `35`      | `SIGNALING_KIND = 1059` (NIP-44 wrap) — content cifrado AEAD. **Mas metadata pubkey+target+ts permanece público no relay** — T2 ainda válido. |
| T-WRTC-012 (replay) | `webrtc-signaling-nostr.ts`     | `47-69`, `132-143` | Future-skew clamp `60s` + LRU dedup `event.id` TTL 5min + cap 5000. |
| T-WRTC-013 (cross-proto) | `webrtc/pipeline.ts`     | `78-88`   | Kind check pré-verify + cross-proto window 24h + threshold 10 + blacklist 1h. |
| T-WRTC-008 (DC flood) | `webrtc/rateLimit.ts`         | `47-89`   | Token bucket 100 msg/s sustained, 200 burst. 3 violações em 60s → kill + cleanup + blacklist. |
| T4 (logs)     | `webrtc/peer.ts`                       | `58-66`, `164` | Logs só imprimem `remoteId.slice(0, 8)` (npub prefix). Nenhum log atual vaza ICE candidate completo. |

### Mitigações que NÃO existem hoje (gaps relevantes)

| Threat | Gap |
|---|---|
| T1 (srflx leak)    | Nenhum. Modo `relay-mode` (TURN-only, `iceTransportPolicy: 'relay'`) descrito em T-WRTC-001/T-WRTC-003 doc 2026-04-28 **nunca foi implementado**. Default é "todos os candidatos" — host + srflx + prflx. |
| T1 (STUN provider) | Hard-coded `stun:stun.l.google.com:19302` (`webrtc/ice.ts:23-25`). Sem fallback/rotação; Google vê todo handshake. |
| T2 (signaling)     | Default `VITE_USE_NOSTR_SIGNALING=undefined` (= mock BroadcastChannel) — em prod hoje signaling Nostr não dispara, então T2 está dormente. Quando ativar (Fase 6.x), nenhuma mitigação cobre metadata leak. |
| T4 (logs)          | Nenhum lint rule impedindo `console.log(ev.candidate)`. ESLint rule sugerida em T-WRTC-022 contra `Math.random` em transport/ é precedente; análoga rule contra log de ICE seria barata. |
| T5 (geo)           | Mitigação direta requer suprimir srflx — só é viável via T1 mitigation (TURN-only ou Tor). |
| T6 (host candidates) | mDNS obfuscation é do browser, não do app. App não força `iceTransportPolicy: 'relay'`. |
| Test coverage do gate | Nenhum test em `tests/` cobrindo a invariante "modo Tor desativa WebRTC". Regressão silenciosa possível. |

---

## 4. Mitigações recomendadas — P1 / P2 / P3

Convenção:
- **P1** = bloqueia §4/§15/§28 sob A4. Implementar antes de WebRTC P2P sair de DEV.
- **P2** = reduz superfície significativamente. Implementar em Fase 6.x junto com RFC Tor sub-etapas.
- **P3** = hardening incremental, follow-up.

### P1 — Regression guard pro gate Tor↔WebRTC (T3)

**Problema**: gate em `bootstrap.ts:333` + `seeder.ts:65-75` é correto
hoje. Mas sob refactor (split de módulos, novo desenvolvedor, etc.) é
trivialmente removível sem test falhar. Manifesto §4 silently broken.

**Mitigação proposta** — adicionar test em `tests/`:

```ts
// tests/transport-tor-disables-webrtc.test.ts (proposta)
// Mock getPrefs() retornando network_mode='tor', monitorar
// registerTransport calls, assert webrtcTransport NUNCA registrado.
// Mesmo pattern pra 'onion-only'. Assert seeder retorna 0 em ambos.
```

Test puro em Node (sem RTC real). ~30 LOC. Quebra de gate = test
vermelho. **Custo**: 1-2h. **Owner sugerido**: Marshall (conformance).

### P1 — Documentar invariante "WebRTC OFF sob Tor" no CLAUDE.md

**Problema**: invariante hoje é implícita (vive em 2 file:lines +
comentário inline). CLAUDE.md não menciona. Lily/Ted onboarding pode
escapar.

**Mitigação proposta**: adicionar item na seção "Invariantes" do
`CLAUDE.md` — sugestão de wording:

> ### 18. WebRTC OFF em modo Tor/onion-only
>
> `network_mode ∈ {tor, onion-only}` desativa o `webrtcTransport`
> globalmente. Gate em `bootstrap.ts:333` (registro) + `seeder.ts:65`
> (discovery) — ambos checam `getPrefs().network_mode === 'clearnet'`.
> Manifesto §4: STUN/ICE vazam IP via UDP direto (sem proxy SOCKS5),
> bypassando o tunnel Tor. Test `tests/transport-tor-disables-webrtc.test.ts`
> guarda regressão. Decisão arquitetura §30.13.

**Custo**: 5 min edit. **Owner**: arquiteto da RFC Tor (sub-etapa
6.4.12 sign-off).

### P2 — TURN-only mode (`iceTransportPolicy: 'relay'`) como opt-in P1

**Problema**: T1, T5, T6 todos sangrar via srflx + host candidates.
Suprimir tudo isso requer forçar TURN.

**Mitigação proposta**: adicionar preference `webrtc_ice_policy:
'all' | 'relay'` (default `'all'`). Quando `'relay'`:
1. `webrtc/peer.ts:69` passa `iceTransportPolicy: 'relay'` no
   `RTCConfiguration`.
2. Requer TURN configurado (`VITE_TURN_SERVERS` populado ou pref
   per-user).
3. UI Settings (`NetworkModeCard` ou seção nova) educa: "WebRTC só
   via TURN — esconde IP do peer remoto mas vaza pro operador TURN. Use
   TURN self-hosted ou confiável."

Acompanha first-run dialog análogo ao `TorIntroDialog` (RFC §4.3).

**Custos**: ~3-4d (pref store + UI + ICE config + intro dialog +
i18n). **Owner**: futuro Ted, alinhado com Fase 6.x (depois da
distribuição binária Tauri — antes disso, modo Tor é mais forte e
suficiente pro user paranóico).

### P2 — Rotação/diversificação de STUN servers + opt-out

**Problema**: hardcoded `stun.l.google.com:19302` é vetor T1
mono-operator. Google sabe de todo handshake Drift em clearnet.

**Mitigação proposta**:
1. Lista de STUN servers em `webrtc/ice.ts` com 3-5 providers:
   `stun.l.google.com`, `stun.cloudflare.com`, `stun.nextcloud.com`,
   etc. Browser tenta em paralelo (comportamento default).
2. Pref `webrtc_stun_disabled: boolean` (default `false`). Quando
   `true`, lista vazia — só host candidates funcionam (LAN only, mais
   privado mas inútil pra mobile 4G). Útil pra user em LAN doméstica
   que não quer mandar nem 1 packet pra Google.
3. Documentar em settings que STUN servers veem **timestamp + IP src
   do user**. Manifesto §28.

**Custos**: ~1d. **Owner**: futuro Ted ou Marshall, follow-up.

### P3 — ESLint rule contra log de ICE candidate (T4)

**Problema**: nenhuma defesa formal contra PR negligente logando
`ev.candidate`.

**Mitigação proposta**: ESLint custom rule
`drift/no-ice-candidate-log` em `eslint.config.js`. Detecta:
- `console.*(.+candidate.+)` regex em arquivos `src/lib/transport/webrtc/**`
- `JSON.stringify(ev)` onde `ev` é `RTCIceCandidate`/`RTCPeerConnectionIceEvent`

Análogo ao precedente em T-WRTC-022 (`no-restricted-globals` contra
`Math.random` em transport/). **Custos**: ~2-3h. **Owner**: Lily.

### P3 — Telemetria de gate-bypass attempts

**Problema**: se gate algum dia falhar (regressão), nenhum sinal
chega a dev.

**Mitigação proposta**: em `webrtc/peer.ts:getOrCreatePeer`, antes de
criar `RTCPeerConnection`, ler `getPrefs().network_mode` e **assertar
runtime** que é `'clearnet'`. Se não, `console.error` + abort.
Custo de runtime: 1 read síncrono da store Zustand por peer-create
(barato). Não substitui test P1; é segunda camada — sob refactor que
quebre o gate mais alto, este pega no last mile.

**Custos**: ~30min. **Owner**: Lily.

### P3 — Re-classificar T-WRTC-001/T-WRTC-003 no doc 2026-04-28

**Problema**: doc 2026-04-28 marca T-WRTC-001 como "Aceito com
mitigação" referenciando modos `lan-wifi-only`/`relay-mode` que nunca
foram implementados. Documentação está desalinhada com código.

**Mitigação proposta**: editar `Docs/webrtc-threats.md` com
nota cabeçalho "Re-classificação 2026-05-15" remetendo a este doc.
Marcar T-WRTC-001 e T-WRTC-003 como "Aceito apenas em modo Tor; em
clearnet permanece aberto. Mitigação real depende de P2 (TURN-only
mode)". Cap doc com data e linkar T1/T5/T6 daqui como continuação.

**Custos**: ~30min edit. **Owner**: Robin (research/curadoria —
manter docs sintonizados).

---

## 5. Linkage com RFC Fase 6 Tor (commit `12327cf`)

A RFC Fase 6 Tor (`Docs/rfcs/2026-05-rfc-fase6-tor-integration.md`,
commit `12327cf`) é o **vetor de defesa primário** contra T1, T3 e T5
em PWA. Pontos de contato:

### 5.1 RFC §1 ponto 6 — "Onion-only mode interage mal com WebRTC"

RFC documenta: "em modo `tor` simples (não onion-only), WebRTC
também é desligado. Decisão registrada (§30.13) mas vale anotar: §15
garantia em modo `tor` é só pro WSS; rede P2P fica off. Aceitável, mas
user não sabe."

Este doc **complementa**: o gate efetivo está em `bootstrap.ts:333`
e `seeder.ts:65-75`. T3 é fechado **se gate sobrevive**. Recomendação
P1 (regression test) é pré-condição pra que a afirmação da RFC continue
verdadeira sob refactor.

### 5.2 RFC §3 ("Non-goals") — "NÃO substitui WebRTC P2P por Tor"

RFC declara: "WebRTC continua off em modo Tor (decisão §30.13). Pra
rede mesh sob censura, Fase 7+ endereça via i2p/sneakernet/relay
autohospedado."

Este doc **valida**: a decisão de não substituir é correta sob T1/T5/T6
— STUN/ICE são UDP direto, não roteáveis via SOCKS5 do arti. Não há
"WebRTC sobre Tor" viável no PWA. Cliente nativo Tauri poderia em tese
forçar todos os UDP via arti DataStream, mas arti não suporta UDP
estável (Tor v3 é TCP-only end-to-end pro circuit, exit policy raramente
permite UDP). Conclusão: P2P + anonimato fica em hold até Fase 7
sneakernet.

### 5.3 RFC §4.3 — `TorIntroDialog` first-run

RFC propõe dialog educacional ao habilitar Tor pela 1ª vez. Bullets:
- "O que muda: IP não vaza pros relays."
- "**Limitação: WebRTC fica off (P2P direto vazaria IP via STUN).**"

Este doc **respalda**: a limitação listada é exatamente T3. UX clear
ao user paranóico vale mais que tentativa imperfeita de tunelar WebRTC.

### 5.4 RFC §4.7 — CI `--features arti` build + smoke

RFC propõe smoke script reproduzindo Wireshark 2026-05-01 ("zero SNI
de relay Nostr em modo onion-only"). **Este doc sugere extensão**: o
smoke deveria também assertar **zero packets STUN UDP saindo** durante
operação Tor. Hoje o gate previne isso construtivamente, mas teste
empírico via PCAP fecha o loop de confiança. Sugerido como
sub-etapa da 6.4.11 ou bloco follow-up.

### 5.5 RFC §6 sub-etapa 6.4.6 — bootstrap progress events + timeout

Não cruza diretamente com este threat model. Out-of-scope.

### 5.6 RFC §7 open question 5 — strings i18n

Out-of-scope.

---

## 6. Conclusão — priorização imediata

3 itens de menor custo / maior alavanca:

1. **P1 — Test regression guard do gate Tor↔WebRTC**. Sem isso,
   manifesto §4 fica refém de "ninguém quebrou ainda". Custo ~2h,
   ROI altíssimo. Owner Marshall.

2. **P1 — Adicionar invariante #18 no CLAUDE.md**. Custo ~5min. Faz
   diferença em onboarding e em revisão de PRs futuros que toquem
   `bootstrap.ts:registerTransport` ou abram novo call site de
   `connectTo`.

3. **P3 — Re-classificar T-WRTC-001/T-WRTC-003 em `Docs/webrtc-threats.md`**.
   Custo ~30min. Mantém docs consistentes. Owner Robin.

Itens P2 (TURN-only mode, STUN rotation) alinham com a Fase 6.x junto
da distribuição binária Tauri — não fazem sentido isolados antes do
modo Tor estar visualmente acabado (NetworkBadge + first-run dialog).

Resto fica aberto e datado pra audit pós-Fase 6.x. Re-audit
recomendada **após** sub-etapa 6.4.12 da RFC Tor (sign-off
Barney/Marshall + matrix update) — neste momento conhecemos UX real
do user em modo Tor e podemos avaliar T2 ativado em prod.

---

*Manifesto §4 — "Anonimato por design". Este threat model é a base
operacional desse compromisso para a superfície ICE/STUN.*

*Última atualização: 2026-05-15 · Barney peer review · pending sign-off
Marshall (conformance T-row → file:line) + Ted (arch — P2 prioritização
vs sub-etapas RFC Tor)*
