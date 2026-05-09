# §15 anti-censura — E2E testbed scoping

**Data:** 2026-05-08
**Persona:** Robin (research, curadoria, gaps cross-cutting, docs)
**Escopo:** scoping doc pra montar um testbed end-to-end que valide
empiricamente o compromisso de manifesto §15 (anti-censura por país).
**Não-escopo:** implementar o testbed, modificar código, decidir owner
final. Doc-only.
**Disparo:** Ted review 2026-05-08 §6 R5 — §15 sendo entregue por capacidades
técnicas dispersas (Tor + WebRTC + multi-transport orchestration), sem owner
de "experiência §15 end-to-end".

> ⚠ **ARTEFATO DE SESSÃO** — registro pontual de scoping. Não é
> documentação normativa. Decisões aqui (owner, fases, métricas) viram
> norma só se Arquiteto aprovar e propagar pra `Docs/fase-6-roadmap.md`
> e/ou `manifesto.md` roadmap.

---

## §1 — Compromisso de manifesto

Manifesto v2.2 §15 é citado *verbatim* abaixo (linhas 290–310 de
`Docs/manifesto.md`):

> **15. Anti-Censura por País**
>
> Um Estado-nação que tenta bloquear o Drift na sua jurisdição não
> deve conseguir mais do que tornar o uso menos conveniente.
>
> **Regras:**
> - Bloqueio por DNS é contornável (PWA + IP direto + Tor)
> - Bloqueio por SNI/DPI dos relays clearnet é contornável (Tor + WebRTC)
> - Bloqueio das app stores é contornável (APK direto, F-Droid, PWA)
> - Bloqueio do dev server / domínio do fundador não derruba a rede
>   (cliente já distribuído continua funcionando, eventos seguem em
>   relays fora da jurisdição, mais clientes podem ser distribuídos por
>   qualquer outro canal)
> - Custo do adversário cresce com o uso: censurar 100 relays é mais
>   caro que censurar 4
>
> **Implementação:**
> - §12 (múltiplos transportes) + §14 (bootstrap distribuído) + §1
>   (cliente em múltiplas formas) — combinação que cumpre §15
> - Documentação pública "como instalar Drift em país censurado" no
>   GitHub do projeto (Fase 5)
> - Tutorial de auto-hospedagem de relay (Fase 5)

**Por que merece track próprio (Ted §6 R4):**
§15 é compromisso de "vão acontecer" do roadmap (manifesto linha 963).
Hoje, a entrega é por capacidades dispersas — **sem teste de integração
end-to-end** que dê garantia empírica de que as regras acima são
cumpridas em condição real. Componentes individuais shipped, smoke test
de Tor isolado VERIFIED em 2026-05-01, mas o cenário composto
"clearnet bloqueado → Tor toma over → Tor bloqueado → WebRTC P2P"
nunca foi exercitado. Nem na cabeça de ninguém, nem em um harness.

A diferença entre §15 *asserted* e §15 *verified* é a diferença entre
"deve funcionar" e "demonstrado funcionando". Hoje §15 está em
*asserted* (com sub-clause de Tor isolado *verified*). Promessa de
manifesto sem garantia empírica vira credibility risk se um user real
tentar usar Drift em país censurado e o fallback não acontecer como
prometido.

---

## §2 — Componentes shipped vs. gap E2E

### Tabela de status

| Componente | Status | Fase | Validação atual | Validado em país censurado? |
|---|---|---|---|---|
| Tor transport (arti) | 🟡 shipped pra source-builders | 6.4 etapas 1–4 | smoke 2026-05-01 (Wireshark, Windows local) | ❌ não — testado em rede livre simulando "vai por Tor" |
| WebRTC P2P + signaling Nostr | ✅ shipped | 6.1a/6.1b/6.2/6.3 | unit + threat tests T1–T4; smoke mobile 6.3 | ❌ não |
| transport/policy/ shared | ✅ shipped | 7.1b (commit 975468d) | 27 unit tests (`policy-pingPongTracker`, `policy-violationWindow`, `subValidator`) | n/a (lógica pura) |
| transport/orchestrator.ts (multiplexer) | ✅ shipped | 6.2-D | 1 spec (`tests/orchestrator.test.ts`) — fan-out + dedup + race-to-first-OK | ❌ não testado com transport caindo |
| Multi-transport orchestration | 🟡 *parcialmente* shipped | 6.6 (declarado ✅ em 6.2) | orchestrator existe; **fan-out paralelo, não fallback** | ❌ não |
| **`network_mode: 'auto'` (clearnet→Tor fallback)** | ⛔ **não existe no código** | — | — | n/a — feature não implementada |
| **Health-driven transport disable** ("WSS dead → desativa, fica só Tor") | ⛔ **não existe** | — | — | n/a |
| **Telemetria de transport switching** | ⛔ **não existe** | — | console.warn esparso | n/a |
| **Fallback orchestration completo** (Tor falha → WebRTC tenta) | ⛔ **GAP** | — | **nunca testado E2E** | **❌ — esse é o ponto cego** |

### Correções de classificação (vs. percepção pré-research)

A descrição do task assumia que componentes individuais estavam todos
"shipped" e o gap era apenas o fallback orchestration E2E. Research
revelou três coisas mais sérias:

**Surpresa 1 — `network_mode: 'auto'` não existe.**
`Docs/drift-arquitetura-v4.md` §23.7 (linhas 1024–1033) e §29.1 (linha
1547) descrevem 3 modos: `Off` (clearnet), `Auto` (clearnet primeiro,
fallback Tor se bloqueado), `Always` (só Tor). Mas
`src/types/drift.ts:346` define `NetworkMode = 'clearnet' | 'tor' |
'onion-only'` — **sem `auto`**. Não há fallback automático
clearnet→Tor implementado. Toggle é decisão manual do user.

Implicação: a *primeira* afirmação de §15 ("bloqueio DNS é contornável
via Tor") só funciona se o user já tinha ligado Tor manualmente
*antes* de chegar no país censurado. Se ele chega e descobre que
clearnet não funciona, ele tem que abrir Settings, clicar em "modo de
rede", trocar pra `tor`, recarregar. Só funciona se ele consegue
chegar até a UI — o que não é trivial se DNS está bloqueado e o app
não bootou. Ver §3 cenário (a).

**Surpresa 2 — Tor não é um Transport separado no orchestrator.**
A arquitetura final escolheu *não* registrar `torTransport` como
implementação de `Transport`. Em vez disso, quando `network_mode ∈
{'tor', 'onion-only'}`, `bootstrap.ts:241–265` chama `torConnect()` +
`installTorWebSocketImpl()` — isso substitui a classe `WebSocket`
global usada pelo `nostr-tools/pool`, e o `wssTransport` passa a
rotear via Tor sem mudar de identidade.

Decisão é coerente (evita duplicação ruidosa, ver `transport/tor.ts:7–18`
e `transport-paths.md`), mas tem **consequência arquitetural**: do
ponto de vista do `orchestrator`, há *dois* transports registrados
(`wssTransport`, `webrtcTransport`), não três. Não há "Tor failed,
desligar transport Tor, manter WebRTC" — Tor failure é WSS failure (se
TorWebSocket não consegue subir o circuit, o `WebSocket` injetado
fecha com code 1006 e o `pool` reconnect falha em loop). O fallback
"tor falhou → webrtc assume" precisa observar **o estado interno do
TorWebSocket / arti**, não o status do `wssTransport`. Hoje não há
hook para isso.

**Surpresa 3 — IP leak via WebRTC em modo Tor: doc afirma feature que
código não tem.**
`Docs/webrtc-6.4-plan.md:106` afirma:

> Mesmo em modo `tor`, WebRTC P2P pode vazar IP via STUN/TURN
> candidates locais. Mitigação: em modo `tor` ou `onion-only`,
> **WebRTC desabilitado** (orchestrator não registra
> `webrtcTransport`). Documentar pra usuário.

Mas `bootstrap.ts:277–278` registra **incondicionalmente** ambos
transports:

```ts
registerTransport(wssTransport, { weight: 10 })
registerTransport(webrtcTransport, { weight: 5 })
```

Não há check de `networkMode` em volta da segunda linha. Implicação:
em modo `tor`/`onion-only`, WebRTC P2P está ativo e pode vazar IP via
STUN/ICE candidates locais — exatamente o que o plan se compromete a
prevenir. Threat T1 do audit Barney 2026-05-08 cobre rate limit, não
cobre esse leak.

**Esse é um achado de spec-vs-code drift que precisa virar issue
imediata** — ver §7 pré-trabalho.

### Síntese do gap

O gap E2E não é só "ninguém testou Tor + WebRTC juntos". É composto:

1. **Feature gap** — modo `auto` não existe; sem ele, o "bloqueio DNS
   contornável via Tor" requer ação manual prévia do user, o que
   reduz a garantia §15 a "anti-censura disponível, mas não automática
   pra novos usuários em país censurado".

2. **Observability gap** — sem health-driven disable e sem telemetria
   de switching, o cliente não tem como *saber* qual transport
   entregou cada mensagem nem em que momento decidiu trocar.

3. **Integração gap** — fallback Tor→WebRTC nunca rodou. Mesmo que
   modos manual + observability estivessem prontos, ninguém demonstrou
   que o cliente "sente" Tor parar de funcionar e WebRTC tomar over em
   tempo razoável.

4. **Spec-vs-code drift** — webrtc-6.4-plan.md afirma feature que
   bootstrap.ts não implementa; testbed expõe isso (§7 pré-trabalho).

---

## §3 — Cenários de ataque a cobrir

Lista priorizada por (a) severidade pro manifesto + (b) viabilidade de
simulação synthetic. Status reflete cenário **dentro do escopo do
testbed proposto** vs out-of-scope dessa fase.

### (a) ISP bloqueia relays Nostr clearnet · in-scope ✅

**Setup:** user chega em país censurado com cliente Tauri instalado e
configurado em `clearnet`. ISP DNS-bloqueia ou IP-bloqueia os 4 relays
seed (`relay.damus.io`, `nos.lol`, `relay.snort.social`,
`relay.nostr.band`). User abre o app.

**Comportamento esperado pelo manifesto:** "bloqueio por DNS é
contornável (PWA + IP direto + Tor)". User deve conseguir ler/postar
sem mudar de cliente.

**Comportamento atual provável (predição, **não testado**):**
- App boota, vai pra `step: 'sync'`.
- `wssTransport.subscribe(...)` abre 4 WebSockets via SimplePool.
- Todos retornam erro DNS. Não há sinal pra user — só `console.warn`.
- WebRTC sub registra, mas `connectTo()` precisa signaling Nostr
  (modo Nostr) que também depende dos relays bloqueados → não
  conecta peer. Ou modo mock (BroadcastChannel same-origin) só vê a
  própria aba.
- Feed fica vazio. User não sabe se é "primeiro boot demorado" ou
  censura.

**Métrica de pass:** time-to-action ≤30s (banner UI explícito "rede
bloqueada, ative modo Tor em Settings"). Bonus: detecção automática
e prompt opt-in pra modo `tor`. Stretch: modo `auto` que tenta
clearnet 10s, se nada chega, tenta Tor automaticamente (precisa do
Surprise 1 fechado).

**Por que cobrir nessa fase:** é o cenário mínimo de §15. Sem isso,
manifesto não está sendo entregue.

### (b) ISP bloqueia Tor (DPI/SNI/connection-fingerprint) · in-scope ✅

**Setup:** user já tem `network_mode: 'tor'` ativo. ISP usa DPI pra
identificar handshakes Tor (TLS pattern, port 9001 known-Tor) e dropa
conexões.

**Comportamento esperado pelo manifesto:** "bloqueio por SNI/DPI dos
relays clearnet é contornável (Tor + WebRTC)". WebRTC P2P deveria tomar
over.

**Comportamento atual provável (predição):**
- arti tenta bootstrap, falha em chegar nos directory authorities.
- `torConnect()` retorna `state: 'error'`. Bootstrap.ts adiciona
  `TOR_BOOTSTRAP_FAILED` em `degradedReasons`, segue em clearnet
  degradado.
- Mas clearnet também está bloqueado (cenário a). Logo:
  `wssTransport` falha igual ao cenário (a).
- WebRTC P2P: signaling via NIP-44 kind 1059 vai pelos mesmos relays
  Nostr clearnet. Bloqueado também.
- App fica preso. Não há fallback pra mock signaling, não há
  bootstrap WebRTC out-of-band, não há sneakernet ainda.

**Métrica de pass:** depois de N minutos detectando ambos transports
mortos, banner explícito + opção "tentar peer-to-peer offline" (precisa
de feature inexistente: bootstrap WebRTC sem signaling clearnet — TODO
de Fase 7+).

**Por que cobrir nessa fase:** demonstrar empiricamente que o cenário
(b) **falha** com código atual é insight valioso — calibra
expectativa do manifesto. "§15 é cumprido em (a) com modo manual; em
(b) requer Fase 7 sneakernet."

### (c) ISP bloqueia tudo (full GFW) · out-of-scope dessa fase

**Setup:** ISP bloqueia clearnet, Tor, e até DNS/IP de servidores de
WebRTC signaling. Bloqueio total.

**Comportamento esperado:** sneakernet bundle (manifesto §13). Cliente
gera bundle de eventos pra tocar via QR ou cabo USB. Roadmap Fase 7.

**Por que out-of-scope:** sneakernet ainda não existe (`bundle.ts`
mencionado em `transport/index.ts:11` é placeholder pra Fase 7). Sem
componente shipped, não tem o que testar.

### (d) Adversário ativo: relay "amigável" censura kinds Drift seletivamente · in-scope ✅

**Setup:** ISP não bloqueia clearnet. Mas opera um relay "patriótico"
e injeta no DNS resolver pra que `relay.damus.io` resolva pra IP do
relay patriot. Esse relay aceita kinds 0/1/3/etc., mas filtra
9078–9081 (kinds Drift) ou retorna versões editadas.

**Comportamento esperado pelo manifesto:** assinatura criptográfica
detecta tampering (§5 autenticidade). Probe periódico (§20 resistência
a isolamento, `lib/probe.ts`) detecta ausência de eventos conhecidos
e flagga relay como malicioso.

**Comportamento atual:**
- `verifyDriftEvent` em `nostr.ts` valida Schnorr — eventos editados
  são descartados como ruído.
- `probe.ts:startProbe()` roda a cada 30min com sample de eventos
  conhecidos. Se relay esconde, marca como flagged (manifesto §20).
- Mas: probe só detecta após 30min. E não há cluster detection
  ativo no código atual (Fase 5 menciona "probe + relay aleatório
  externo", mas detecção de >70% peers de mesma origem é §20 da
  Fase 6 WebRTC, não dos relays WSS).

**Métrica de pass:** dentro de 30min, relay malicioso flagged + UI
mostra warning. Time-to-detection medido.

**Por que cobrir:** §20 (resistência a isolamento) é outro
compromisso de manifesto que se entrelaça com §15. Adversário
sofisticado prefere vetor (d) sobre (a) porque é mais difícil de
detectar pelo user.

### (e) Adversário Sybil em PoI WebRTC seed · in-scope com hedge

**Setup:** atacante opera 100 peers WebRTC respondendo ao signaling
Nostr. Apresentam-se como peers válidos pro auto-discovery via
`seedFromSpreaders` (Fase 7.1a, `lib/seeder.ts`). Quando user abre
mapa, conecta nesses peers em vez de peers reais.

**Comportamento esperado pelo manifesto:** §20 random walk + path
diversity scoring detectam que >70% dos peers vêm de cluster (mesmo
AS, mesmo timing, mesmas características). Cliente entra em
`ISOLATED` e força expansão.

**Comportamento atual:**
- `webrtc/discovery.ts:performRandomWalk` existe. Path diversity
  scoring foi shipped em 6.2.
- Cluster detection: depende de quantos peers reais o cliente já
  tinha pré-Sybil. Se primeiro boot, cluster = 100% Sybil = nada pra
  comparar.
- Audit Barney 2026-05-08 §T1 (cross-proto counter monotônico) é
  defesa per-peer; não cobre dominância de cluster.

**Métrica de pass:** cliente recém-bootado em meio a 100 Sybil + 5
honest se conecta a >0 honest dentro de 5min. Stretch: ratio honest/sybil
no peer pool > random expectation.

**Hedge:** simular 100 peers Sybil é caro (precisa setup substancial
de signaling fake + WebRTC mock fleet). Pode ser Fase B do testbed
(ver §9), não Fase A.

### (f) Sub maliciosa via plugin (Fase 7+) · out-of-scope dessa fase

**Setup:** plugin opt-in passa filter `{ kinds: [9078..9081] }` pra
`webrtcTransport.subscribe()` querendo log de tudo. Drena banda.

**Defesa atual:** `subValidator` (transport/policy/) valida shape +
cap. T4 do audit Barney cobre.

**Por que out-of-scope:** plugins não existem ainda; T4 é defesa
unitestada, não E2E.

---

## §4 — Testbed setup

### Filosofia do setup

Drift compete com BBS de 1985 quando rede caiu, não com Twitter. O
testbed segue o mesmo princípio: **simulação synthetic em laptop +
network namespace é suficiente pra bater 80% dos cenários**. Não vamos
montar VPS em país censurado real (custo + risco político + sem
controle reproduzível) — vamos simular o adversário com tc/netem +
iptables + DNS spoofing local.

### Hardware mínimo

- **1 laptop Linux** (Ubuntu/Debian, kernel ≥5.10 com `netem`) ou
  WSL2 com root + iptables. Native Linux preferido — netns/iptables
  não funcionam idêntico em WSL2.
- **OU** 2 containers Docker em host Linux: `client-container` +
  `censor-container` simulando ISP. Compose file declara
  rede `censored-net` com tc rules.
- **OU** Raspberry Pi 4 + segundo PC formando mini-LAN com Pi como
  router executando iptables (mais físico, mais lento).

Nenhuma opção exige cloud/VPS. Pra testbed Fase A, recomendado:
**Docker compose em laptop linux**. Reproduzível, declarativo,
descarta-fácil.

### Tooling do "censor"

Pra cada cenário do §3, o `censor-container` ou ruleset iptables
implementa:

| Vetor | Tool | Comando exemplo |
|---|---|---|
| DNS block (cenário a) | `dnsmasq` resolvendo SERVFAIL pra hostnames-alvo | `address=/relay.damus.io/0.0.0.0` |
| IP block (cenário a) | `iptables -A FORWARD -d <ip> -j DROP` | bloqueia IPs hardcoded de relays seed |
| SNI/DPI block (cenário b) | `iptables-extensions` com `string match` em ClientHello | `--algo bm --string "tor.bypass.org"`; difícil cobrir DPI real, simula heurística |
| Bandwidth/latency simulation | `tc qdisc add dev eth0 netem delay 200ms loss 5%` | mimics ISP shapeado |
| Malicious relay (cenário d) | `nostr-rs-relay` rodando em IP que substitui via DNS spoof | aceita kinds 0/1, bloqueia 9078–9081 |
| Sybil WebRTC (cenário e) | mock signaling com 100 fake peers | parcialmente disponível em `webrtc-signaling-mock.ts`; precisa estender pra signaling Nostr fake |

### Harness de observação

Drift hoje **não tem** logging estruturado de transport switching.
Pra observar comportamento, testbed precisa de um harness que:

1. **Wireshark/tcpdump no `eth0` do client-container** — captura
   tráfego saindo. Confirma "saiu por Tor" (porta 9001) vs clearnet
   (443 direto). Modelo do smoke test 2026-05-01.

2. **Hook em `console.warn`** — dev-only, intercepta mensagens tipo
   "tor_connect lançou", "WebSocket failed". Drift logga muito por
   `console.warn` (`bootstrap.ts:255–263`, `wss.ts:113`). Em test
   harness, redirecionar pra log file estruturado.

3. **Telemetria injectada em pontos canônicos** — pré-trabalho (§7
   item 2): adicionar `transport.recordEvent(transport, action)` em
   `wssTransport.publish/subscribe` e `webrtcTransport.publish/subscribe`
   chamando um callback test-only. Em produção, no-op (ou comportamento
   manifesto-safe — sem analytics §28). Em testbed, escreve em log
   estruturado.

4. **Assertions sobre log** — script Python lê log estruturado +
   tcpdump trace e valida critérios de §5.

### Métricas

Pra cada cenário do §3 que entra na fase A:

| Métrica | Como medir | Critério §15 |
|---|---|---|
| Time-to-fallback | timestamp de "transport X falhou" → timestamp de "transport Y entregou primeira mensagem" | <30s pro user honesto, ideal <10s |
| % de mensagens entregues | total publicado / total que chegou em algum transport | ≥90% em (a) com modo `tor` ativo manual |
| False-positive rate | "transport saudável marcado dead" / "transport marcado dead" | ≤5% (não temos isso ainda — feature gap) |
| Time-to-detection (cenário d) | timestamp de "relay malicioso conectado" → "probe flagga" | ≤30min (intervalo do `probe.ts`) |
| Bandwidth overhead Tor vs clearnet | bytes wireshark Tor / bytes wireshark clearnet pra mesma sessão de N minutos | <3× é aceitável (Tor sempre tem overhead) |

---

## §5 — Critérios de sucesso

"§15 E2E testado" significa, **mínimo viável (Fase A)**:

1. Cenário (a) e (b) rodam green com fallback automático **OU**
   documentação explícita de que fallback automático é Fase B/C
   (modo `auto` não shipped) e que hoje user precisa toggle manual.

2. Time-to-fallback medido em condições normais. Bound concreto pra
   cada cenário (não promessa vaga "rápido").

3. Sem false-positive em testbed: transport saudável (latência alta
   mas funcional) **não** é marcado dead. Implica health check
   pretender threshold conservador.

4. Doc reproduzível: `Docs/sessions/15-e2e-testbed-setup-YYYY-MM-DD.md`
   com docker-compose + scripts + comando único `./run-testbed.sh`.
   Qualquer dev roda em <1h após `git pull`.

5. Cenário (d) demonstrado com time-to-detection ≤30min. Validação
   de §20 (probe + cluster detection) por extensão.

**Não-mínimos (Fase B/C — ver §9):**
- Cenário (e) Sybil WebRTC.
- Cenário (c) full GFW (depende de sneakernet Fase 7).
- Validação em país real (Fase C, com user voluntário em jurisdição
  censurada de fato).
- Métrica "custo do adversário" — manifesto §15 promete "censurar 100
  relays é mais caro que censurar 4", mas medir custo do atacante
  exige threat model formal que está fora do escopo de testbed.

---

## §6 — Owner sugerido + escopo de tempo

### Recomendação

**Marshall (orchestration + observability/tests) + Robin (research
de testbed/cenários) — colaboração, não delegação.**

**Justificativa:**

- Testbed é parcial-código (telemetria injectada, possíveis fixes pro
  spec-vs-code drift de §7), parcial-research (cenários, setup
  reproduzível, critérios). Combina forças. Marshall sozinho cai em
  "fazer o test rodar"; Robin sozinho cai em "doc espesso sem
  validação". Par mantém balanço.

- Marshall já é par natural pro Lily WebRTC P0 trabalho (audit Barney).
  Reaproveita context.

- Não é Lily porque Lily já está com 4-6 dias bloqueados (Track C
  debt + WebRTC P0+P1 da audit Barney + possível RFC migration). Ted
  §6 R1 alertou que Lily aparece como owner em 3 de 4 trabalhos.

- Não é Barney sozinho porque Barney é threat-model-first; testbed
  Fase A é majoritariamente "como simular bloqueio + harness de
  observação", trabalho operacional. Barney entra forte em Fase B
  (cenário e Sybil).

- Não é Ted porque Ted é arquitetura/CI; testbed é runtime + tooling.

### Tempo bruto estimado

- **3–5 dias úteis** pra primeiro testbed funcional cobrindo (a)+(b).
  Breakdown:
  - Dia 1: docker-compose + censor-container scaffolding +
    iptables/dnsmasq rules pra cenário (a). Smoke "DNS block detectado
    pelo harness" sem Drift envolvido.
  - Dia 2: integrar Drift Tauri build (`--features arti`) +
    rodar cenário (a) com network_mode=clearnet → observar comportamento
    atual. Documentar resposta real do app (banner aparece? quando?).
  - Dia 3: rodar cenário (a) com network_mode=tor pré-configurado.
    Validar smoke 2026-05-01 reproduzido. Medir time-to-first-event.
  - Dia 4: cenário (b) — DPI/SNI bloqueando Tor. Documentar falha
    esperada (fallback WebRTC não funciona — depende de signaling
    bloqueado). Resposta a esse achado é input pra Fase B.
  - Dia 5: doc final + script `run-testbed.sh` + smoke run-from-zero
    em laptop limpo.

- **Pré-requisito:** NÃO bloqueia Fase 6.4 follow-ups (5 itens em
  webrtc-6.4-plan.md §6). Pode rodar em paralelo com Lily WebRTC P0
  audit fixes. Coordenar pra não conflitar com mudanças em
  `wssTransport`/`webrtcTransport`.

- **Output:** doc em `Docs/sessions/15-e2e-testbed-setup-YYYY-MM-DD.md`
  + diretório `tests/e2e-testbed/` com docker-compose +
  scripts. Decisão: **não** commit pcap files (artefatos pessoais com
  metadata de host) — só dump filtrado + assertion log.

### Reavaliação pós-Fase-A

Após Fase A fechar, reavaliar:
- Se cenário (a) revelar gap UX grave (user fica preso porque banner
  não aparece): item vira P0 imediato pra Lily (não esperar Fase B).
- Se cenário (b) confirma "fallback Tor→WebRTC não funciona porque
  signaling depende de relays bloqueados": isso é input pra arquitetura
  decidir Fase 7 (sneakernet, bootstrap WebRTC out-of-band). Não é bug;
  é spec-vs-implementação gap honesto.

---

## §7 — Pré-trabalho identificado

Ordenado por urgência (1 → mais imediato).

### 1. Spec-vs-code drift: WebRTC ativo em modo Tor (PRÉ-FASE A — fix imediato recomendado)

`webrtc-6.4-plan.md:106` afirma WebRTC desabilitado em modo
`tor`/`onion-only`. `bootstrap.ts:277–278` registra incondicionalmente.

**Decisão necessária do Arquiteto:**
- (i) Doc estava correto, código tem bug → fix em bootstrap.ts:
  envolver `registerTransport(webrtcTransport, ...)` com
  `if (networkMode === 'clearnet')`. ~3 linhas.
- (ii) Doc estava errado, código intencional (WebRTC vale pena
  mesmo com risco IP leak) → atualizar webrtc-6.4-plan.md +
  documentar em `manifesto.md` ou `transport-paths.md` que modo Tor
  não impede WebRTC e user assume risco.

**Recomendação Robin:** opção (i) é mais conservadora; modo
`onion-only` literalmente promete "isolamento iminente" (banner R6),
permitir WebRTC contradiz a promessa. Mas é decisão de Barney/Ted —
threat surface judgment.

**Custo:** opção (i) ~30min com test (ajusta `tests/network-mode.test.ts`
ou similar). Opção (ii) ~15min só doc.

**Bloqueia testbed?** Não. Mas testbed vai expor a inconsistência
e gerar confusão sobre "qual é o comportamento esperado". Resolver
*antes* economiza retrabalho.

**Recomendação imediata:** virar **issue/task agora** (não deferred
pra Fase A). Marshall ou Lily pode fazer em sessão curta. Ted §6
R5 já mencionou §15 multi-owner; isso é o tipo de drift que
acumula.

### 2. Telemetria de transport switching — feature gap (PARTE DA FASE A)

Hoje, observability de transport é console.warn + nada estruturado.
Pra testbed, precisa de:

- Hook injectável em `Transport.publish/subscribe` que reporte (em
  modo testbed) quem entregou cada evento.
- Possivelmente um `Transport.onStatusChange((status) => ...)`
  callback para cliente saber "WSS está saudável agora?" — útil
  também em produção pra UI mostrar banner sutil.

**Cuidado manifesto §28 (privacidade pelo mínimo):** telemetria pode
NÃO sair do device (sem analytics). Em produção, callback é local +
roda só em UI banner. Em testbed, callback escreve em log file local
do test runner.

**Custo:** ~3-4h de Marshall, +10 LOC no `Transport` interface, +20
LOC no orchestrator/wssTransport/webrtcTransport, + 1 spec.

**Recomendação:** parte de Fase A do testbed, não pré-requisito.
Pode fazer em paralelo com setup do docker-compose.

### 3. Mock/fixture pra simular Tor failure mode (PARTE DA FASE A)

Hoje, Tauri/arti em test é caro — não há mock testável de "arti
bootstrap falhou após 30s". Smoke test depende de `cargo tauri build`
+ rodar binário.

**Pra testbed Fase A,** uma das opções:
- (a) Usar build Tauri real, deixar arti tentar bootstrap, simular
  bloqueio com iptables (drop 9001/443 outbound). arti realmente
  falha. Mais real, mais lento (build Tauri é 5min em cache, 30min
  cold).
- (b) Patchar `tor.rs` em modo testbed pra retornar erro forçado +
  rodar PWA build mais rápido. Menos fiel à integração, mais rápido
  iterar.

**Recomendação Robin:** (a) pra Fase A — fidelidade de integração é
o ponto. Cache de cargo deixa rebuild manageable.

**Custo:** zero pré-trabalho — é parte do setup do testbed.

### 4. Modo `network_mode: 'auto'` (DEFERRED — Fase B ou separada)

Falta no código (ver §2 surpresa 1). Sem ele, cenário (a) só passa
se user já configurou Tor manualmente. É **feature gap pro
manifesto**, não falta do testbed.

**Quem decide:** Arquiteto — feature roadmap. Pode entrar como Fase
6.4 follow-up (sexto item da lista, depois dos 5 atuais) ou como
sub-fase 6.4.2.

**Custo estimado:** ~6-8h. Lógica:
- Boot tenta clearnet primeiro com timeout 10s.
- Se falha total (todos os relays unreachable), tenta `torConnect()`.
- Se sucesso, troca `prefs.network_mode = 'tor'` + `installTorWebSocketImpl`
  + reload OU re-init pool (sem reload exige refactor mais sério).
- UI: banner "rede inacessível, tentando Tor…" durante a transição.

**Bloqueia testbed Fase A?** Não — testbed Fase A documenta que modo
auto não existe; valida cenário (a) com modo manual.

**Bloqueia testbed Fase B?** Possivelmente — cenário (a) sem modo
auto é um teste de "user opera Settings em país censurado". Modo
auto eleva pro nível "Drift se vira sozinho". Diferença política.

### 5. orchestrator com health-driven disable (DEFERRED — Fase B)

Hoje, `orchestrator.publish` chama `Promise.all` pra todos os
transports e agrega o resultado. Não há "transport X tá morto, só
chamar Y". Implementar:
- `Transport.health()` já retorna `TransportHealth[]`. Periodicamente
  (a cada 60s) chamar e marcar transports `unhealthy`.
- Em publish, pular transports unhealthy. Recheckar a cada N
  segundos.

**Custo:** ~4-6h. Marshall.

**Bloqueia testbed Fase A?** Não — Fase A documenta comportamento
atual (publish em todos sempre). Fase B exige feature pra cenário (b)
"Tor falhou → WebRTC tenta sozinho".

---

## §8 — Riscos

### Síntese: limites do que é demonstrável

Riscos ordenados por severidade pra credibility do compromisso §15.

### R1 — Falta de país censurado real pra validar

Toda simulação synthetic é aproximação. GFW real (China),
Roskomnadzor (Rússia), e DPI iraniano usam técnicas que evoluem mais
rápido que rule sets reproducíveis em laptop:
- Active probing de bridges Tor (ataque não-passivo)
- Statistical traffic analysis (timing correlation)
- Dynamic blocklist updates baseados em behavioral fingerprint

**Mitigação:** documentar limitação no critério §5. Testbed Fase A é
"defesa contra adversário definido por iptables/netem". Cenário (e)
com adversário ativo dentro de simulação é melhor que nada, mas
ainda não cobre adversário-Estado-com-engenharia-dedicada.

**Implicação:** §15 *verified em testbed synthetic* é ganho real
(hoje §15 é só *asserted*), mas não é §15 *verified em produção
adversária real*. O segundo só vem da Fase C com user voluntário.

### R2 — WebRTC fallback depende de PoI peers acessíveis em região censurada

Manifesto §15 promete "Tor + WebRTC" como combinação que cumpre.
Mas WebRTC depende de signaling (kind 1059 cifrado por NIP-44) que
hoje vai pelos *mesmos relays Nostr* que Tor + clearnet. Se relays
estão bloqueados, signaling também está.

E mesmo se signaling fosse out-of-band: pra um peer recém-bootado em
país censurado encontrar peer real, precisa de **lista inicial de
peers acessíveis**. PoI auto-discovery via SpreadMap (`lib/seeder.ts`,
Fase 7.1a) lê `spreader_pub` do SQLite local — só funciona se já
tem dados locais.

**Mitigação atual:** documentar limitação em cenário (b) explícito.
Sem componente shipped pra resolver, testbed Fase A demonstra falha
honestamente.

**Roadmap pra resolver:** Fase 7.x — sneakernet bundle + bootstrap
WebRTC via QR code com peer list inicial (manifesto §13 + §16).

**Implicação:** "Tor + WebRTC" como promessa de §15 é mais frágil
que parece. Em Fase 6 atual, é "Tor SE Tor funcionar" + "WebRTC SE
peers já conhecidos". Sneakernet é o último recurso real.

### R3 — Tor Tauri+arti pode ter latência alta no primeiro hop

Smoke test 2026-05-01 mostrou bootstrap de 5-30s primeira vez. Em
condições normais (rede livre, simulando "tô em país censurado mas
testando local"), aceitável. Em condições reais (perda de pacote,
DPI parcial não-bloqueante), latência pode escalar.

**Risco específico:** "fallback ativado" pode ser sintoma de UX
ruim, não censura real. Threshold conservador pra dead-detection
(R3 critério §5 #3) é mitigação parcial.

**Mitigação:** medir percentile distribution de latência em
testbed, não só média. Se p95 >5s mas p50 1s, é "Tor está lento",
não "Tor morreu".

### R4 — Spec-vs-code drift pode esconder bugs sob "feature gap"

O achado §2 surpresa 3 (WebRTC ativo em modo Tor) é o tipo de coisa
que escapa code review e testbed unitários. Testbed E2E pode revelar
mais drifts similares — em ambos os sentidos:
- Doc afirma X, código faz Y → fix doc ou fix código.
- Código faz X razoável, doc não cobre → adicionar doc.

**Mitigação:** testbed scope inclui "checagem de cada afirmação de
manifesto §15 contra comportamento observado". Output da Fase A é
matriz `[afirmação manifesto] → [comportamento testbed] → [match
sim/não/parcial]`. Drifts viram issues separadas.

### R5 — Risco de "doc no diretório"

Scoping doc sem owner virando código vivo é o anti-padrão histórico
do projeto (Ted review §4 sobre Robin RFC). Mitigações:
- Owner explícito sugerido (§6).
- Pré-trabalho item 1 é fix imediato, executável fora do testbed —
  vira "valor entregue mesmo se Fase A demorar".
- Fase A tem deliverable concreto (docker-compose runnable + smoke
  passa) — não pode ser "doc terminado, vou pra próxima".

**Risco residual:** se Marshall + Robin estiverem ocupados em
outras frentes (Marshall: CI Tauri matrix do review Ted §1; Robin:
research backlog), Fase A pode escorregar 2-3 semanas. Mitigar
declarando "owner real" em sequenciamento Ted §5 (entre item 4 e
item 7).

---

## §9 — Roadmap em fases

### Fase A — Scoping atual + testbed básico (esta proposta, 3-5 dias)

**Owner:** Marshall + Robin.
**Escopo:**
- Pré-trabalho 1 (spec-vs-code drift WebRTC em modo Tor) — fix
  imediato, fora do testbed mas antes da Fase A.
- docker-compose + censor-container + scripts iptables/dnsmasq.
- Telemetria estruturada injectada nos transports (pré-trabalho 2).
- Cenários (a) clearnet bloqueado e (b) Tor bloqueado documentados
  com observação real do comportamento atual.
- Doc final reproduzível em `Docs/sessions/15-e2e-testbed-setup-*`.

**Output esperado:**
- Cenário (a) **passa** com modo `tor` ativo manual; **falha graciosa
  com banner explícito** quando user em modo `clearnet` (gap UX
  documentado).
- Cenário (b) **falha** documentadamente — vira input pra Fase 7
  sneakernet roadmap. Não é bug; é spec confirmando manifesto §15
  precisa de Fase 7 pra cobrir cenário (b).
- Critério §5 itens 1-4 cumpridos.

### Fase B — Cenários adversariais + features faltando (futuro, ~2 semanas)

**Owner:** Barney (threat) + Marshall (features) — ainda não atribuir.
**Escopo:**
- Cenário (d) — relay malicioso seletivo. Validação §20.
- Cenário (e) — Sybil WebRTC. Validação §20 path diversity em
  cenário hostile. Setup: 100 mock peers via signaling Nostr fake.
- Feature gap fix: modo `network_mode: 'auto'` (pré-trabalho 4).
- Feature gap fix: orchestrator health-driven disable (pré-trabalho
  5).
- Critério §5 item 5 cumprido (cenário d ≤30min detection).

**Pré-requisito:** Fase A fechada. Decisão Arquiteto sobre modo
`auto` shipping.

### Fase C — Validação em produção real (longo prazo, requer cliente nativo distribuído + user voluntário)

**Owner:** Não atribuído — Fase 7+ feature.
**Escopo:**
- User voluntário em jurisdição censurada (China, Rússia, Irã)
  testa cliente Tauri `--features arti` real.
- Coleta logs estruturados (com consent + anonimização §28).
- Compara comportamento real vs predição testbed Fase A/B.
- Output: §15 *verified em produção real* (não só testbed).

**Pré-requisito:** Fase 7 distribuição (TWA, F-Droid, sneakernet),
build reproduzível Linux/macOS/Windows shipped, cliente Tauri
estável > 6 meses, user volunteer + ethical considerations
(political risk pro user é não-trivial).

**Risco político:** pedir user em país censurado pra testar cliente
anti-censura é eticamente delicado. Decisão pode ser: nunca pedir;
aceitar relatos voluntários quando vierem; documentar protocolo de
"se você está em país censurado e quer reportar comportamento, aqui
está como anonimizar logs".

---

## §10 — Cross-references

### Docs do Drift

- [`Docs/manifesto.md`](../manifesto.md) §15 (anti-censura por país),
  §12 (múltiplos transportes), §14 (bootstrap distribuído), §20
  (resistência a isolamento), §28 (privacidade pelo mínimo)
- [`Docs/drift-arquitetura-v4.md`](../drift-arquitetura-v4.md)
  §23.7 modo Tor toggle, §32 camada de transporte (linha 248), §32.3
  defesas anti-isolamento
- [`Docs/fase-6-roadmap.md`](../fase-6-roadmap.md) §6.4 Tor (status
  atual), §6.6 Multi-transport orchestration
- [`Docs/webrtc-6.4-plan.md`](../webrtc-6.4-plan.md) §3 IP leak
  via WebRTC ICE (linha 104–106), §6 Próximos passos (linha 217+),
  follow-ups CI/Capacitor/circuit-count/shutdown/cache
- [`Docs/transport-paths.md`](../transport-paths.md) — matriz de
  decisão dos 3 caminhos subscribe + 2 publish
- [`Docs/runtime-pwa-vs-tauri.md`](../runtime-pwa-vs-tauri.md) —
  capability matrix (linha 33–36 Tor)
- [`Docs/sessions/sprint7-smoke-2026-05-01.md`](sprint7-smoke-2026-05-01.md)
  — modelo de testbed doc (single-cenário Tor isolado, Wireshark)
- [`Docs/sessions/ted-review-2026-05-08.md`](ted-review-2026-05-08.md)
  §6 R5 — disparo deste doc
- [`Docs/sessions/webrtc-architecture-audit-2026-05-08.md`](webrtc-architecture-audit-2026-05-08.md)
  §2.3 threat surface T1-T4

### Código do Drift

- `src/lib/transport/index.ts` — `Transport` interface
- `src/lib/transport/orchestrator.ts` — multiplexer (fan-out + dedup
  + race-to-first-OK)
- `src/lib/transport/wss.ts` — primário; comentário "magic-at-distance"
  linhas 14–32 explica injeção do TorWebSocket
- `src/lib/transport/tor.ts` — IPC bridge (não é Transport — ver
  comentário linhas 7–18)
- `src/lib/transport/torWebSocket.ts` — WebSocket-like que tunela
  via Tauri IPC + arti
- `src/lib/transport/webrtc/` — 12 arquivos peer-to-peer
- `src/lib/transport/policy/` — shared layer (clockClamp,
  pingPongTracker, subValidator, violationWindow)
- `src/lib/bootstrap.ts:225–278` — wire-up Tor + registerTransport
  + spec-vs-code drift WebRTC
- `src/types/drift.ts:346` — `NetworkMode = 'clearnet' | 'tor' |
  'onion-only'` (sem `auto`)
- `src/lib/probe.ts` — probe anti-eclipse (cenário d setup)
- `src/lib/seeder.ts:seedFromSpreaders` — PoI auto-discovery
  (Fase 7.1a, cenário e setup)
- `tests/orchestrator.test.ts` — único spec de orchestrator hoje;
  não cobre fallback nem dead-transport
- `tests/policy-*.test.ts` — 27 unit tests, 100% pure logic, não
  cobrem integração

### Externos

- Tor Project — [Onionoo Bandwidth](https://metrics.torproject.org/)
  pra cross-reference IPs guards (modelo do smoke test)
- iptables `string` match docs — DPI simulation crude mas suficiente
  pra cenário (b) Fase A
- `tc-netem(8)` — latency/loss simulation
- `dnsmasq` `address=/host/ip` directive — DNS spoof do cenário (d)

---

*Robin · 2026-05-08 · Fase A: 3-5 dias · pré-trabalho 1 imediato ·
spec-vs-code drift WebRTC-em-Tor é achado paralelo · Fase B/C
deferred com critérios explícitos*
