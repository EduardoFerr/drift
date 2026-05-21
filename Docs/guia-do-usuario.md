# Guia do Usuário — entendendo o que acontece em cada ação

> Esse guia é pra você que usa o Drift, não pra quem programa.
> Aqui você entende **exatamente o que acontece** quando aperta um
> botão, faz um swipe, ou muda uma configuração. Sem mistério, sem
> "magia do algoritmo". Tudo tem causa e efeito previsíveis — e é
> deliberado, está no nosso manifesto público.

---

## 30 segundos pra entender o Drift

Drift é uma rede social sem servidor central, sem feed personalizado, e
sem alguém que pode te apagar. Os posts vivem em **relays Nostr**
(servidores comuns que retransmitem eventos) e seu cliente baixa o que
te interessa.

**O que torna o Drift diferente:**

- 🔑 Sua identidade é uma **chave criptográfica** (`nsec1…`) gerada no
  seu dispositivo. Sem email, sem telefone, sem cadastro.
- 📊 O score que ordena o feed é uma **fórmula pública**. Todos os
  clientes Drift no mundo veem o feed **na mesma ordem** (a menos que
  você ligue a "Lente" — explicado abaixo).
- 🚫 Não existe "moderador supremo". Conteúdo problemático é escondido
  pela **comunidade via denúncias** — nem o criador do Drift consegue
  apagar um post.
- 📡 Você controla **quais relays** usar, quando publicar, quando
  parar. Pode levar sua identidade pra outro cliente Nostr a qualquer
  momento sem perder o histórico.

---

## Glossário — palavras estranhas no início

| Palavra | O que significa |
|---|---|
| **nsec1…** | Sua chave **privada**. É como a senha + sua identidade fundidas. Quem tem ela = é você. **Não compartilhe.** |
| **npub1…** | Sua chave **pública**. É como seu @ — outros podem te ver/seguir por ela. Compartilhar é seguro. |
| **DRIFT** (↑) | Espalhar um post — você diz "isso merece chegar em mais gente" |
| **SINK** (↓) | Afundar um post — você diz "não quero ver isso aqui" (sem punir o autor) |
| **DERIVA** | O número (score) que mostra quanto um post está subindo no feed |
| **subpost** | Várias mensagens dentro de uma POST (tipo carrossel) — você navega com ← → |
| **relay** | Servidor Nostr que retransmite eventos (posts, drifts, etc.) |
| **NIP-XX** | Padrões técnicos do Nostr (ex: NIP-02 = follows; NIP-65 = lista de relays) |

---

## Sua identidade — o que acontece quando você cria

**O que acontece no seu dispositivo:**

1. O cliente gera localmente uma **chave criptográfica secp256k1**
   (mesma tecnologia do Bitcoin) — formato `nsec1…` (privada) +
   `npub1…` (pública).
2. A `nsec` é **criptografada com AES-GCM 256** e guardada no IndexedDB
   do seu navegador.
3. Uma **master key não-exportável** (que vive no IndexedDB separada)
   é usada pra descriptografar a `nsec` quando você precisa assinar
   algo.

**O que NÃO acontece:**

- ❌ Sua `nsec` **NUNCA é enviada** para nenhum servidor, relay ou
  serviço.
- ❌ Não há "esqueci minha senha" — não existe servidor pra resetar.
- ❌ Nenhum cadastro com email/telefone. Drift não sabe quem você é.

**O que você precisa fazer:**

✅ **Backup do nsec.** Toque na lente "🔑 sua chave" e copie/baixe o
`nsec1…`. Guarde em **local seguro** (gerenciador de senha, USB
criptografado, escrito num papel guardado).

⚠️ **Sem backup, sem identidade.** Se perder o dispositivo sem ter o
`nsec1…` salvo: **perdeu a identidade pra sempre.** Nem o criador do
Drift recupera. É escolha consciente do projeto (manifesto §3 e §17).

✅ **Trocar de dispositivo é trivial.** Importe seu `nsec1…` num outro
device — todo o histórico volta dos relays automaticamente.

---

## Os 3 swipes — o que cada um faz

### ↑ DRIFT (swipe pra cima)

**O que acontece:**

1. Cliente assina e publica um **evento Nostr kind 9079** com seu
   `npub`, referenciando o post que você espalhou.
2. Esse evento vai pra **todos os relays que você configurou** (mínimo
   2 em paralelo).
3. **Localmente:** o contador "↑" do post sobe imediatamente (otimismo
   visual). Quando o evento volta pelos relays, o número fica
   "confirmado".
4. **Pros outros:** o `score` do post aumenta pra todo mundo que
   processar seu evento. Quanto subir? Depende do **seu peso** (ver
   "Como seu peso de identidade funciona" abaixo).

**Quem vê que VOCÊ espalhou:**

- Qualquer cliente Nostr/Drift que consultar os eventos do post
  consegue listar todos os spreaders por `npub`. **É público por
  design** — manifesto §6 (verdade por eventos).

**Pode desfazer?**

✅ **Sim.** Swipe ↓ (SINK) no mesmo post → você publica um evento
kind 9080. A regra **"última ação vale"** garante que só a ação mais
recente conta no score (manifesto §23 — mudança de opinião não pune
retroativamente).

⚠️ Mas o evento de SPREAD anterior **continua existindo** nos relays.
Quem fizer auditoria histórica vê que você mudou de opinião.

---

### ↓ SINK (swipe pra baixo)

**O que acontece:**

1. Cliente assina e publica um **evento Nostr kind 9080**.
2. **Localmente:** o post some do seu feed (não aparece mais no stack
   atual). Você não precisa ver de novo.
3. **Pros outros:** o `score` do post diminui, mas **proporcionalmente
   menos do que um SPREAD aumentaria** (peso 0.3× vs 1.0×). Bury é
   julgamento estético, não punição.
4. **O autor NÃO é penalizado.** Bury reduz o score do post, mas não
   afeta o `weight` do autor (manifesto §23). Você pode "afundar"
   alguém 1000 vezes sem prejudicar a reputação dele.

**Quem vê que VOCÊ afundou:**

- Idem ao SPREAD: público nos relays.

**Pode desfazer?**

✅ Sim — swipe ↑ no mesmo post. Última ação vale.

---

### ← → (swipe horizontal)

**O que acontece:**

- Você navega entre **subposts** dentro da mesma POST (tipo carrossel
  Instagram).
- **Não publica nenhum evento.** Navegação é totalmente local.
- **Ninguém sabe** que você passou pelos subposts ou quanto tempo
  ficou em cada.

---

## Quando você toca duas vezes na imagem (lightbox)

- **Não publica nenhum evento.** Tudo local.
- A imagem é carregada (priorizando IPFS local → URL HTTP →
  IPFS gateway) e verificada por hash SHA-256 quando o post tem
  metadados NIP-94.
- Se a imagem foi adulterada entre o post e o carregamento, o cliente
  mostra erro (defesa contra tampering).

---

## Quando você publica um post (➕)

**O que acontece:**

1. Você compõe até **N subposts** (texto e/ou imagem). Quantos? Depende
   do seu **peso de identidade**:

   | Seu peso | Subposts permitidos |
   |---:|---:|
   | < 20 | 1 |
   | < 40 | 2 |
   | < 55 | 4 |
   | < 70 | 6 |
   | < 85 | 7 |
   | ≥ 85 | 8 (máximo) |

   Identidade nova começa com 1 — defesa anti-spam mecânica (manifesto
   §33). Você ganha mais conforme acumula tempo + spreads recebidos.

2. Se você anexar imagem: ela é enviada pra `nostr.build` (ou outro
   endpoint que você configure em Settings) — **não fica no Drift**.
3. Cliente assina e publica um **evento Nostr kind 9078** com:
   - Os subposts (texto, URLs das imagens, layout escolhido)
   - Tag `drift-version` (identifica o cliente)
   - Tag `category` opcional
   - Tag `location` opcional (off por default — você só vaza
     localização se ligar explicitamente em Settings)
   - Tag `content-warning` opcional (`nsfw` | `violence` | `spoiler` |
     `ad` — você marca; o leitor escolhe se vê)
4. Publica em **todos os seus relays configurados** em paralelo.

**O que NÃO acontece:**

- ❌ **Nenhum scan automático** de conteúdo (manifesto §25). Sem
  PhotoDNA, sem classificador NSFW, sem ML local. O cliente Drift
  oficial **nunca** analisa o que você publica.
- ❌ Nenhuma cópia vai pra "servidor central do Drift" — não existe.

**Pode apagar?**

⚠️ **Não.** Posts são **imutáveis** (manifesto §10). É evento Nostr
kind 9078 assinado pela sua chave — uma vez nos relays, vive lá.

Você pode pedir aos seus relays pra esquecerem (NIP-09 deletion
event), mas:
- Outros relays podem ignorar o pedido
- Quem já baixou tem cópia no SQLite local
- Clientes alternativos podem exibir mesmo após "delete"

**Pense duas vezes antes de publicar.** Esse é o contrato — manifesto §10.

---

## Quando você segue alguém

**O que acontece:**

1. Botão "seguir" → cliente publica/atualiza um **evento Nostr kind 3**
   (NIP-02) com a lista completa de quem você segue.
2. Replaceable event: cada update **substitui** o anterior. Sempre vale
   a versão mais recente.
3. **É público.** Qualquer cliente Nostr lê sua lista de follows.

**Pra que serve:**

- Aba "Seguindo" do feed filtra posts dos seus follows
- Trust Lens (se ligada) usa seus follows pra calcular o grafo de
  influência local
- Outros clientes Nostr (Damus, Snort, Coracle) entendem essa lista —
  sua rede é portátil

**Pode desfazer?**

✅ Botão "deixar de seguir" publica novo kind 3 sem aquela pessoa. A
versão anterior (com a pessoa) **continua existindo nos relays** mas é
ignorada (replaceable LWW).

---

## Quando você silencia ou bloqueia alguém

**Diferença:**

- **Silenciar (mute):** posts dessa pessoa somem do **seu** feed. Você
  não vê mais. **Local-only** — manifesto §24.
- **Bloquear (block):** mais agressivo — esconde posts E interações
  (replies, drifts, etc.) dessa pessoa do **seu** feed.

**O que acontece:**

- Nenhum evento Nostr é publicado.
- A regra fica gravada apenas no **SQLite local** do seu dispositivo.
- A pessoa **NÃO sabe** que você silenciou/bloqueou (sem notificação).
- **Não afeta o que os outros veem** — manifesto §24 (não personalizar
  feed além do view-layer local).

**Pode desfazer?**

✅ Sim — desmute/desbloquear na lista (Settings → Listas locais).

**Importante (manifesto §24):**

Bloqueio **NÃO modifica o grafo de influência** que outros clientes
Drift compartilham. É filtro pessoal de visualização — não reputação
coletiva. Você não pode "cancelar" alguém pra todo mundo via bloqueio.

---

## Quando você denuncia um post (Report)

**O que acontece:**

1. Você escolhe a razão (`spam`, `illegal`, `harassment`, `nsfw`,
   `misinformation`, `other`).
2. ⚠️ **Aviso pré-submit:** sua denúncia é evento Nostr público kind
   9081 — qualquer um sabe que **você** denunciou. Privacidade do
   reporter é zero por design (transparência da moderação).
3. Cliente assina e publica o evento com referência ao post.
4. **Pros outros:** a denúncia conta pontos no "peso de reports" do
   post. Peso da sua denúncia depende do seu **peso de identidade**:

   | Seu peso | Sua denúncia vale |
   |---:|---:|
   | < 20 | 0.5 pts |
   | < 50 | 1.0 pts |
   | < 75 | 1.5 pts |
   | ≥ 75 | 2.0 pts |

5. Quando o **total de pontos** ultrapassa o threshold dinâmico
   (baseado no tamanho da base ativa de users), o post recebe
   `score = -999` e **some do feed default**.

   - Base ativa 1.000 users → threshold 5 pts pra `spam`, 3 pts pra `illegal`
   - Base ativa 100.000 users → threshold 100 pts (defesa contra
     brigada de poucos)

**O que NÃO acontece:**

- ❌ O post **NÃO é apagado** do SQLite nem dos relays (manifesto §17).
  Cliente alternativo ainda exibe. Você pode exportar tudo. Apagar
  daria poder demais ao "fundador".
- ❌ Não há fila de moderação humana. **A comunidade decide via peso
  acumulado**, sem moderador supremo.

**Conteúdo claramente ilegal (CSAM, etc.):** denuncie no Drift E
**denuncie às autoridades competentes** (NCMEC nos EUA, SaferNet no
Brasil, etc.). Drift esconde do feed, mas não substitui ação legal —
é compromisso público do manifesto.

---

## Quando você muda Settings

### 📍 Location granularity

- **Off (default):** seus posts **não vazam localização**.
- **Country / City / Precise:** posts publicados daqui pra frente
  incluem tag `location`. Posts antigos não mudam.
- Quanto mais preciso, mais identificável você fica em rede pequena
  (cidade pequena + opinião política = você identificado — manifesto
  §28).

### 🌐 Network mode

- **Clearnet (default):** conexão WSS direta aos relays — seu IP vaza
  pro relay (igual qualquer site).
- **Tor:** roteia via SOCKS5 local (só funciona no cliente nativo
  Tauri, ainda não disponível como PWA).
- **Onion-only:** modo paranoia máxima — só conecta a relays `.onion`.

### 🔭 Sua Lente (Trust Lens)

Slider 0-100% que **reordena o feed localmente** baseado em quem você
segue + drifts seus. **Default: desligada.**

- **Strength = 0:** feed canônico bit-exact — você vê na mesma ordem
  que todo mundo (manifesto §24).
- **Strength > 0:** posts de quem você acompanha (e do entorno deles)
  sobem no SEU feed. **Não afeta o que os outros veem.**

**Sub-toggles (só aparecem quando lente ativa):**

- **"Mostrar quando a lente reordenou":** chip "lente" no canto fica
  mais visível em posts que foram afetados pelo reorder. Default OFF.
- **"Esquecer follows antigos":** follows sem atividade ≥30 dias pesam
  menos no walk PPR. Half-life 30d. Default OFF (preserva determinismo
  bit-exact pra users existentes).

**O que NÃO acontece:**

- ❌ Sua lente **NUNCA é compartilhada**. Vive 100% local.
- ❌ Lente **NUNCA altera o score canônico** (`s_global` no SQLite).
  Só multiplica no momento da renderização (`s_local`).

### ⚙️ Menu Detalhado (5 flags granulares)

Controlam quanto detalhe técnico aparece em settings:

| Flag | Default | O que faz |
|---|:---:|---|
| Detalhes (Impacto / Default / Reversível) | ✅ ON | Mostra meta-info de cada setting |
| Manifesto §X | ❌ OFF | Links pra seções do manifesto |
| Como funciona | ❌ OFF | Expande "como funciona" automaticamente |
| Algoritmo | ❌ OFF | Nomes técnicos (PageRank, etc.) |
| Labels do menu ⋮ | ✅ ON | Textos junto aos ícones de ação |

Todas locais, zero export — manifesto §28.

### 🛠️ Sovereignty (poder técnico)

Power user pode trocar:

- **Upload endpoint:** servidor de blobs (default `nostr.build`). Você
  não depende do Drift se quiser sair. Badge avisa quando customizado.
- **Map tile URL template:** servidor de tiles do mapa (default CARTO
  loga seu IP — você pode trocar pra OSM, self-hosted).
- **Report threshold override:** força threshold custom (debug,
  comunidades fechadas).

---

## O que NUNCA acontece (e por quê)

| Nunca acontece | Por quê (manifesto) |
|---|---|
| Drift escaneia automaticamente o que você publica | §25 — operador do scanner herdaria chave mestra |
| Existe "moderador supremo" que apaga posts | §17 — sem chave mestra disfarçada |
| Seu `nsec1…` é enviado pra algum servidor | §3 — identidade no dispositivo, sempre |
| Feed é personalizado por você sem você ligar Lente | §24 — feed canônico cross-device |
| Posts são apagados quando reports passam threshold | §17 — só score = -999 esconde; cliente alternativo exibe |
| Bury penaliza o autor | §23 — bury é julgamento estético, não punição |
| Existe "boost pago" pra subir no feed | §22 — score determinístico, sem reputação subjetiva nem ad |
| Coleta de telemetria comportamental | §28 — privacidade pelo mínimo |
| "Lente" altera o feed que os outros veem | §24 — view-layer carve-out estrito |
| Você é forçado a usar relay específico | §17 — você escolhe seus relays |

---

## Como seu peso de identidade funciona

Cada identidade Drift tem um número 0-100 (`weight`) calculado por
**fórmula pública**, igual em todos os clientes do mundo:

```
weight = antiquity (0-40) + engagement (0-60)

antiquity = semanas desde criação (cap 40 ≈ 9 meses)
engagement = spreads recebidos × 10
           + comentários recebidos × 1
           − reports confirmados × 15
           − dias inativo × 1
           (clamped 0-60)
```

**O que isso faz:**

- Seu spread "vale mais" quando você tem mais weight (a SOMA dos pesos
  é o que define score do post, não a COUNT de pessoas)
- Sua denúncia vale mais (até 2× pts em vez de 0.5×)
- Você pode publicar mais subposts (até 8 em vez de 1)

**Defesa anti-Sybil mecânica:**

- Identidade nova: weight 0 → spreads ≈ 0 contribuem
- 1000 identidades Sybil auto-espalhando = peso 0 = score 0
- Identidade veterana com atividade real cresce naturalmente

**Tiers visuais:**

| Weight | Badge |
|---:|---|
| ≥ 60 | 🏆 estabelecido |
| ≥ 40 | ⭐ ativo |
| ≥ 20 | 🌱 novo |
| < 20 | (sem badge — identidade fresca não envergonha) |

---

## FAQ honesto

### "Posso apagar um post que me arrependi?"

**Não totalmente.** Você pode publicar um evento NIP-09 (delete
request) que pede aos relays pra esquecer. Mas:
- Relays podem ignorar
- Quem já baixou tem cópia
- Cliente alternativo pode exibir

**Drift é "publish forever" por design** (§10). Pense antes de
publicar. É inconveniente, mas é o que torna a rede livre.

### "Posso ter mais de uma identidade?"

✅ Sim. Multi-identidade está implementada — Settings → Identidades.
Cada uma tem `nsec` própria, histórico próprio, peso próprio. Trocar
de ativa exige reload do app.

### "Alguém pode saber se eu vi o post mas não dei spread?"

**Não.** Ver/scroll/abrir não publica eventos. Só ações explícitas
(SPREAD, SINK, follow, report, publicar) viram eventos públicos.

### "Onde meus posts ficam?"

Nos **relays Nostr que você configurou** + no **SQLite local** dos
clientes que processaram. Você pode rodar seu **próprio relay** se
quiser garantia máxima.

### "E se um país bloquear o Drift?"

A versão atual é PWA (web) — bloqueio de domínio funciona. A versão
nativa (Fase 6, em desenvolvimento) terá Tor embedded + WebRTC
peer-to-peer + IPFS pinning. Manifesto §15 anti-censura por país é
compromisso público.

### "Se o criador do Drift desaparecer, o que acontece?"

A rede continua. Os relays são independentes (Damus, nos.lol,
relay.damus.io, etc.). Sua identidade é portátil. Outros clientes
Nostr leem os mesmos eventos. **Drift não é um servidor que pode
ser desligado** — é um cliente pra uma rede pública.

### "Quero entender a matemática por trás dos algoritmos."

📚 Leia [`Docs/algoritmos.md`](algoritmos.md) — explica os 7 algoritmos
centrais (score, weight, threshold, edge influence, PPR, view
multiplier, temporal decay) com fórmulas + simulações numéricas +
cenários integrados.

### "Quero ver o código fonte / contribuir."

O código é aberto. Veja [CLAUDE.md](../CLAUDE.md) pra entender a
arquitetura.

### "Tenho uma sugestão / encontrei um bug."

Abra issue no repositório. Drift se desenvolve em público — manifesto
§17 (sem chave mestra) inclui desenvolvimento aberto.

---

## Onde encontrar mais

- **Princípios fundadores:** [`Docs/manifesto.md`](manifesto.md) — 34
  compromissos públicos. Quando algo no app conflita com manifesto,
  manifesto vence.
- **Como o ranking funciona em detalhe:** [`Docs/algoritmos.md`](algoritmos.md)
- **Limitações conhecidas (honestidade radical):**
  [`Docs/known-limitations.md`](known-limitations.md)
- **Status dos 34 princípios:**
  `Docs/manifesto-coverage-matrix-2026-05-20.md`

---

*Última atualização: 2026-05-20. Se algo aqui parecer diferente do app,
o app deve refletir o manifesto — abra issue. Documentação user-facing
é compromisso de transparência (§17 + §22).*
