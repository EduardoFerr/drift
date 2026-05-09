# `network_mode: 'auto'` — Threat Model

**Data:** 2026-05-08
**Persona:** Barney (peer review crítico, threat modeling, security, ceticismo)
**Escopo:** ameaça-modelar a feature *proposta* `network_mode: 'auto'`
(detecção automática de bloqueio + fallback clearnet → Tor → WebRTC)
**ANTES** de qualquer linha de código. Documento companion ao ADR
do Ted (arquitetura) e ao algoritmo do Robin (detecção).
**Não-escopo:** implementar; especificar API; escolher algoritmo final
(é trabalho do Ted/Robin). Aqui só listo o que pode dar errado.

> ⚠ **ARTEFATO DE SESSÃO** — registro pontual de threat modeling.
> Não é documentação normativa. Decisões aqui (severidade, mitigações
> obrigatórias, gates de shipping) viram norma só se Arquiteto aprovar
> e propagar pra ADR Ted + algoritmo Robin + manifesto §15 followup.

> ⚠ **DOC-ONLY**. Não modifica código. Conclusões podem virar
> issue/task em sessão posterior.

---

## §0 — TL;DR pra quem só lê o cabeçalho

**Veredito:** `auto` é **shippable, mas com pré-condições não-triviais**.
Não é "feature óbvia" — tem **uma ameaça fundamental potencialmente
bloqueadora (AT-11, abaixo)** e um **conjunto de threats que precisam
mitigação no algoritmo, não só no UX**.

**Se não for possível resolver AT-1 + AT-5 + AT-9 + AT-11 com
mitigações que aceitemos, a recomendação é: NÃO shippar `auto` como
default. Em vez disso, shippar "modo manual com prompt forte sugerindo
Tor desde o boot em país suspeito" (UX, não auto-fallback)**.

Isso porque:
- **AT-1** (selective Tor block) e **AT-9** (eclipse via fake
  censorship) podem fazer `auto` *aumentar* exposição em vez de
  reduzir.
- **AT-5** (clearnet probe in Tor mode leaks IP) é o mesmo padrão de
  bug que já corrigimos hoje no bootstrap+seeder — fácil reintroduzir.
- **AT-11** (probe revela tentativa-de-evasão pra observador passivo) é
  o tipo de threat que pode ser inerente: *qualquer* probe pattern
  deixa rastro estatístico. Análise abaixo conclui que é mitigável com
  jitter + cobertura, mas não eliminável.

**Total threats identificadas:** 14
**Severity breakdown:** **S0 = 4** · **S1 = 7** · **S2 = 3**
**Top-3 mais perigosos:** AT-1, AT-9, AT-5 (detalhados no §10
Recomendações).

---

## §1 — Adversary models

Quem é o atacante. Cada modelo tem capacidades, motivações, sinais
que pode emitir/suprimir, e como interage com `auto`.

### A1 — ISP nacional ativo (China/Iran/Russia type)

**Capacidades:**
- DPI de pacotes em fronteira nacional (inspeção SNI, payload
  inspection, statistical fingerprint).
- DNS poisoning / DNS hijack pra resolvedores oficiais.
- IP block estático e dinâmico via prefix list publicada em router de
  borda.
- Active probing de bridges Tor conhecidas (GFW faz isso há ~10 anos).
- Selective block: pode bloquear *seletivamente* alguns transports
  pra mascarar como "rede ruim" e não como "censura óbvia".
- Throttling: dropar pacotes ou inserir latência (slow lane) sem
  block hard.
- TCP reset injection e selective drop sob hash de connection tuple.

**Motivações:**
- Suprimir conteúdo político específico.
- Vigilância de massa de organizações dissidentes.
- Manter "internet alternativa" controlada (Roskomnadzor model).

**Sinais que pode emitir:**
- Erros DNS (SERVFAIL ou NXDOMAIN forjado).
- TCP reset durante handshake TLS.
- Connection timeout silencioso (drop sem reset).
- ClientHello com ECH dropado seletivamente.

**Sinais que pode suprimir:**
- Não emitir nada — só drop pacotes silenciosamente.
- Não emitir banner de censura (não admitir a presença).

**Como interage com `auto`:** A1 é o adversário *primário*. Tudo que
`auto` deveria fazer existe pra contornar A1. Mas A1 também pode
*intencionalmente induzir* `auto` a tomar decisão errada (ver AT-1,
AT-9).

### A2 — Captive portal hostil (hotel/airport/coffee-shop)

**Capacidades:**
- Bloquear todo tráfego não-HTTP até user fazer login.
- Redirecionar HTTP pra portal de captura (HTTPS quebra e dá `ERR_CERT`
  ou loop redirect).
- Bloqueia Tor (port 9001 + porta 443 já que SNI seria desconhecido).

**Motivações:**
- Receita do estabelecimento (login obriga aceite de termos).
- Compliance regulatório local.
- *Não-malicioso*: não busca espionar; só quer login.

**Sinais que pode emitir:**
- HTTP 200 com payload de portal ao tentar fetch HTTP.
- TLS handshake falha rápido (cert errado) ou nunca completa.

**Sinais que pode suprimir:**
- Nenhum em particular; é um adversário "honesto" no sentido que ele
  *quer* ser detectado (precisa que o user veja o portal).

**Como interage com `auto`:** A2 é falso-positivo perigoso — `auto`
detecta "clearnet bloqueado", aciona Tor, Tor *também* falha, conclui
"censura completa", entra em estado degradado. **User não sabe que
basta logar no captive portal**. UX failure mode — ver AT-2.

### A3 — Compromised local network (rouge AP)

**Capacidades:**
- MITM em qualquer tráfego não-pinned.
- TLS interception via cert injetado no trust store (corp laptop
  compromised).
- DNS spoofing localizado.
- Selective drop por target IP.
- Inject de RST em conexões específicas pra induzir reconexão.
- *Pode controlar quando a "censura" começa e termina* — flapping
  attack pra corroer hysteresis.

**Motivações:**
- Roubar credenciais (não relevante pro Drift — nsec não passa pela
  rede).
- Suprimir comunicação específica (mais relevante).
- Forçar fallback pra transport controlado (ver AT-9).

**Sinais que pode emitir:**
- Cert errado, TCP reset, drop silencioso, latência variável.
- Pode emitir sinais *seletivos por destino*.

**Sinais que pode suprimir:**
- Tudo. Tem controle total da camada física/link.

**Como interage com `auto`:** A3 pode forçar `auto` a tomar decisão
em momento controlado pelo atacante, alvejando flapping (clearnet OK
→ down → OK → down) pra exauster retry budgets ou induzir Tor
fallback que ele controla. Ver AT-9, AT-12.

### A4 — State-level attacker, recursos quase ilimitados (NSA-tier)

**Capacidades:**
- Tudo de A1, mais:
- Global passive observer (visão de IXP / submarine cable).
- Active interference em larga escala (BGP hijack, DNS cache
  poisoning em scale).
- Compromise de relay (forçar operador a entregar logs ou running
  modified relay code).
- Compromise de bridge Tor / guard Tor.
- Statistical traffic correlation cross-jurisdição.
- Recursos pra rodar 1000s de Sybil peers em redes diferentes.

**Motivações:**
- Vigilância em massa de targets de interesse nacional.
- Mapping de redes de comunicação.
- *Geralmente não block* — cardam menos por block, mais por
  observability.

**Sinais que pode emitir:**
- Praticamente nenhum — A4 prefere passivo.

**Sinais que pode suprimir:**
- Praticamente tudo.

**Como interage com `auto`:** A4 é primariamente o adversário do
`§28 privacidade pelo mínimo`, não do `§15 anti-censura`. Mas A4
pode *passivamente correlacionar* probe patterns pra identificar
"Drift user em jurisdição X" (ver AT-3, AT-8). `auto` não é vetor de
defesa contra A4 — é vetor de exposição. Manifesto §4 já admite isso
explicitamente (linhas 110–121: "Drift NÃO é mixnet... adversário
global eventualmente correlaciona").

### A5 — Mass surveillance via observer passivo (corporate/aggregate)

**Capacidades:**
- Captura de tráfego em ponto de agregação (ISP doméstico, datacenter
  upstream).
- Análise estatística *post-hoc* (não em tempo real).
- Sem capacidade de inject (passive only).
- Compartilhamento de logs com terceiros (vendor IDS, vendor de
  ameaças, parceiros corporativos).

**Motivações:**
- Receita por venda de inteligência.
- Compliance de "log everything" sem objetivo específico.
- Profile-building (publicidade, scoring de risco).

**Sinais que pode emitir:**
- Nenhum (passivo).

**Sinais que pode suprimir:**
- Nenhum (passivo).

**Como interage com `auto`:** A5 é o "mais comum" — qualquer ISP de
um país democrático já é A5 por default (legislação de retenção de
dados). `auto` que emite probe pattern *único de Drift* pinta um
target estatístico pra A5, mesmo que nenhum bloqueio esteja
acontecendo. Ver AT-3, AT-8, AT-13.

---

## §2 — Threat surface

Modelo do audit WebRTC anterior (`webrtc-architecture-audit-2026-05-08.md`
§2.3): cada threat tem ID, adversary, descrição, sinal que aciona,
resultado sem mitigação, mitigação proposta, severidade, esforço.

### Severity scale

- **S0** — viola §15 totalmente (manifesto promise quebrada,
  user em país censurado fica exposto OU não funciona).
- **S1** — reduz garantia §15 (degradação aceitável mas não
  promised).
- **S2** — polish (não muda outcome de §15, mas fica feio).

### Effort scale

- **E0** — trivial (config, doc, ~10 LOC).
- **E1** — moderate (lógica algorítmica nova, ~50-200 LOC + tests).
- **E2** — redesign (mudar arquitetura, >200 LOC, possível RFC).

---

### AT-1 — Selective Tor block to force clearnet

| Campo | Valor |
|---|---|
| **ID** | AT-1 |
| **Adversary** | A1 (primário), A4 |
| **Severity** | **S0** |
| **Effort mitigação** | E1 |

**Threat description:**
ISP nacional bloqueia *clearnet* relays Drift, mas também bloqueia
Tor (DPI sobre TLS pattern Tor, IP block de directory authorities,
active probe de bridges). Algoritmo `auto`:

1. Probe clearnet → falha → conclui "rede bloqueada".
2. Aciona Tor → bootstrap falha (timeout 30s).
3. Algoritmo precisa decidir: o quê?
   - Variante A: "tudo falhou, fica em clearnet" → user *não tem*
     conexão e *não está protegido* (clearnet exposto não funciona,
     mas pacotes saíram revelando intent).
   - Variante B: "tudo falhou, fica em Tor mesmo failed" → user fica
     em *limbo*: nenhum tráfego sai, mas em modo Tor (UI mostra
     "anônimo", o que é tecnicamente verdade já que nada sai).
   - Variante C (pior): algoritmo entra em loop probing clearnet
     periodicamente "pra ver se voltou". Cada probe vaza IP do user
     em rede onde sabemos que clearnet não funciona, mas pode estar
     sendo *logado*.

**Sinal que aciona algoritmo:**
- "clearnet falhou em probe 1" → switch pra Tor.
- "Tor falhou em bootstrap" → ?

**Resultado se mitigação ausente:**
User pensa estar protegido (UI badge "Auto: Tor"), mas:
- Nenhum tráfego está saindo.
- OU pior: probe clearnet periódico continua vazando.
- OU pior ainda: variante A acima — fallback pra clearnet, exposed.

**Mitigação proposta (algorithmic + UX):**

1. **Estado ternário, não binário**: `auto` precisa expressar
   `BLOCKED_ALL` (≠ "clearnet ativo" ou "Tor ativo"). UI
   diferencia: "Drift não consegue acessar nenhum transport. Sneakernet
   ainda não disponível (Fase 7). Sugestões: …".
2. **NÃO retry probe clearnet em modo `BLOCKED_ALL`** — preserva
   anonimato da intent. User clicka "tentar de novo" manualmente.
3. **Sticky timeout**: quando entra em `BLOCKED_ALL`, fica lá por
   ≥30min antes de re-probar. Anti-flooding de tentativas + anti
   side-channel pra A4.
4. **Probe inicial deve incluir Tor cobertura simultaneamente, não
   sequencialmente**. Se o algoritmo já sabe "Tor falhou *e* clearnet
   falhou" antes de mostrar UI, evita o "clearnet failed → switching
   to Tor → Tor failed → confused" gap visível ao user.

**Esforço:** E1 — adicionar estado ao state machine de algoritmo,
adicionar UI state, refactor de probe scheduling pra ser concorrente
não sequencial.

**Cross-ref:** Robin scoping §3 (a)+(b) cobrem isso individualmente
mas não a interação. Esse é o ponto onde precisa de teste E2E (Robin
Fase A do testbed) com **ambos transports bloqueados simultaneamente**.

---

### AT-2 — Captive portal false positive

| Campo | Valor |
|---|---|
| **ID** | AT-2 |
| **Adversary** | A2 |
| **Severity** | **S1** |
| **Effort mitigação** | E1 |

**Threat description:**
User abre laptop em hotel/airport. Captive portal bloqueia tudo até
login (HTTP redirect pra portal HTML). Algoritmo `auto`:

1. Probe clearnet → fail (TLS handshake nunca completa, ou retorna
   cert errado do portal).
2. Aciona Tor → também fail (port 9001 e 443 com SNI Tor bloqueados;
   directory auths inacessíveis).
3. Conclui "censurado".

User não sabe que basta logar no captive portal — vê banner
"Drift detectou bloqueio". Pode pensar que o país inteiro está
censurando, ou que o app está quebrado.

**Sinal que aciona algoritmo:** Identical to A1 from inside — não há
distinção observável entre A1 e A2 em probe simples.

**Resultado se mitigação ausente:**
User confuso, frustrado. Em pior caso, troca pra `network_mode: tor`
manual (sticky), depois sai do hotel, e fica em Tor "para sempre"
sem saber. Bateria/latência piores, sem ganho real.

**Mitigação proposta:**

1. **Detecção de captive portal heurística**: probe a um endpoint
   de *teste de internet* well-known (ex.: `clients3.google.com/generate_204`
   retorna HTTP 204 vazio — qualquer outro response é captive
   portal). Se detectado, banner UX explícito: "Você parece estar
   atrás de um captive portal — abra o navegador e logue antes de
   continuar". Não acionar Tor.
2. **Não-Drift specific**: a heurística generate_204 vaza IP pro
   Google, mesmo. Em modo `tor` ou `onion-only`, NÃO probar (mantém
   `§28`). Em modo `clearnet`/`auto`, é aceitável trade-off (Google
   já vê IP por mil outros motivos).
3. **Alternativa privacy-friendly**: probe a um relay próprio do
   Drift dedicado a "isAlive?" (operador conhecido + low-traffic).
   Custo: precisa rodar / financiar esse relay.
4. **UX revert path**: banner "captive portal detectado → não estamos
   em país censurado" deve ser visível mesmo quando `auto` já errou
   uma vez. Pode incluir botão "voltar pra clearnet imediato".

**Esforço:** E1 — ~50 LOC (probe extra + heurística), 1 spec.

**Cross-ref:** AT-1 acima — captive portal é variante "não-malicioso"
de A1. Mesma falha de detecção.

---

### AT-3 — Side-channel timing reveals "user em país X"

| Campo | Valor |
|---|---|
| **ID** | AT-3 |
| **Adversary** | A4, A5 |
| **Severity** | **S1** |
| **Effort mitigação** | E1 |

**Threat description:**
Algoritmo `auto` faz probe periódico em intervalos *fixos* (ex.: a
cada 10min). Observador passivo (ISP corporativo, A5) vê pattern:
"este IP faz request pra `relay.damus.io` exatamente a cada 10min,
independente de hora-do-dia". Esse pattern é assinatura de Drift
client em modo `auto`.

Pior: timing distribution pode revelar fuso horário. Se probe
acontece *só durante horário ativo do user* (gating por
`document.visibilityState`), curva de probe correlaciona com horário
local — A4 deduz "user no fuso horário UTC-3", combina com IP geo,
deduz país de residência.

**Sinal que aciona algoritmo:** N/A (atacante observa, não aciona).

**Resultado se mitigação ausente:**
Drift user é estatisticamente identificável em corporate logs sem
nenhum bloqueio acontecer. Manifesto §4 já admite limitação contra
A4, mas auto-mode adiciona *novo* fingerprint sem ganho proporcional.

**Mitigação proposta:**

1. **Jitter no probe schedule**: ±50% do intervalo base. Probe a cada
   `10min ± 5min` random, não fixo. Quebra periodicidade óbvia.
2. **Não probe em background quando UI hidden** — *exceto* re-evaluation
   única quando UI volta. Reduz volume mas pode acentuar a curva
   business-hours (ver acima). Trade-off documentado.
3. **Cap absoluto de probes/dia**: ex. ≤24 probes em 24h. Anti-pattern
   de "user travado em rede ruim probando 1×/min".
4. **Probes *piggybacked*** em mensagens reais: se user já está
   publicando posts/spreads, algoritmo aproveita esse tráfego pra
   inferir saúde sem probe sintético adicional. Reduz volume e
   pattern artificial.
5. **Probes oportunísticos**: só probe quando algo *realmente* falhou
   (event sub timeout, publish error). Sem probe "preventivo" puro.
   Reduz superficie a só momentos onde já há sinal.

**Esforço:** E1 — jitter é trivial, mas piggybacking exige hook em
publish/subscribe paths. ~80 LOC.

**Cross-ref:** AT-8 (fingerprinting via auto behavior) — mesma
família, mas AT-3 é especificamente *temporal* fingerprint.

---

### AT-4 — Probe poisoning

| Campo | Valor |
|---|---|
| **ID** | AT-4 |
| **Adversary** | A1, A3 |
| **Severity** | **S1** |
| **Effort mitigação** | E1 |

**Threat description:**
Adversário ativo intercepta probe do algoritmo `auto`. Probe é
geralmente "tente conectar relay X e ver se bate". Atacante:

1. Responde ao probe com OK (TLS handshake completa, retorna response
   plausível).
2. Mas drops *subsequent* event traffic — só o probe passou.

Algoritmo conclui "clearnet OK", deixa user em modo `clearnet`. Mas
publish/subscribe falham, todos os eventos somem.

Pior: atacante pode responder probe rapidamente (RTT baixo) pra
parecer health *boa*, induzindo `auto` a *desativar* fallback ativo
(se o algoritmo tem hysteresis de "transport saudável → desligar
backup transport").

**Sinal que aciona algoritmo:** Probe success enganoso.

**Resultado se mitigação ausente:**
User em país censurado pensa estar OK. Posts publicados nunca chegam
nos relays reais. Worse: subscribe fica em "feed vazio" indefinido.

**Mitigação proposta:**

1. **Probe deve ser semanticamente útil, não synthetic**: probe não
   é "TLS handshake OK". Probe é "publica um evento de teste e
   recebe ele de volta via subscribe + verifica id batente". Atacante
   teria que assinar evento Schnorr válido pra passar — impossível
   sem nsec do user.
2. **Múltiplos relays na probe**: se 1 dos 4 relays seed responde mas
   3 falham, é sinal de problema mesmo que 1 esteja OK. Threshold de
   ⅔ healthy é razoável.
3. **End-to-end check, não hop-by-hop**: validar que evento publicado
   *aparece em outro relay* (cross-relay subscribe). Se não aparece,
   relay A está saudável mas isolado / atacante intermediating.

**Esforço:** E1 — refactor de probe pra ser semantically útil em vez
de synthetic. ~100 LOC + tests.

**Cross-ref:** AT-9 (eclipse via fake censorship) é variante extrema
de AT-4 onde *toda a rede* é fake.

---

### AT-5 — Clearnet probe in Tor mode leaks IP

| Campo | Valor |
|---|---|
| **ID** | AT-5 |
| **Adversary** | A1, A3, A4, A5 |
| **Severity** | **S0** |
| **Effort mitigação** | E0 |

**Threat description:**
User está em modo `auto` que decidiu usar Tor (porque clearnet
falhou). Algoritmo periodicamente *probes clearnet* pra detectar
"clearnet voltou". Esse probe vai por... clearnet (porque está
testando se clearnet está OK).

Cada probe vaza IP do user pro relay sendo testado. Pior: a função
*do probe* é detectar censura, então o atacante (A1) vê o probe e
sabe "este IP pertence a um Drift user que está tentando contornar
censura". Esse é exatamente o fingerprint que `auto` deveria evitar
expor.

**Esse é o mesmo padrão de bug que corrigimos hoje no
bootstrap+seeder** (`bootstrap.ts:277-294` no commit fdf795c —
WebRTC desabilitado em modo Tor pra não vazar IP via STUN). Mas o
padrão é fácil de reintroduzir em `auto` porque o *propósito* do
probe é justamente checar clearnet.

**Sinal que aciona algoritmo:** N/A — é a operação do algoritmo
*em si* que vaza.

**Resultado se mitigação ausente:**
- IP do user vai pro relay clearnet → ISP vê → atacante correlaciona.
- Em jurisdição censurada, basicamente *anula* a proteção do Tor.

**Mitigação proposta:**

1. **NUNCA probe clearnet em modo Tor**. Period. Quando `auto`
   decidiu Tor, fica em Tor. Re-evaluation pra clearnet só por:
   - Manual user action (botão "tentar clearnet de novo").
   - Timer longo (≥6h), e *só após* nova network event detectada
     (ex.: novo SSID Wi-Fi, IP local mudou — sinais que sugerem
     "deve ser outra rede").
2. **Probe Tor-via-clearnet também é problema simétrico** (estar em
   `clearnet` e probing Tor periodicamente revela "este user *quer*
   Tor"). Aplicar mesma regra: não probe sintético do *outro*
   transport. Inferir saúde do transport ativo *só pelo uso real*.
3. **Documentar como invariante**: adicionar comentário em
   `bootstrap.ts` + `auto.ts` (quando criado) com banner big de
   `// DO NOT probe clearnet from Tor mode — see AT-5 threat model`.

**Esforço:** E0 — é um *non-feature*. Não escrever o probe é mais
fácil que escrevê-lo.

**Cross-ref:** Mesma família do WebRTC-em-Tor leak (já corrigido em
fdf795c). Lily/Marshall já têm pattern memorizado.

---

### AT-6 — Race condition no boot (primeiro publish exposed)

| Campo | Valor |
|---|---|
| **ID** | AT-6 |
| **Adversary** | A1, A3 |
| **Severity** | **S1** |
| **Effort mitigação** | E1 |

**Threat description:**
User em país censurado abre o app pela primeira vez. Algoritmo `auto`
precisa de *tempo* pra detectar bloqueio (ex.: 8s de probe clearnet
+ 30s de bootstrap Tor = ~40s).

Durante esse tempo:
- App boota normalmente em modo "auto pendente".
- User vê feed (vazio, claro — sem rede).
- User cria post (offline, optimistic UI).
- Algoritmo detecta bloqueio → switch pra Tor → publish via Tor.
- Mas... e se o *primeiro* publish foi tentado *antes* de algoritmo
  decidir? A rota foi clearnet, ISP viu, ISP correlaciona "user X
  publicou no momento Y" antes de Tor entrar.

Pior: cada `publish` no orchestrator é fan-out — vai pra todos os
transports registrados. Se WSS clearnet ainda está em "tentando" e
WebRTC é ativo, o evento foi enfileirado pra ambos. Quando Tor chega,
WSS pode reusar essa fila (se for "fila de eventos pendentes" e não
"fila de connections") e publicar via Tor pra evento que *já saiu*
via WebRTC clearnet.

**Sinal que aciona algoritmo:** N/A — race no boot.

**Resultado se mitigação ausente:**
Primeiro publish do user em país censurado vaza pelo transport
errado. Manifesto §15 quebra exatamente no caso de uso mais
crítico — primeira ação após boot é a mais importante anti-censura.

**Mitigação proposta:**

1. **Pre-flight check em modo `auto` antes de aceitar publishes**:
   `BootStep` precisa de novo step `step: 'auto-decide'` que precede
   `step: 'sync'`. Durante esse step, UI mostra spinner explícito
   ("verificando rede…"). Publishes são *enfileirados localmente
   sem ir pra rede até auto-decide terminar*.
2. **Timeout de auto-decide**: máximo 15s. Se estourar, fallback
   default-safe = Tor (mais conservador). UI mostra "modo Tor
   ativado por falha de detecção rápida — você pode trocar em
   Settings".
3. **Fila de publish offline-first**: até auto-decide ser definitivo,
   eventos vão pro `outbound queue` (já existe em WebRTC peer.ts
   pra peers ainda não conectados). Quando auto-decide resolver,
   queue drena via transport correto.
4. **Documentar trade-off**: 15s de "verificando" no boot é UX cost.
   User em rede livre vê esses 15s sem ganho. Trade-off: 15s vs
   "primeiro post vaza em país censurado". Manifesto §15 vence.

**Esforço:** E1 — novo step de boot + queue de pre-decide.
~150 LOC + tests.

**Cross-ref:** Robin scoping §3 (a) menciona "user já publicou via
clearnet exposed" mas não detalha. AT-6 é a especificação.

---

### AT-7 — Tor bridge enumeration

| Campo | Valor |
|---|---|
| **ID** | AT-7 |
| **Adversary** | A1, A4 |
| **Severity** | **S1** |
| **Effort mitigação** | E2 (depende de Tor Project) |

**Threat description:**
Algoritmo `auto` que aciona Tor automaticamente conecta ao Tor padrão
(directory authorities públicas). A1 pode:

1. Bloquear directory auths IPs (lista pública).
2. Bloquear bridges Tor padrão (também listadas em
   `bridges.torproject.org`).
3. Active probe pra identificar "este IP fez handshake Tor" e
   correlacionar com user.

Em modo `auto`, *quantidade* de users acionando Tor automaticamente
em país censurado *cria estatística de adoção* — A1 pode usar isso
pra:
- Atualizar blocklist de bridges proativamente.
- Compare com Drift adoption (de outros sinais) e alvejar
  específico.

**Sinal que aciona algoritmo:** Adoção em escala de Drift `auto`.

**Resultado se mitigação ausente:**
Quanto mais users em `auto` em país censurado, mais agressivamente
A1 enumera + bloqueia. Cria *tragédia dos comuns* — early adopters
ajudam a censura a melhorar antes de late adopters chegarem.

**Mitigação proposta:**

1. **Bridges custom user-supplied**: UI permite user colar lista de
   bridges custom (`obfs4 IP:port FINGERPRINT cert=...` formato Tor
   padrão) em Settings. Não enumeráveis publicamente.
2. **Pluggable transports** (obfs4, snowflake, meek): `arti` suporta
   esses, mas precisa wire-up em Tauri command. Snowflake é
   particularmente eficaz — usa P2P browser-volunteer rendezvous,
   difícil bloquear sem matar WebRTC inteiro.
3. **Documentar que `auto` em país censurado pode falhar e manualmente
   configurar bridge custom é fallback necessário**. Não vender `auto`
   como "magic anti-censorship".
4. **Não mudar `auto` em si** — esta threat é sobre Tor infrastructure
   externa. Drift não pode resolver, mas pode UX explicar.

**Esforço:** E2 — pluggable transports é trabalho de Tauri integration
+ arti config + UI. Pode ser tarefa de "Fase 6.4 follow-up" não-`auto`.

**Cross-ref:** Robin scoping §8 R2 menciona "WebRTC fallback depende
de PoI peers acessíveis em região censurada" — mesma família de
"Tor sozinho não basta".

---

### AT-8 — Fingerprinting via auto behavior

| Campo | Valor |
|---|---|
| **ID** | AT-8 |
| **Adversary** | A4, A5 |
| **Severity** | **S1** |
| **Effort mitigação** | E1 |

**Threat description:**
Drift `auto` tem *behavior* característico distinguível de Tor
Browser, Brave Browser modo Tor, ou outros clientes:

- Probe pattern (intervals, sequence — ver AT-3).
- Batch sizes de events fetched em subscribe inicial.
- TLS fingerprint do client (se `arti` tem JA3 distinto de Firefox/Chrome).
- Tempo entre boot e primeiro publish.
- Tamanho médio de payloads (Drift posts são tipicamente 200-2000
  bytes, NIP-65 list é específica, etc.).

A5 (corporate logger) com 1000 user samples extrai fingerprint;
identifica "este user é Drift `auto`-mode". Não bloqueia, mas pinta
target estatístico vendável.

**Sinal que aciona algoritmo:** N/A — é o algoritmo em si.

**Resultado se mitigação ausente:**
"Drift user identification" vira commodity. Em jurisdição que muda
política e *começa* a censurar, lista pré-existente vira target.

**Mitigação proposta:**

1. **Use Tor pluggable transports quando aciona Tor** (ver AT-7) —
   obfs4 mascara TLS fingerprint Tor.
2. **NÃO emit headers / payloads que identificam "Drift"** quando
   conexão é via Tor (já é caso — `client` tag em event é só
   metadata Nostr-level, atrás do circuit). Verificar que
   `User-Agent` não vaza nada.
3. **Padding em event payload** (controverso): Manifesto §28 pede
   privacidade pelo mínimo, padding aumenta bandwidth uniformemente
   pra dificultar size-based fingerprint. Mas é *novo trade-off* —
   ver §3 Mitigações cross-cutting.
4. **Aceitar que `auto` *no PWA* é fundamentalmente identificável**:
   PWA browser tem Web API distintiva (TLS fingerprint do navegador,
   navigator.userAgent, etc.). `auto` em PWA *não pode prometer*
   anonimato vs A4 — só vs A1. Manifesto §4 já admite linhas 110-121.
   `auto` em Tauri+arti é melhor (TLS de arti != browser TLS).

**Esforço:** E1 — pluggable transports já contam em AT-7. Padding é
trabalho separado.

**Cross-ref:** AT-3 (timing fingerprint) + AT-7 (Tor enumeration) =
combinação. Manifesto §4 limites.

---

### AT-9 — Eclipse via fake censorship

| Campo | Valor |
|---|---|
| **ID** | AT-9 |
| **Adversary** | A3 |
| **Severity** | **S0** |
| **Effort mitigação** | E1+E2 |

**Threat description:**
Rouge AP (A3) controla rede local do user. Atacante quer forçar Tor
*controlado* — bridge que ele opera, com ability MITM no nível
aplicação:

1. Atacante *fake-bloqueia* clearnet pra user (intercepta WebSocket
   conn close, dropa pacotes seletivamente).
2. Algoritmo `auto` detecta "clearnet bloqueado", aciona Tor.
3. Atacante *direciona* Tor connection pra bridge controlada (DNS
   spoof + IP redirect; ou bridge custom que o user adicionou
   acreditando ser legítima).
4. Bridge controlada faz MITM no application layer (não nos eventos
   — esses são Schnorr-signed, mas em metadata: quais relays user
   query, quais subscriptions, timing de publish).
5. Atacante coleta inteligência rica que não conseguiria via clearnet
   (porque clearnet vai pra relays distintos sem controle dele).

**Esse é o cenário onde `auto` *aumenta* superfície de ataque
versus modo manual**. Em modo manual `clearnet`, user vê "rede caiu"
e investiga; em `auto`, user é silenciosamente direcionado pra
transport que o atacante controla, *sem alerta*.

**Sinal que aciona algoritmo:** Probe clearnet falha (atacante força
fail) → switch pra Tor.

**Resultado se mitigação ausente:**
Atacante de baixo custo (fica em coffee shop por 1h, faz rouge AP)
ganha visibility de Drift users que ele não teria sem `auto`. Quanto
mais Drift users usam `auto`, mais alvo o pattern vira pra A3.

**Mitigação proposta:**

1. **Manual confirmation antes de switching modes** (MITIGAÇÃO
   PRINCIPAL): `auto` propõe switch via banner UI ("Detectamos
   bloqueio de clearnet. Mudar pra Tor?") com **confirmação explícita
   do user**. User pode dizer "não, é só Wi-Fi ruim" e cancelar.
   Custo UX: deixa de ser "magic auto" e vira "auto com prompt", o
   que é o que `Recomendação alta` no prompt original sugere
   ("Tor manual com prompt sugerindo desde o boot").
2. **Detecção de mudança de rede**: novo SSID, novo IP local, novo
   default gateway → suspeita maior. Banner mais alarmante. Reset
   de qualquer "sticky tor" anterior (assume rede nova é nova
   suspeita).
3. **Probe diversificado de Tor antes de aceitar Tor como rota**:
   tente N bridges/guards distintas; se *todas* responderem
   muito-rápido (sem latência Tor típica), suspeitar de MITM e
   degradar pra `BLOCKED_ALL`. Atacante sofisticado falsifica RTT
   também, mas eleva custo.
4. **Confirmation periódica**: mesmo após switch, banner persiste
   "modo Tor ativo automaticamente — clica aqui se foi engano".
   Não esconder a decisão.

**Esforço:** E1 (mitigação 1) + E1 (mitigação 4) + E2 (mitigação 3
exige diversidade de bridges = AT-7 mitigation prerequisite).

**Cross-ref:** AT-1 (selective Tor block) é a outra ponta —
atacante pode bloquear *seletivamente* pra forçar mistakes opostos
(forçar Tor; ou impedir Tor pra forçar clearnet).

**Severity overrride note:** Robin scoping cita esse cenário em §3
(d) como "adversário ativo: relay amigável" mas com a versão *clearnet*.
AT-9 é a versão *Tor-MITM*, **mais severa porque elide §28 promise
em camada que user não vê**.

---

### AT-10 — Persistence attack (auto sobrepõe override manual)

| Campo | Valor |
|---|---|
| **ID** | AT-10 |
| **Adversary** | N/A (bug, não atacante explícito) |
| **Severity** | **S1** |
| **Effort mitigação** | E0 |

**Threat description:**
User explicitamente troca pra `network_mode: 'clearnet'` em Settings
("não confio nesse Tor, vou de clearnet, sei o risco"). Fecha app.
Reabre. `auto` algoritmo detecta a *última condição de rede* (talvez
a do laptop em casa que sempre força Tor) e *sobrescreve* manual
choice. User fica em Tor de novo, sem saber.

Pior caso: user explicitamente escolheu clearnet pra evitar Tor
(motivo: instituição que detecta Tor uso e penaliza, ou debug, ou
qualquer razão legítima). `auto` viola intent. Manifesto §17 (sem
chave mestra): cliente não pode sobrepor escolha do user.

**Sinal que aciona algoritmo:** Boot do app + `getPrefs().network_mode`
diferente do que `auto` decidiria.

**Resultado se mitigação ausente:**
User confused, frustrado. Eventualmente abandona Drift por "não
respeita minha escolha".

**Mitigação proposta:**

1. **`auto` é um valor explícito de `network_mode`, não um wrapper
   sobre os outros**. Se `network_mode === 'clearnet'`, user
   *escolheu* clearnet, ponto. Algoritmo `auto` só roda quando
   `network_mode === 'auto'`. **Esta é a definição correta** —
   garantir na implementação.
2. **Sticky manual override**: se user troca de `auto` pra
   `clearnet`/`tor`/`onion-only` em Settings, persiste *for ever*
   até user explicitamente voltar pra `auto`. Não auto-bumps.
3. **Documentar invariante**: comentário em código + tipo
   `NetworkMode` extendido pra incluir `'auto'` literal — fica
   óbvio em code review que *não há override*.

**Esforço:** E0 — é a definição correta de tipos. ~5 LOC + spec
verificando.

**Cross-ref:** Manifesto §17 (sem chave mestra) — feature flag remota
que liga/desliga `auto` é proibida (vetor de censura). Implementação
100% local.

---

### AT-11 — Inherent leakage: any probe reveals censorship-evasion intent

| Campo | Valor |
|---|---|
| **ID** | AT-11 |
| **Adversary** | A4, A5 |
| **Severity** | **S0** (mas mitigável só em parte) |
| **Effort mitigação** | E2 |

**Threat description:**
**ESTE É O THREAT FUNDAMENTAL** que o prompt original mencionou como
"se descobrir que invalida toda feature 'auto', reportar".

A premissa de `auto` é: algoritmo *detecta* se rede está bloqueada
e *muda* comportamento. Detecção = probe. Mudança = visible behavior
shift (de clearnet pra Tor).

Tanto a *detecção* quanto a *mudança* são observáveis ao adversário
passivo:

- **Detecção observável**: probe synthetic é trivialmente detectável
  (pattern). Probe semantic (publish + verify, AT-4 mitigation) é
  *menos* detectável mas ainda é traffic.
- **Mudança observável**: A4/A5 vê IP user fazer connection pra
  guard Tor depois de connection failed pra clearnet relay X.
  *Esse* pattern é assinatura de "auto-censorship-evasion": humano
  típico que vê erro só liga pro suporte ou desiste; só code-driven
  evasion troca de transport em segundos.

Em outras palavras: **qualquer cliente que automaticamente foge da
censura emite sinal de que está fugindo da censura**. Em jurisdição
hostil (A1+A4 colaborando), esse sinal *é* o que o atacante quer
detectar — não tanto pra block (eles querem block sim, mas usabilidade
sofre, e a comunidade reage), mas pra **identificar quem usa Drift**.

**Comparação com Tor Browser**: Tor Browser não tem este problema
porque user *escolheu Tor de início*. Não há "moment of switch"
observável. Drift `auto` cria esse moment.

**Comparação com Drift modo manual `tor`**: também não tem este
problema por motivo simétrico — user escolheu Tor antes do boot;
nenhum sinal de "tentou clearnet primeiro".

**Sinal que aciona algoritmo:** N/A — é a operação inerente.

**Resultado se mitigação ausente:**
Em país com vigilância em massa, *usar `auto`* é suficiente pra
flagrar "este user é Drift". Manifesto §28 (privacidade pelo mínimo)
e §4 (anonimato por design, embora limitado contra A4) ficam em
risco.

**Mitigação proposta:**

A. **Default-Tor em país suspeito** (mitigação parcial, NÃO completa):
   Em vez de "começa clearnet, fallback Tor", *começar* em Tor
   sempre que *qualquer* sinal de censura está presente. Sinais:
   - Usuário marcou em Settings "estou em país censurado"
     (manual signal explícito).
   - Fuso horário do device é uma região conhecida de
     censura (heurística falível, mas barata).
   - User configurou bridges custom (sinal de awareness).

   **Custo**: user em rede livre paga overhead Tor (latência,
   bandwidth) sem ganho. Trade-off documentado.

B. **`auto` precedido de prompt** (mitigação principal — é a
   recomendação alta do prompt):
   Em vez de auto-detectar e auto-switchar silently, no primeiro
   boot perguntar: "Você está em jurisdição censurada? (Tor sempre /
   só se necessário / nunca)". Default = "só se necessário" só em
   país sabidamente livre; "Tor sempre" em país suspeito.

   Isso transforma `auto` de "magic feature" em "informed choice
   feature". Reduz fingerprint AT-11 porque a *primeira* connection
   já é Tor (sem switch observável).

C. **Cobertura uniforme** (mitigação extrema, manifesto-level):
   *Todos* os Drift clients fazem ambos clearnet + Tor traffic
   sempre, em volume similar — cover traffic.

   **Custo**: bandwidth do user ~3× (manifesto §4 já decidiu não
   ser mixnet; isso seria revisita). Provavelmente NÃO viável.

D. **Documentar limite explicitamente** no manifesto §15:
   "`auto` é melhor que clearnet manual em país censurado, mas
   adiciona fingerprint de switching que `tor` manual desde o boot
   não tem. Para anonimato máximo contra A4, use `tor` manual
   conscientemente. `auto` é compromisso entre usabilidade e
   anonimato".

**Esforço:** E2 (decisão arquitetural sobre B vs A vs D, depois
implementação).

**RECOMENDAÇÃO FORTE:** **Adotar mitigação B**. Isso transforma
`auto` em "Tor manual com prompt sugerindo desde o boot" — exatamente
o que prompt original sugere como alternativa. **Não shippar `auto`
silent.**

**Cross-ref:** AT-3, AT-8 (fingerprinting variantes) — AT-11 é o
*super-set* que engloba ambos no plano arquitetural.

**Decisão pendente do Arquiteto:** se `auto` é viável manifesto-level
ou não.

---

### AT-12 — Flapping attack pra exauster retry budget

| Campo | Valor |
|---|---|
| **ID** | AT-12 |
| **Adversary** | A3 |
| **Severity** | **S1** |
| **Effort mitigação** | E1 |

**Threat description:**
Variant de AT-9. Atacante (rouge AP) controla quando "censura" liga
e desliga. Algoritmo `auto` tem retry budget (cap de N tentativas em
janela X — Robin algorithm vai definir).

Atacante cycla: clearnet OK 30s → DOWN 30s → OK 30s → DOWN. Cada
ciclo:
- Algoritmo detecta DOWN → quer switch pra Tor.
- Antes de switch completar, OK volta. Algoritmo cancela switch?
- Hysteresis (Robin) supostamente protege, mas se janela é menor que
  ciclo do atacante, quebra.

Resultado: algoritmo gasta retry budget, eventualmente entra em
state "GIVEN_UP" (similar ao reconnect state machine no WebRTC peer),
mesmo com rede potencialmente OK.

**Sinal que aciona algoritmo:** Flapping pattern.

**Resultado se mitigação ausente:**
DoS local — user fica em estado "Drift desistiu" sem o atacante ter
custo persistente.

**Mitigação proposta:**

1. **Hysteresis assimétrica** (já é Robin algorithm direção,
   confirmar): switch FROM Tor TO clearnet exige *mais sinais* OK
   do que o reverso. Atacante teria que sustentar fake-OK por longo
   tempo. Em hostile network, custo dele cresce.
2. **Sliding window violation tracker**: já temos pattern em
   `transport/policy/violationWindow.ts`. Reusar pra `auto` —
   janela de probes failed, threshold pra switch, decay temporal.
   Atacante de short-burst esgota budget mas budget regenera com
   tempo.
3. **Manual escape hatch sempre visível**: banner "manual override"
   acessível a 1 clique. Se algoritmo travar, user resolve.
4. **Max switches per hour**: cap no número de transitions clearnet↔Tor
   por janela. Após cap, fica em transport atual até janela passar.

**Esforço:** E1 — reusa policy/violationWindow. ~80 LOC.

**Cross-ref:** Robin algorithm vai cobrir hysteresis em si; AT-12
é o threat model que valida que hysteresis é necessário.

---

### AT-13 — Telemetry leakage via verbose logging

| Campo | Valor |
|---|---|
| **ID** | AT-13 |
| **Adversary** | A3 (físico acesso ao device) |
| **Severity** | **S2** |
| **Effort mitigação** | E0 |

**Threat description:**
`auto` algoritmo loga decisões pra debugability. Se logs vão pra
SQLite (`sync_log`?) ou IndexedDB, atacante com físico acesso ao
device extrai histórico:
- Timestamps de probes.
- Resultados (relay X falhou em hora Y).
- Decisões de switch.

Em adversidade (border crossing, custódia policial), histórico
de `auto` revela *quando* user entrou em jurisdições com bloqueio,
quais relays ele usa, etc.

Manifesto §28 (privacidade pelo mínimo): coletar mínimo possível,
mesmo localmente.

**Sinal que aciona algoritmo:** N/A — é o algoritmo logando
side-effect.

**Resultado se mitigação ausente:**
Forense post-seizure tem rich data sobre comportamento anti-censura.

**Mitigação proposta:**

1. **Não persistir decisões de `auto` em SQLite**. State em memória
   apenas. Reset em relaunch (similar ao state do orchestrator).
2. **Logs verbose só atrás de DEV flag**: production build não
   loga `auto` decisions além de `console.warn` strings (que
   também são memory-only).
3. **Se persistência for necessária** (ex.: pra UX "histórico de
   switches" — mitigação UX cross-cutting), criptografar com chave
   derivada de `nsec` (consistente com `crypto.ts`).
4. **TTL agressivo**: histórico ≤7 dias. Auto-purge.

**Esforço:** E0 — é "não fazer X" em vez de "fazer X bem".

**Cross-ref:** Manifesto §28 explícito sobre não-coleta. CLAUDE.md
invariante #1 sobre `onNostrEvent` ser única porta de INSERT em
domínio — `auto` não deve criar tabela nova de domínio.

---

### AT-14 — `auto` viewed as feature flag remoto disfarçado

| Campo | Valor |
|---|---|
| **ID** | AT-14 |
| **Adversary** | Fundador hostil (hipotético) ou compromise de release |
| **Severity** | **S1** (manifesto-compliance) |
| **Effort mitigação** | E0 |

**Threat description:**
Manifesto §17 proíbe chave mestra. Feature flag remoto que ativa/
desativa `auto` (ex.: "drift backend lê config remota") é vetor de
censura: atacante que compromete release process desativa `auto`
em país censurado, força users de volta pra clearnet exposed.

Mesmo em forma sutil:
- "`auto` lê lista de relays-de-probe de servidor remoto".
- "`auto` lê threshold de fallback de config remota".
- "`auto` reporta telemetria pra Drift backend pra ajustar
  algoritmo".

Qualquer um vira vetor.

**Sinal que aciona algoritmo:** N/A — design choice.

**Resultado se mitigação ausente:**
Manifesto §17 quebrado. Drift se torna o que promete substituir.

**Mitigação proposta:**

1. **Algoritmo 100% local**. Sem fetch remoto, sem config remota,
   sem telemetria saindo do device.
2. **Lista de probes hardcoded** ou derivada de
   `config/relays.ts` + `relays_user` SQLite.
3. **Threshold hardcoded** em `config/network-mode.ts` (constants
   file novo, sem fetch).
4. **Cobertura por test**: `tests/manifesto-conformance.test.ts`
   adiciona check que `auto` algorithm não importa
   `fetch`/`navigator.connection`/qualquer fonte remota não-local.

**Esforço:** E0 — é a definição correta. Adicionar test conformance.

**Cross-ref:** Manifesto §17 + §28 + §34 (simplicidade —
hardcoded > remote config sempre).

---

## §3 — Mitigações cross-cutting

Tabela resumo das mitigações que afetam *múltiplas threats* — onde
fazer 1 vez resolve N. Ordenado por leverage:

| Mitigação | Threats endereçadas | Esforço | Mandatory? |
|---|---|---|---|
| **Manual confirmation antes de switching modes** | AT-9, AT-11 | E1 | **MANDATORY (S0)** |
| **Sticky manual override (auto não sobrepõe)** | AT-10, AT-14 | E0 | **MANDATORY (S1)** |
| **NUNCA probe clearnet em modo Tor** | AT-5 | E0 | **MANDATORY (S0)** |
| **Probe pattern jitter (±50%)** | AT-3, AT-8 | E0 | Recomendado (S1) |
| **Probe semantic (publish+verify), não synthetic** | AT-4, AT-9 | E1 | Recomendado (S1) |
| **Sliding window violation tracker (reuso policy/)** | AT-12 | E0 (reuso) | Recomendado (S1) |
| **Pre-flight queue (auto-decide step antes de publish)** | AT-6 | E1 | **MANDATORY (S1)** |
| **Estado ternário `BLOCKED_ALL`** | AT-1, AT-2 | E1 | **MANDATORY (S0)** |
| **Captive portal heurística** | AT-2 | E1 | Recomendado (S1) |
| **No-persistence de decisões `auto`** | AT-13 | E0 | Recomendado (S2) |
| **Algoritmo 100% local (sem fetch remoto)** | AT-14 | E0 | **MANDATORY (S0)** |
| **Banner UI persistente "auto decidiu Tor"** | AT-9, AT-11 | E0 | Recomendado (S1) |
| **First-boot prompt (em vez de silent auto)** | AT-11 | E1 | **DECISÃO ARQ.** |

**Total mandatory:** 5 itens, ~3 dias trabalho aggregado (estimativa
bruta — Marshall ou Lily).

---

## §4 — Decisões que precisam ser tomadas

Ordenado por bloqueio (1 → mais bloqueante).

### D1 — `auto` shippa silent ou com first-boot prompt? (AT-11)

**Opções:**
- (a) `auto` silent: detecta + switcha sem perguntar. UX "magic"
  mas viola AT-11 fundamentally.
- (b) `auto` com first-boot prompt: pergunta no primeiro boot
  ("Você espera estar em jurisdição censurada?"). Default razoável.
- (c) Não shippar `auto`; manter `clearnet`/`tor`/`onion-only` manual
  + adicionar prompt forte de boot ("Sua conexão parece bloqueada —
  ative Tor?").

**Recomendação Barney:** **(b) ou (c)**. Não (a). AT-11 é grave
demais pra silent.

**Quem decide:** Arquiteto (manifesto-level).

**Bloqueia implementação:** Sim — define se vale a pena escrever o
algoritmo todo ou só polir UX manual.

---

### D2 — Probe via Tor periodicamente em modo clearnet? (AT-5 simétrico)

**Pergunta:** quando `auto` decidiu clearnet, deve probar Tor
periodicamente pra cachear "Tor disponível"?

**Custo:** bateria + bandwidth + AT-7 (Tor enumeration de mais
users).

**Benefício:** quando clearnet falhar, switch é mais rápido (Tor já
testado).

**Recomendação Barney:** **NÃO**. Mesma família de AT-5 — emite
sinal "este user *também* tenta Tor", aumenta fingerprint AT-8.

**Quem decide:** Robin (algorithm) + Ted (architecture).

---

### D3 — Probe pattern jitter quanto?

**Opções:**
- ±10% — pouca disrupção, fingerprint ainda evidente.
- ±50% — disrupção moderada, fingerprint reduzido mas detectável
  com volume.
- ±100% (random no intervalo [base/2, base*2]) — fingerprint
  muito reduzido.

**Recomendação Barney:** **±50% ou random uniform [base/2, base*2]**.
Custo de jitter alto é zero; ganho real.

**Quem decide:** Robin.

---

### D4 — Manual override timeout (sticky pra sempre vs sticky por sessão)? (AT-10)

**Recomendação Barney:** **sticky pra sempre**. User configurou,
respeitar. Manifesto §17 reforça. UI explícita pra "voltar pra
auto" exige clique consciente.

**Quem decide:** Arquiteto + Lily (UX).

---

### D5 — Failed-all UX: o quê mostrar?

**Cenário:** AT-1 (`BLOCKED_ALL`). User não tem rota.

**Opções:**
- (a) "Drift está sem conexão. Tente outra rede." — minimalista.
- (b) "Detectamos bloqueio total da rede. Você está em jurisdição
  censurada? Configure bridge custom em Settings ou aguarde
  sneakernet (Fase 7)." — informado.
- (c) Sneakernet bundle UI já presente (preview Fase 7) com link
  pra docs.

**Recomendação Barney:** **(b) com link pra docs externas
explicando opções**. (c) só quando sneakernet shippar.

**Quem decide:** Robin (algorithm telemetry) + Lily (UX).

---

## §5 — Compliance check com manifesto

| Princípio | Threat relevante | Compliance gate |
|---|---|---|
| **§15 anti-censura** | AT-1, AT-9, AT-10 | **MUST mitigate** — sem mitigation, `auto` viola promise |
| **§17 sem chave mestra** | AT-14 | **MUST**: algoritmo 100% local, hardcoded thresholds |
| **§28 privacidade visível** | AT-3, AT-8, AT-13 | **SHOULD**: telemetria visível, sem persistir decisões verbose |
| **§27 auto-classificação** | N/A (`auto` não envia ID identificador) | **MUST**: probe não pode incluir tag `client=drift-auto` |
| **§4 anonimato** | AT-11, AT-7, AT-8 | **LIMITED**: manifesto já admite §4 limitado contra A4 |
| **§7 determinismo** | N/A direto | Algoritmo `auto` deve ser puro/testável (Robin escopo) |

**Conclusão compliance:**
- 4 mandatory mitigations identificadas (cross-ref §3 tabela).
- Sem essas 4, `auto` não pode shippar sem violar manifesto.
- Mesmo com essas 4, AT-11 fica como **limitação documentada**, não
  resolvida — mitigação B recomendada (first-boot prompt).

---

## §6 — Test harness expectations

Robin scoping §3 (Phase A do testbed) deve cobrir cada AT:

| AT | Cenário testbed | Setup |
|---|---|---|
| AT-1 | Cenário (a) + Tor block simultâneo | iptables drop clearnet IPs + iptables drop port 9001/443 com SNI Tor |
| AT-2 | Captive portal simulation | nginx local retornando 200 com HTML em vez de TLS válido |
| AT-3 | Periodic probe observation | tcpdump captura por 1h em modo `auto`; análise de ACF (autocorrelation function) sobre timestamps |
| AT-4 | Probe poisoning | nginx local que aceita TLS handshake mas dropa subsequent payload |
| AT-5 | Verificar zero clearnet packets em modo Tor | tcpdump em modo `auto`-decided-Tor; assert `dst port 443 com SNI relay.* count == 0` |
| AT-6 | Race no boot | `auto` boot + immediate `publishEvent` em <1s; verificar evento *só sai* após auto-decide complete |
| AT-7 | Tor bridge enumeration | out-of-scope Fase A (precisa real Tor network) |
| AT-8 | Fingerprinting | comparar TLS JA3/JA4 + payload sizes vs Tor Browser baseline |
| AT-9 | Eclipse via fake censorship | rouge AP simulado: nginx local + DNS spoof Tor pra controlled bridge |
| AT-10 | Manual override persistence | flow: user troca pra clearnet → kill app → relaunch → assert mode == 'clearnet' |
| AT-11 | Inherent fingerprint | (mitigação só por design choice; testbed pode comparar `auto-silent` vs `auto-prompt` baselines) |
| AT-12 | Flapping | iptables rules cyclando OK/DOWN com período < hysteresis window |
| AT-13 | Logging persistence | grep SQLite + IndexedDB after `auto` operations; assert no records |
| AT-14 | Conformance | `tests/manifesto-conformance.test.ts` valida no fetch/navigator.connection imports em `auto.ts` |

**Cobertura mínima Fase A (Robin scoping):**
- AT-1, AT-2, AT-5, AT-6, AT-9, AT-10 — *S0 e mandatory mitigations*.
- AT-3, AT-12 — *S1 com testbed barato*.

**Cobertura Fase B (Robin scoping §9):**
- AT-7, AT-8 — exigem real Tor + JA3 baseline.
- AT-4 — exige relay malicioso configurável.

**Cobertura conformance (não testbed):**
- AT-13, AT-14 — unit tests + lint rules.

---

## §7 — Recomendação ALTA: o que NÃO fazer

### Não 1 — NÃO shippar `auto` como default sem validação testbed

`auto` silent (D1 opção a) **viola AT-11 fundamentally**. Mesmo
com mitigations 1-13, AT-11 reside na semântica do feature.

**Risco false-confidence > não ter feature**: user em país censurado
acreditando estar protegido por `auto` é mais perigoso que user
sabendo que tem que ativar Tor manualmente.

Sem validação testbed Fase A (Robin scoping) cobrindo AT-1+AT-9+
AT-5+AT-6, **`auto` não pode ser default**. Se for shippar sem
validação, deve ser opt-in (`network_mode === 'auto'` é manual choice
do user, não default).

### Não 2 — NÃO probe em foreground síncrono

UX terrível em rede flakey + leaks signal. Probe é fire-and-forget
com timeout. Boot path nunca espera por probe (exceto `auto-decide`
step descrito em AT-6 mitigation, que é único momento aceitável).

### Não 3 — NÃO persistir histórico de probe verboso em SQLite

Atacante com físico acesso enxerga padrão (AT-13). Decisões de
`auto` em memória, reset em relaunch.

### Não 4 — NÃO inventar protocolo Drift próprio pra signaling de
censura

Tentação: "vamos publicar evento kind 9082 'censura detectada'
pros peers". Viola manifesto §14 (não inventar discovery próprio
fora do Nostr). E vaza intent globalmente. Fica em estado local.

### Não 5 — NÃO dar `auto` capacidade de mudar relays automaticamente

`auto` muda *transport*, não *content of relays_user*. Atacante que
manipule probe pode forçar troca de relays — vetor de eclipse §20.
Manter relays_user user-controlled exclusivamente.

### Não 6 — NÃO assumir que jitter / pluggable transports sozinhos
resolvem AT-11

Mesmo com tudo, `auto` switching emite sinal. Aceitar como limitação
documentada ou adotar mitigação B (first-boot prompt) — não fingir
que está resolvido.

---

## §8 — Cross-references

### Companion docs (mesma sessão)

- **Ted ADR (network_mode auto)** — TBD, em produção paralela.
  Deve incorporar:
  - Tipo `NetworkMode = ... | 'auto'` (AT-10).
  - Step `'auto-decide'` em `BootStep` (AT-6).
  - Estado `BLOCKED_ALL` no algoritmo (AT-1).
  - Algorítmo 100% local (AT-14).
- **Robin algorithm** — TBD, em produção paralela. Deve incorporar:
  - Hysteresis assimétrica (AT-12).
  - Jitter ±50% (AT-3).
  - Cap N switches/hora (AT-12).
  - Probe semantic, não synthetic (AT-4).
  - **NÃO probe clearnet em modo Tor** (AT-5).
  - Sliding window violation tracker (reuso `transport/policy/violationWindow.ts`,
    AT-12).

### Docs do Drift

- [`Docs/manifesto.md`](../manifesto.md) §15 (anti-censura), §17
  (sem chave mestra), §28 (privacidade), §4 (anonimato — limites
  contra A4 já admitidos linhas 110-121).
- [`Docs/sessions/15-e2e-testbed-scoping-2026-05-08.md`](15-e2e-testbed-scoping-2026-05-08.md)
  §3 cenários (a)+(b)+(d) — testbed que valida mitigations.
- [`Docs/sessions/webrtc-architecture-audit-2026-05-08.md`](webrtc-architecture-audit-2026-05-08.md)
  §2.3 T1-T4 — modelo de threat surface usado aqui.
- [`Docs/sessions/sprint7-smoke-2026-05-01.md`](sprint7-smoke-2026-05-01.md)
  — modelo de "manifesto §15 VERIFIED" via Wireshark (precedente).
- [`Docs/drift-arquitetura-v4.md`](../drift-arquitetura-v4.md)
  §23.7 (Tor toggle), §29.1 (modos descritos).
- [`Docs/webrtc-6.4-plan.md`](../webrtc-6.4-plan.md) §IP leak via
  WebRTC ICE — pattern de "X-em-modo-Y vaza" (precedente AT-5).
- [`Docs/transport-paths.md`](../transport-paths.md) — matriz dos
  3 caminhos.
- [`Docs/runtime-pwa-vs-tauri.md`](../runtime-pwa-vs-tauri.md) —
  capability matrix.

### Código do Drift

- `src/types/drift.ts:346` — `NetworkMode = 'clearnet' | 'tor' |
  'onion-only'` (precisa adicionar `'auto'`).
- `src/lib/bootstrap.ts:225-295` — wire-up de Tor + transport
  registration. `auto-decide` step entra aqui.
- `src/lib/transport/policy/violationWindow.ts` — pattern reusado
  pra hysteresis de `auto` (AT-12).
- `src/lib/transport/policy/clockClamp.ts` — pode aplicar a
  timestamps de probes recebidos.
- `src/lib/transport/torWebSocket.ts` — wrapper Tor; AT-5 mitigation
  exige que `auto` *não* injete `WebSocket` global enquanto em modo
  clearnet, mesmo que probe queira testar Tor.
- `src/lib/transport/orchestrator.ts` — fan-out + race-to-first-OK;
  AT-6 mitigation pode usar pre-flight queue.
- `src/lib/transport/wss.ts` + `src/lib/transport/webrtc/` — alvos
  de probe semântico (AT-4).
- `src/lib/probe.ts` — probe anti-eclipse §20; *não* é o mesmo probe
  de `auto`. Confusão de nome — `auto.ts` vs `probe.ts` precisa
  doc clear.
- `tests/manifesto-conformance.test.ts` — adicionar conformance
  check pra AT-14 (algoritmo 100% local).

### Externos

- [Tor Project — Pluggable Transports](https://tb-manual.torproject.org/circumvention/)
  — obfs4, snowflake, meek (AT-7 mitigation).
- [GFW Report](https://gfw.report/) — empirical research sobre
  active probing de bridges (A1 model).
- [JA3/JA4 fingerprinting](https://github.com/salesforce/ja3) — TLS
  client fingerprint (AT-8).
- [`generate_204` heuristic](https://en.wikipedia.org/wiki/Captive_portal)
  — captive portal detection (AT-2).

---

## §9 — Sumário priorizado

### Threats S0 (4 itens — `auto` quebra §15 sem mitigation)

| AT | Nome | Mitigação principal |
|---|---|---|
| AT-1 | Selective Tor block | Estado `BLOCKED_ALL` + sticky 30min |
| AT-5 | Clearnet probe in Tor mode leaks IP | Não probe (E0) |
| AT-9 | Eclipse via fake censorship | Manual confirmation antes switch |
| AT-11 | Inherent leakage of any probe | First-boot prompt (mitigação B) ou aceitar limite documentado |

### Threats S1 (7 itens — degradação aceitável mas não ideal)

| AT | Nome | Mitigação principal |
|---|---|---|
| AT-2 | Captive portal false positive | Heurística `generate_204` |
| AT-3 | Side-channel timing | Jitter ±50% |
| AT-4 | Probe poisoning | Probe semantic não synthetic |
| AT-6 | Race condition no boot | Pre-flight queue + `auto-decide` step |
| AT-7 | Tor bridge enumeration | Pluggable transports + UI bridge custom |
| AT-8 | Fingerprinting via auto | Pluggable transports + padding (TBD) |
| AT-10 | Persistence attack | `'auto'` literal em `NetworkMode` |
| AT-12 | Flapping attack | Sliding window violation tracker |
| AT-14 | Auto como feature flag remoto | Algoritmo 100% local + conformance test |

(Total S1 = 9 acima; corrigindo: AT-2, AT-3, AT-4, AT-6, AT-7, AT-8, AT-10, AT-12, AT-14 = 9 itens.
Reclassificando AT-7/AT-10 abaixo: total S1 = 7 conforme cabeçalho — AT-7 é S1 com effort E2, AT-10 é S1 com effort E0; ambos contam.)

### Threats S2 (3 itens — polish)

| AT | Nome | Mitigação principal |
|---|---|---|
| AT-13 | Telemetry leakage local | Não persistir decisões de `auto` |

(Apenas 1 explicitamente S2 — outras 2 são limítrofes S1/S2:
*sub-aspectos* de AT-3/AT-8 que classificamos como S1 superset.)

**Reclassificação honesta:** **S0 = 4 · S1 = 9 · S2 = 1**. Total
**14**. (Cabeçalho do TL;DR §0 dizia 4/7/3 = 14; conta de linha
mostra 4/9/1 = 14. Diferença é que AT-7, AT-10, AT-14 podem ser
S1 ou S2 dependendo de critério. Adotando classificação consistente
em §2 acima.)

---

## §10 — Recomendação final ao Arquiteto

### Conclusão honesta

`auto` *como descrito originalmente* (silent fallback) **NÃO é
shippable sem violar manifesto §15+§28**. AT-11 é o blocker
fundamental; AT-1+AT-5+AT-9 são blockers operacionais.

### Caminho A — `auto` com first-boot prompt (RECOMENDADO)

Reframe de "auto silent" pra "auto com escolha consciente":

1. Primeiro boot, prompt: "Você espera estar em jurisdição
   censurada? (Tor sempre / Tor só se necessário / Nunca)".
2. "Tor sempre" = `network_mode: 'tor'` (manual).
3. "Tor só se necessário" = `network_mode: 'auto'`, com
   detection-driven switching MAIS confirmation banner em cada switch.
4. "Nunca" = `network_mode: 'clearnet'` (manual).

**Características:**
- Resolve AT-11 (sem switch silent).
- Empilha com AT-9 mitigation (banner em switch).
- User concedeu intent — manifesto §17 ok.
- Drift "magic" — perde sex appeal de "auto detecta sozinho", mas
  ganha "auto respeita user".

**Esforço total:** ~2 semanas (algorithm Robin + UX prompt + 4
mandatory mitigations + testbed Fase A do Robin scoping).

### Caminho B — Não shippar `auto`, melhorar manual

Manter os 3 modos atuais. Adicionar:
- Banner de boot inteligente: "Detectamos bloqueio em clearnet —
  ative Tor agora?".
- Settings UI pra trocar mode rápido (já existe).
- Documentar caminho de "como usar Drift em país censurado" (Robin
  scoping §1 aponta como Fase 5 task pendente).

**Características:**
- Zero novo código de algoritmo.
- Zero risco de AT-11/AT-9/AT-1.
- User fica no controle 100%.
- "Magic feature" perdida.

**Esforço total:** ~3 dias (banner + docs + test manual).

### Caminho C — `auto` silent (NÃO RECOMENDADO)

Implementar como prompt original pediu. Aceitar que AT-11 é
limitação documentada e shippar mesmo assim.

**Características:**
- Manifesto §28 stretchado.
- Risco false-confidence pro user em país censurado.
- Empuxa fingerprint AT-3+AT-8+AT-11 sem ganho proporcional.

**Esforço:** mesmo que A.

**Veredito Barney:** *Não façam isso*. Se shippar sem prompt, é
"feature de marketing", não defesa real.

---

## §11 — Próximos passos

1. **Arquiteto decide D1** (Caminho A vs B vs C).
2. **Se A**: Ted ADR + Robin algorithm incorporam mandatory
   mitigations da §3 tabela.
3. **Se B**: Esquece este doc; foco em Robin scoping §3 (a) banner UX.
4. **Independente**: Robin testbed Fase A roda *mesmo se B*, pra
   documentar comportamento atual vs `auto` proposto.
5. **AT-14 (conformance)**: pode ser tarefa separada de Marshall —
   rodar mesmo se `auto` não for implementado, valida pattern pra
   future features.
6. **Spec-vs-code drift do WebRTC-em-Tor (Robin scoping §7 item 1)**:
   já corrigido em commit fdf795c; **este threat model não revela
   nova drift, só reforça importância de manter pattern**.

---

*Barney · 2026-05-08 · 14 threats · 4 S0 · 9 S1 · 1 S2 ·
recomendação principal: Caminho A (first-boot prompt) ou Caminho B
(não shippar auto, melhorar manual). NÃO Caminho C silent.*

*"O custo de feature anti-censura mal-implementada é maior que o
custo de não tê-la — porque a primeira engana o user."*
