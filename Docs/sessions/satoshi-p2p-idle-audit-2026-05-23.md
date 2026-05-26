# Satoshi audit — P2P/WebRTC idle cost (privacy + game theory + adversarial)

**Data:** 2026-05-23
**Persona:** Satoshi Nakamoto (adversarial deep, game theory, invariantes
descentralização)
**Tipo:** Doc-only audit, paralelo com Lily (runtime) e Marshall (schema)
**Foco:** O que custa manter P2P/WebRTC aberto idle? Quem ganha o quê com
isso? Onde está a chave-mestra disfarçada se tentarmos "otimizar"?

---

## TL;DR — veredito

**CONDITIONAL GO-CLOSE-IDLE**, mas a "otimização" óbvia (fechar P2P
quando user idle) **introduz fingerprinting pior do que mantém aberto**.
A solução não é decidir "abrir vs fechar"; é decidir **o que muda quando
fecha** e garantir que o padrão observável da rede não delate o user.

Ranking final das policies (melhor → pior pra privacidade + manifesto):

1. **Hibernate-on-hidden** com jitter ≥30s + random-walk pause:
   fecha datachannels mas mantém signaling (Nostr DM kind 1059 já é
   gossiped pra inbox; não custa nada extra ficar inscrito). Atacante
   timing-correlation observa "DM activity stops" mas o noise floor do
   Nostr DM inbox é alto o bastante pra mascarar. **RECOMENDADO**.

2. **Always-on** (estado atual): privacy floor previsível mas custa
   bandwidth + bateria. Mais conservador em §16 (sempre re-broadcasta)
   mas pior em §28 (timeline fingerprint trivial).

3. **Aggressive close-on-blur** sem jitter: **EVITAR**. Cria sinal
   binário "ativo/idle" trivialmente classificável por carrier/MITM.

4. **Close-on-network-info-idle** (via NetworkInformation API
   `connection.type`/`saveData`): **NO-GO duro**. Vira chave-mestra
   disfarçada (vide §6 abaixo).

**Top 3 threats privacy ranqueados** (detalhe em §3):
- T-P1: Idle ping/pong leak (15s heartbeat = relógio cardíaco do device)
- T-P2: `hello` broadcast em Nostr DM expõe presença online a qualquer
  observador da inbox npub
- T-P3: STUN/ICE candidate enumeration vaza IP local + estrutura NAT a
  todo peer novo, idle ou ativo

**Commit:** `[a preencher após push]`

---

## 1. Estado atual do transport idle — o que realmente está aceso

Reli `transport/webrtc/` antes de auditar. Resumo do que custa em
runtime quando o usuário abriu Drift e foi tomar café:

| Componente | Tick / evento | Quando dispara | Idle cost real |
|---|---|---|---|
| `startHealthCheckTimer` | 15s (`HEALTH_PING_INTERVAL_MS`) | ensureSignaling boot | 32 peers × ping+pong / 15s = ~4 pkts/s sustained |
| `startRandomWalkTimer` | 30min (`RANDOM_WALK_INTERVAL_MS`) | ensureSignaling boot | até 8 outbound connection attempts por tick |
| `startFollowsDiscovery` | 1h (`FOLLOWS_DISCOVERY_INTERVAL_MS`) | opt-in `p2p_auto_follows` | até `MAX_PEERS * 0.5 = 16` follows, stagger 800ms |
| `pendingPings` array | per-peer | a cada ping enviado | cap 16, mas idle reaproveita |
| `outboundQueue` | per-peer | publish enquanto DC fechado | drain ao reabrir, ok |
| Nostr DM kind 1059 sub | contínua | useNostrSignaling mode | ouvindo signaling msgs a qualquer hora |
| STUN/TURN binding | per-peer | initiateOffer / handleRemoteOffer | mantém binding até DC fechar |
| `probe.ts` 30min | 30min | bootstrap pós-ready | pergunta IDs conhecidos a cada relay WSS |

**Conclusão estrutural**: o sistema **não tem nenhuma noção de "user
idle"**. O único sinal que o transport reconhece é `pagehide` (tab
fechando). Tudo entre "boot completo" e "tab close" roda no mesmo
duty-cycle, AFK ou não. Isso é o ponto de partida pra auditar.

**O que NÃO encontrei e era esperado**:
- Sem `visibilitychange` listener pra pausar timers
- Sem detecção de inatividade de input
- Sem rate-throttle em modo low-power (Page Lifecycle frozen state)
- Sem distinção entre "usuário foi tomar café" vs "usuário deslogou"

Isso não é um bug — é uma escolha implícita "always-on" que ninguém
escreveu como decisão. A questão do user (2026-05-23) é exatamente
sobre *desescolher* essa escolha implícita.

---

## 2. Matriz threat × idle policy

Quatro policies hipotéticas avaliadas contra 8 vetores. Score
qualitativo: `+++` (forte), `++` (médio), `+` (fraco), `-` (vulnerável),
`--` (cria nova vulnerabilidade). `n/a` quando policy não interage com
o vetor.

| Threat / Policy | A. Always-on (atual) | B. Hibernate on hidden+jitter | C. Aggressive close-on-blur | D. Close-via-NetworkInfo |
|---|---|---|---|---|
| T-P1 Idle ping/pong cardiac fingerprint | -- | ++ | + | + |
| T-P2 Nostr DM presence broadcast | - | + | - | - |
| T-P3 STUN/ICE IP leak per reconnect | + | + | -- (re-bind every wake) | -- |
| T-P4 Eclipse via long-lived idle peer | - | ++ | +++ | +++ |
| T-P5 §16 disponibilidade (re-broadcast contribution) | +++ | ++ | + | + |
| T-P6 Carrier/Estado-nação traffic classification | - | ++ | -- (binary on/off) | -- (binary) |
| T-P7 Bateria/data cost mobile | -- | ++ | +++ | +++ |
| T-P8 Chave-mestra disfarçada (§17) risk | + | + | + | -- (NO-GO duro) |
| **Score qualitativo agregado** | **médio-baixo** | **alto** | **baixo** | **muito baixo** |

Veredito da matriz: **B (Hibernate on hidden + jitter)** é a única
policy que melhora privacy + bateria sem trade-off perigoso em outro
vetor. C e D parecem tentadoras mas têm regressões críticas (T-P3 IP
re-leak, T-P6 traffic binary signal).

---

## 3. Privacy leak vetores — análise vetor a vetor

### T-P1 — Idle ping/pong cardiac fingerprint (severidade ALTA)

**Vetor**: `HEALTH_PING_INTERVAL_MS = 15000` envia ping em cada DC
aberto a cada 15s. Em rede, isso aparece como packet train periódico
**idêntico em jitter** ao longo do tempo. Carrier/ISP/MITM observando
o socket WebRTC (TURN proxied) ou DataChannel SCTP packets identifica
"este é cliente Drift idle" com altíssima confiança via period
analysis (FFT trivial sobre packet inter-arrival times).

**Por que cardiac**: bateria/coração do device. Mesmo sem qualquer
input do user, o transport emite sinal periódico estável. Distingue
"app aberto na tela bloqueada" de "app fechado" — exatamente o sinal
que §28 (privacidade observável) não quer entregar.

**O que mitiga**:
- Jitter aleatório ±5s no intervalo (15±5s)
- Pause completo quando `document.hidden === true`
- NÃO substituir por interval mais curto pra "esconder" — pior

**O que NÃO mitiga**: encriptar packet payload. O fingerprint está no
*timing*, não no conteúdo. DTLS encryption já é assumida; não ajuda.

### T-P2 — Nostr DM presence broadcast (severidade MÉDIA-ALTA)

**Vetor**: Em modo Nostr signaling (`VITE_USE_NOSTR_SIGNALING=1`,
default em Fase 6), `hello` / `offer` / `answer` / `ice` viajam como
NIP-44 kind 1059 (gift-wrapped DM). Pra qualquer observador do relay
que monitora a inbox do npub do user, **a frequência de gift wraps
recebidos correlaciona com peers tentando conectar**.

**Atacante observador passivo**:
- Sabe quais relays o user usa (NIP-65 público)
- Subscreve `kinds: [1059]` filtrando `#p: [npub_alvo]`
- Vê DMs *encrypted* chegando, mas conta `timestamps` → "este user
  está online; está negociando WebRTC; provavelmente acabou de abrir
  o app porque a frequência subiu"

Não vê *com quem* — gift wraps escondem o sender. Mas vê *ritmo*.

**O que mitiga**:
- Random walk pausado quando idle (reduz outbound `hello`s)
- Cover traffic seria solução, mas vira tarpit pesado — NO-GO Fase 6
  (manter pra Fase 7+ se telemetria real justificar)
- Nostr DM presence é insolúvel sem mixnet — limite honesto pra
  documentar em `Docs/known-limitations.md`

### T-P3 — STUN/ICE candidate enumeration leak (severidade ALTA, já parcialmente conhecida)

**Vetor**: A cada nova negociação WebRTC, ICE gathering enumera
*todas* as interfaces de rede locais (mDNS, host candidates, srflx via
STUN). Mesmo com mDNS obfuscation moderno (Chrome ≥84), reveal de IP
público via srflx pra peer remoto.

Já reconhecido em `bootstrap.ts:384-388` — `webrtcTransport` não
registra em `network_mode == 'tor'`. Mas em clearnet (default), **cada
peer novo recebe seu IP público**.

**Crítico pra idle**: se policy fecha+reabre datachannels agressivamente
(Policy C), cada ciclo redispara ICE gathering → **mais oportunidades
de leak**. Always-on (Policy A) leaka uma vez no boot e fica.

**Recomendação**: Policy B (hibernate) **NÃO fecha PC; só pausa
ping/pong + random walk**. Mantém PC aberto, evita re-ICE. Acepta
trade-off de DC aberto idle (cardiac fingerprint mitigado por jitter)
em troca de não re-leakear IP.

### T-P4 — Eclipse via long-lived idle peer (severidade MÉDIA)

**Vetor**: Peer ativo 24/7 é alvo preferencial. Atacante com pool de
Sybil pacientes (cluster que parece random-walk natural por meses) tem
janela ampla pra completar eclipse: peer alvo aceita conexões durante
todas as horas, lentamente o random walk substitui peers reais por
Sybils ranqueados altos por uptime.

`peerScore` (em `peerScore.ts`) usa uptime/connection history pra
ranking — uptime longo PESA. Idle peer 24/7 vai ranquear bem mesmo
que nunca propague evento útil.

**O que mitiga**:
- Random walk com 25% random ratio (já implementado, `RANDOM_WALK_RANDOM_RATIO`)
- Hibernate-on-hidden naturalmente reduz uptime → quebra padrão de
  Sybil farm "always-on" — Sybil precisa imitar duty-cycle de humano
  (significativamente mais caro)
- LPA cluster detection (Fase 6.5+, hoje absent) seria definitivo

**Observação adversária interessante**: hibernate-on-hidden tem efeito
**colateral defensivo** — Sybil farms que rodam 24/7 destacam-se contra
população de devices reais que hibernam. Mudança de policy melhora
detection passivamente. Isso é argumento positivo pra Policy B além
da bateria/privacy.

### T-P5 — §16 disponibilidade (contribuição re-broadcast) (severidade BAIXA-MÉDIA)

**Vetor**: §16 promete disponibilidade distribuída via mecânica social.
Peer fechado idle = re-broadcast oportunista cessa = posts virais
perdem ponto de replicação.

**Realidade**: `rebroadcast.ts` dispara em `addRelay()` (user adicionou
relay) ou em `connectTo()` sucesso. **Não é tick periódico**. Peer
hibernado idle não é diferente de peer offline pro re-broadcast — mas
ambos voltam ao acordar.

**Trade-off honesto**: peer fechado por 8h dormindo perde 8h de janela
pra re-propagação. Mas usuário acordando reconecta → re-broadcast
oportunista normal. **Custo marginal pra §16 aceitável** desde que
hibernate seja temporário, não desativação permanente.

### T-P6 — Carrier/Estado-nação traffic classification (severidade ALTA pra §15)

**Vetor**: Atacante de Estado-nação faz DPI + análise estatística.
Always-on cria padrão constante (mais difícil de classificar como
"sessão"). Aggressive close-on-blur cria binário on/off (trivial de
classificar como "user usando agora").

**Game theory**:
- Always-on = "este device tem Drift instalado" (revela existência)
- Binary on/off = "este user está USANDO Drift AGORA" (revela
  atividade)

§15 (anti-censura por país) preocupa-se com **2** — atacante de Estado
quer saber quem está disseminando informação **agora** pra agir em
tempo real. Always-on é melhor pra §15 do que binary on/off.

**Resolução**: Policy B (hibernate com jitter) mantém algum tráfego
mesmo idle (ICE keep-alive de PC aberto, gift wraps Nostr sub
contínua) → padrão menos binário que C/D, mas reduzido vs A.
**Mid-ground aceitável**.

### T-P7 — Bateria/data cost mobile (severidade ALTA pra UX)

**Vetor**: Always-on em mobile mid-range com data plan limitado:
- 4 pkts/s × 24h = 345.600 packets/dia só pra ping/pong idle
- Cada packet ~80-120 bytes DTLS overhead → ~35 MB/dia ambient
- Bateria: WebRTC SCTP keep-alive mantém modem em high-power state →
  pode consumir 5-10% bateria/dia mesmo idle

Em país onde data plan é caro (LATAM, África, Sul/SE Asiático — exatos
mercados que §15 mais quer servir), 35 MB/dia ambient é proibitivo.

**Policy B reduz drasticamente**: hibernate-on-hidden corta ~80% do
duty-cycle típico (usuário usa app ~3h/dia, deixa aberto 21h). ~7 MB/dia
ambient + bateria recuperada. Política amigável a mid-range.

### T-P8 — Chave-mestra disfarçada via APIs externas (severidade CRÍTICA — invariante)

**Vetor**: Tentação óbvia pra detectar idle:
- `navigator.connection.type` (NetworkInformation API): "user em wifi"
  vs "user em cellular" → tomar decisão. **Vendor decide o que é
  "metered" connection.**
- `navigator.connection.saveData`: user pediu economia de dados →
  fechar P2P. **Vendor (Chrome/Safari) decide quando expor isto.**
- `Battery.level / Battery.charging` (deprecated, mas voltando): fechar
  quando bateria baixa. **Vendor decide quando bateria reporta.**

Cada uma dessas APIs **introduz autoridade externa decidindo
comportamento do cliente Drift**. Isto é exatamente §17 / Invariante
12 — chave-mestra disfarçada.

**Por que parece OK e não é**:
- Browser vendor pode mudar comportamento da API em update silencioso
- Browser vendor pode rotular conexão como "metered" arbitrariamente
- Atacante com controle local (extensão, malware) pode forjar valores
- Cliente Drift acaba terceirizando "quando estar online" pra Chromium

**O que está OK usar**:
- `document.hidden` / `visibilitychange`: parte do DOM core, padrão
  W3C, semântica trivial ("aba visível agora?"). Não é decisão de
  política — é fato observável da UI. Comparável a usar `pagehide`
  já em uso.
- Detecção de input local (last `pointerdown`/`keydown` timestamp):
  100% local, sem API externa. OK.
- `Page Lifecycle` API `frozen`/`resumed`: ainda em incubation. Marcar
  TBD; reavaliar quando estabilizar.

**NÃO usar** (declarar NO-GO no doc):
- `NetworkInformation` API (`navigator.connection.*`)
- `Battery` API (`navigator.getBattery`)
- `Idle Detection` API (`navigator.permissions.query({name:'idle-detection'})`)
- Qualquer API que precise permission prompt — fricção + autoridade
  externa em uma só

---

## 4. Game-theoretic veredito

A pergunta operacional não é "fechar ou manter". É:

> **Manter aberto custa privacy + bateria pra ganhar §16. Fechar
> custa §16 + pode regredir §15. Qual perdemos menos?**

Aplicando lente Satoshi (perpetuação da rede > conforto local de cada
node):

1. **Bitcoin nodes always-on**: nó completo Bitcoin tradicionalmente
   roda 24/7. Mas pcs/laptops/desktops com energia e bandwidth
   constantes. Drift roda em **celular**. Mesma policy não copia.

2. **Lightning routing nodes**: fecharam canais idle? Não — perderiam
   liquidez. Mas custo de manter idle é trivial (sem ping/pong
   ambient). Drift WebRTC tem custo ambient real (ping/pong 15s).

3. **Tor relays**: nunca fecham. Mas operados por entusiastas em
   datacenters. Não é peer pessoal. Drift peer é **pessoal**.

4. **BitTorrent**: padrão "seed when convenient, leave when needed".
   Reciprocidade local, não promessa de uptime. Drift é mais próximo
   desse modelo — peer contribui quando pode, não quando "deveria".

**Veredito game-theoretic**: peer pessoal em mobile **deve hibernar
quando user idle**. A rede sobrevive ao tradeoff porque (a) outros
peers cobrem o slot, (b) re-broadcast oportunista cobre janela perdida
ao acordar, (c) population statistics dilui Sybils sempre-ligados.

**Risco residual**: §16 depende de **muitos** peers hibernando em
horários **diferentes** (timezone diversity natural já garante isso).
Validar com telemetria opt-in (Fase 7+).

---

## 5. Convergência com Lily (runtime audit paralelo)

Espero que Lily confirme runtime os seguintes pontos. Se Lily achar
*diferente*, prevalece o achado dela (runtime > teoria):

1. **Confirma**: `startHealthCheckTimer` corre 15s sem cessar, sem
   listener pra `visibilitychange`. (Lily: confere em `webrtc/boot.ts`
   linhas 119-129, sem early-return em hidden state.)

2. **Confirma**: `startRandomWalkTimer` chama `performRandomWalk()`
   imediatamente no boot + a cada 30min. Boot inclui idle state
   (StrictMode pode duplicar em dev). Lily: validar se há dedup real
   em prod (sem StrictMode).

3. **Confirma**: `startFollowsDiscovery` (opt-in) corre 1h sem checar
   document visibility. Lily: linha 71-77 de followsDiscovery.ts.

4. **Pra Lily verificar (runtime que não dá pra inferir de leitura)**:
   - Quantos packets por segundo o transport realmente emite com 32
     peers conectados idle? Minha estimativa: 4-5 pps. Confirmar com
     `chrome://webrtc-internals`.
   - Browser já frozeia DataChannels em Page Lifecycle `frozen` state?
     (Chrome dovrebbe a partir de 87+, mas SCTP pode escapar.)
   - `pendingPings[]` array em peer idle 8h cresce ou estabiliza com
     prune? Suspeito que estabiliza (cap 16) mas convém ver.

5. **Divergências esperáveis se houver**:
   - Lily pode achar que `MAX_PEERS=32` nunca enche em campo (peers
     reais escassos). Se sim, idle cost real é menor que worst case.
   - Lily pode achar que random walk silenciosamente já está pausado
     por algum gating não-óbvio. Se sim, descrever.

---

## 6. NO-GO items — chaves-mestras disfarçadas a NÃO introduzir

Lista dura. Se PR futuro propor qualquer uma destas, **bloquear no
review citando este doc**:

### NO-GO 1: `NetworkInformation` API (`navigator.connection`)

**Tentação**: "fechar P2P quando user está em rede metered".
**Por que é chave-mestra**: vendor (Chromium project, Apple) decide
quando expor metered-flag. Comportamento muda silenciosamente entre
versões. Em alguns browsers só funciona com permission prompt; em
outros sem. Cliente Drift terceirizaria decisão de online-status pro
vendor. §17 violation.

### NO-GO 2: `Battery` API (`navigator.getBattery`)

**Tentação**: "fechar quando bateria <15%".
**Por que é chave-mestra**: deprecated por privacy reasons, voltando
em forma fingerprinting. Tornaria comportamento Drift visível
externamente via timing. Sites third-party puxam batteryLevel e
inferem que "este device está em modo low-power" — Drift estaria
oferecendo extra signal pra fingerprinting da pessoa.

### NO-GO 3: `Idle Detection` API (`IdleDetector`)

**Tentação**: "fechar quando user idle >5min".
**Por que é chave-mestra**: requer permission prompt user-facing.
Friction péssima + introduz autoridade do browser sobre o que conta
como "idle" (input, mouse, fullscreen, etc). Vendor pode mudar
heuristic silenciosamente.

### NO-GO 4: Polling `Geolocation` ou GPS pra inferir idle

**Tentação**: "se device parado fisicamente, é idle".
**Por que é chave-mestra dupla**: (1) GPS poll é privacy disaster
imediato. (2) "Parado fisicamente" ≠ "idle no app". User pode estar
lendo no metrô.

### NO-GO 5: Cloud-side "is user active?" check

**Tentação**: "perguntar ao relay se outros clientes da identidade
estão online".
**Por que é chave-mestra**: relay vira authority sobre estado da
identidade. Quebra §17 explicitamente. Relay pode mentir pra forçar
client a fechar (ataque de censura por degradação).

### NO-GO 6: `Permissions-Policy` header bypass pra detectar idle

**Tentação**: "carregar iframe terceiro pra ler estado de idle".
**Por que é chave-mestra**: third-party domain herda autoridade.

### OK (não chaves-mestra):

- `document.hidden` + `visibilitychange` — DOM core, fato observável,
  sem permission prompt, sem vendor heuristic
- `Date.now()` pra calcular "tempo desde último input local" — relógio
  local, OK
- Last `pointerdown`/`keydown`/`scroll` timestamp tracked localmente —
  100% client, sem API externa
- `performance.now()` pra timing local de jitter — OK

---

## 7. Recomendação final — proposta de idle-state policy

### Policy B refinada: "Hibernate datachannel activity on hidden + jitter"

**Trigger entrada em modo hibernate**:
- `document.visibilityState === 'hidden'` por **≥30s contínuos**
  (debounce — evita flap quando user troca tab rapidamente)
- Validar com `performance.now()` local; não usar nenhuma API externa

**O que acontece em hibernate**:
1. **Pausa `startHealthCheckTimer`** — para ping/pong outbound (mantém
   inbound handler ativo pra responder a pings de outros peers que
   ainda estão ativos; reciprocidade da rede)
2. **Pausa `startRandomWalkTimer`** — não busca peers novos enquanto
   idle (reduz `hello` broadcasts via Nostr DM)
3. **Pausa `startFollowsDiscovery`** se opt-in
4. **NÃO fecha PeerConnections existentes** — mantém DTLS state pra
   evitar re-ICE/re-leak de IP ao acordar (T-P3)
5. **NÃO cancela Nostr DM subscription** — gift wraps recebidos
   acumulam pra processar ao acordar (presença na inbox seria
   detectável de outro jeito de qualquer forma)
6. **Jitter ±5s no próximo wake** — evita exact-time fingerprinting

**Trigger saída de hibernate**:
- `document.visibilityState === 'visible'` OU
- `pointerdown` / `keydown` local detectado OU
- 30min decorridos em hibernate (refresh forçado pra evitar peer drift)

**Ao sair de hibernate**:
1. Resume `startHealthCheckTimer` com primeiro tick em `15s + jitter(0..5s)`
2. Resume `startRandomWalkTimer` — primeiro tick em `60s + jitter`
   (dá tempo do user usar antes de buscar novos peers)
3. Resume `startFollowsDiscovery` se opt-in
4. Processa qualquer Nostr DM signaling acumulada

### Settings UI (não-default mudar comportamento)

- **Toggle "Hibernar P2P quando app em segundo plano"**: default ON
  na Fase 6.5 (após verificação telemetria opt-in que confirma
  benefício bateria; HIMYM deliberation prévia)
- Tooltip explica: "Reduz bateria e dados. Pode atrasar entrega de
  posts virais por alguns segundos ao acordar."
- LOCK_VIA_TEST: garantir que toggle não introduz dependência em
  `navigator.connection`, `Battery`, `IdleDetector`

### LOCK_VIA_TEST a adicionar (Marshall complementar)

- `tests/p2p-idle-conformance.test.ts` (proposto):
  1. `webrtc/` code não importa `navigator.connection`
  2. `webrtc/` code não importa `getBattery` ou `Battery`
  3. `webrtc/` code não importa `IdleDetector` / `idle-detection`
  4. Visibilitychange handler usa apenas `document.visibilityState`
  5. Wake-up jitter está presente (não exact-time wake)

### Conditions of safety (gates antes de shipar)

1. **Lily confirma runtime** que `startHealthCheckTimer` não tem early
   exit hidden state (este audit assume leitura estática)
2. **Marshall confirma** que adicionar visibilitychange listener não
   quebra schema/conformance dos 9078..9081 (não deve — é puramente
   transport-side)
3. **Smoke test 2 abas**: hibernate em uma aba, mensagem enviada na
   outra → confirma chegada ao acordar (latência aceitável <30s)
4. **Documentar limite honesto** em `Docs/known-limitations.md`:
   "Drift P2P hiberna quando aba em segundo plano. Posts em peers
   apenas-P2P podem demorar até 30s pra aparecer ao retomar."
5. **Roll-out opt-in primeiro** (Settings toggle default OFF na 6.5),
   default ON na 6.6 após coleta de feedback

### O que NÃO mudar (importante)

- Não mexer em `pagehide` cleanup — funciona, é janela diferente
- Não introduzir Page Lifecycle `frozen` handler ainda — esperar
  spec estabilizar
- Não tentar "smart" detection (ML local de idle) — over-engineering
- Não tentar reduzir `HEALTH_PING_INTERVAL_MS` pra esconder fingerprint
  — pior; mantém 15s + jitter

---

## 8. Resposta direta ao user

> "P2P está aberto sem usar — pode-se otimizar? discovery"

**Sim, pode**, mas a otimização não é "fechar P2P". É **hibernar
seletivamente** quando aba em background, mantendo PCs abertos pra
evitar re-leak de IP. A intuição "fechar quando idle" é correta na
direção; a implementação naive (fechar tudo, reabrir on focus) é
pior do que o estado atual em 2 dos vetores (T-P3 IP re-leak, T-P6
binary classifiable signal).

**Caminho recomendado**:
1. Settings toggle "Hibernar P2P em background" — Fase 6.5
2. Implementação: pausar timers ping/pong + random walk; manter PCs
3. Wake-up com jitter pra evitar timing fingerprint
4. LOCK_VIA_TEST contra reintrodução de APIs vendor-controlled
5. Default OFF na 6.5, ON na 6.6 após validação

**Bateria salva estimada**: 60-80% do duty-cycle idle (sustained
ping/pong) — em mobile mid-range, ~7-15% de dia de bateria recuperado.
**Privacy ganha**: corta cardiac fingerprint (T-P1) e reduz Nostr DM
presence broadcast (T-P2). **§16 cost**: aceitável (janela <30s na
retomada).

---

## 9. Honestidade radical — o que esta auditoria NÃO cobre

- **Não tem telemetria real**: estimativas de bandwidth/bateria são
  back-of-envelope. Confirmar com `chrome://webrtc-internals` + medição
  controlada em Pixel/Moto mid-range antes de declarar default ON.
- **Não cobre Fase 6 Tor**: comportamento Tor-circuit idle merece audit
  próprio (manter circuit ou fechar? questão pra arti integration).
- **Não cobre Fase 7 BLE/sneakernet**: bundle offline tem assumptions
  diferentes de online P2P; idle policy lá será outra deliberação.
- **Não cobre WebRTC over Tor** (se vier): inviabiliza P2P direto, mas
  signaling via Tor permanece — interage com decisão de presence
  broadcast.
- **Não substitui peer review humano**: este doc é análise estruturada
  de uma persona, não revisão por equipe externa. Decisões shipping
  precisam HIMYM completo (Barney+Ted+Marshall+Lily+Robin).

---

*Persona: Satoshi Nakamoto · Audit doc-only · 2026-05-23 · Drift Fase 6
P2P idle cost · Convergência com Lily (runtime) + Marshall (schema) em
paralelo*
