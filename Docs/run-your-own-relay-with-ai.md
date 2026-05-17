# Rode Seu Próprio Relay Drift (com IA, se quiser)

**Persona responsável:** Ted (arquitetura)
**Versão:** 1.0 — 2026-05-17
**Status:** Receita pública, comunidade-friendly. Não é endorsement
oficial de moderação — é endorsement de **liberdade do operator** dentro
dos limites do manifesto.
**Fonte completa da deliberação:**
[`Docs/sessions/relay-moderation-himym-research-2026-05-17.md`](sessions/relay-moderation-himym-research-2026-05-17.md)

---

## 1. Introdução — quem isso é pra

Este guia mostra como rodar um **relay Nostr próprio** com filtro de IA
**opcional**, custando ~€5/mês, em ≤30 minutos de setup.

Ele é pra:

- **Comunidades pequenas/médias** (jornalismo, academia, coletivos
  LGBTQ+, salas de aula, fandoms) que querem um *space próprio* sem
  depender de relays públicos
- **Operators que querem rodar um relay moderado** sem violar o espírito
  do Drift
- **Pesquisadores** testando moderação algorítmica com auditoria pública

Ele **não é pra**:

- Substituir o feed neutro do cliente Drift (manifesto §24)
- Virar default ligado em qualquer cliente oficial (manifesto §17 adendo)
- Criar whitelist global de "conteúdo aceitável" (manifesto §17)

### Por que isso existe

O manifesto §17 (Resistência ao Fundador) ganhou em 2026-05-17 um
**adendo de escopo** que vale citar literalmente:

> §17 vincula o **cliente oficial**. Não estende a **operadores de relay**.
> Relay é infra de transporte; operator decide política de aceite/rejeição
> (spam, NSFW, illegal, KYC, paywall). Cliente Drift NUNCA escaneia
> conteúdo (§25), MAS relay operator é livre — inclusive pra rodar AI
> moderation. A ressalva é que esta liberdade do operator NÃO pode virar
> default imposto pelo cliente.
>
> Resumo: §17 protege a REDE da chave-mestra do fundador. Não impede que
> user escolha participar de subset moderado da rede — desde que escolha
> consciente.

Em uma frase: **o cliente Drift nunca filtra. Você, operator de relay,
pode — se for transparente.**

---

## 2. Princípios não-negociáveis

Estes 5 itens são pré-requisito pra seu relay aparecer no Discovery
curado do cliente Drift (seção §11 abaixo). Se você romper qualquer um,
você é livre pra rodar mesmo assim — mas vai ficar fora da lista oficial
e o cliente vai exibir warning vermelho ao adicionar manualmente.

1. **Manifesto §17 sagrado:** seu relay pode rejeitar evento, mas o
   cliente oficial Drift NUNCA vai escanear. Operator é livre, cliente
   é cego — separação rígida.

2. **Política pública em NIP-11:** publique `drift_policy` no
   `/.well-known/nostr.json` declarando classifiers usados, categorias
   rejeitadas, contato de appeal. Seção §8 mostra o schema. Transparência
   > opacidade.

3. **Audit público do classifier:** documente modelo (`omni-moderation-2024-09-26`,
   `nudenet-v3.4.2`), threshold de confidence, e mantenha um log público
   (mensal, agregado) de decisions: aceito vs rejected vs shadow-reject,
   por categoria. Sem isso é caixa-preta — você vira chave-mestra
   disfarçada do operator do classifier (manifesto §25).

4. **Appeal contact obrigatório:** email/Nostr npub funcional que
   responde dentro de prazo declarado. Sem isso vira lock-in silencioso.

5. **Discovery, nunca SEED:** seu relay entra como **opção opt-in** no
   sub-card "Descobrir" do cliente Drift. Nunca como SEED hardcoded
   (`config/relays.ts`). User escolhe consciente — manifesto §17 adendo.

Se tudo isso está OK, segue.

---

## 3. Stack escolhido

| Camada | Escolha | Versão | Por quê |
|---|---|---|---|
| Backend relay | **strfry** | master @ 2026-05 (sem release tags formais) | LMDB rápido, ~23% dos relays Nostr reachable rodam strfry, negentropy nativo (set reconciliation pra sync incremental), plugin neutro a linguagem |
| Plugin runtime | Node.js + TypeScript | Node 22 LTS | Fluência ampla, ecossistema de SDKs (`openai`, `onnxruntime-node`), stdin/stdout JSONL trivial |
| Classifier texto | OpenAI Moderation | `omni-moderation-latest` | Free, multimodal (texto + imagem), 80-200ms p95 |
| Classifier imagem | NudeNet ONNX | `3.4.2` | Local, ~142ms/imagem CPU ARM, sem TensorFlow, sem upload pra terceiro |
| TLS | Let's Encrypt + certbot | atual | Free, automated |
| Reverse proxy | nginx | distro stable | Suporte WS upgrade nativo, fácil HSTS/ratelimit |
| VPS | Hetzner CAX11 ARM | 2 vCPU, 4 GB RAM, 40 GB NVMe | €4.49/mês após abril 2026, jurisdição UE (privacy-friendly) |

**Por que não khatru/nostr-rs-relay?**

- **khatru** (Go, fiatjaf) — excelente DSL pra policy *embutida* em Go,
  mas exige rebuild a cada mudança de política. Comunidade que quer
  forkar policy fica refém de toolchain Go.
- **nostr-rs-relay** — Rust puro, performático, mas sem plugin system
  estável; policy custom requer fork do binário.
- **strfry** — plugin por stdin/stdout JSONL deixa community **mudar
  policy sem recompilar relay**. Operator escreve em qualquer linguagem.

Decisão registrada na sessão linkada no topo.

---

## 4. Pipeline de write policy (4 stages)

Cada evento que chega via WebSocket passa por 4 stages antes de hit no
LMDB do strfry. Latência total target: **<350ms p95**, com fail-open em
qualquer timeout (manifesto §16: cliente continua tendo onde escrever).

```
stdin (JSONL via strfry)
  │
  ├─ Stage 1 [~0.05ms]  kind/schema check
  │     - kind ∈ {0, 1, 3, 9078..9081, 1984, 10002, ...} aceito
  │     - kind fora da whitelist → reject "kind not supported"
  │     - tamanho > 64 KB → reject "event too large"
  │
  ├─ Stage 2 [~0.5ms]   cache lookup
  │     - SELECT FROM reports_cache WHERE event_id = $id
  │     - se threshold dinâmico ultrapassado → shadowReject
  │
  ├─ Stage 3 [50-300ms] AI classifier (PARALELO)
  │     - texto:    OpenAI omni-moderation (POST batch)
  │     - imagens:  fetch URL + NudeNet local (CPU)
  │     - timeout 1.5s → fail-open (accept) + log warning
  │     - score > threshold → reject com msg pública
  │
  └─ Stage 4           strfry persiste em LMDB
        - operator log linha (decisão + categoria + scores)
        - stdout JSONL { id, action, msg }
```

### Pseudocode (TypeScript)

Fica em `~/strfry/policy.mjs`. Strfry executa via config `writePolicy.plugin`.

```typescript
// policy.mjs — ~50 linhas, ESM
import readline from 'readline'
import OpenAI from 'openai'
import { NudeDetector } from 'nudenet-node-wrapper'  // ou ONNX direto

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY })
const nude = new NudeDetector({ modelPath: './models/320n.onnx' })

const DRIFT_KINDS = new Set([0, 1, 3, 9078, 9079, 9080, 9081, 1984, 10002])
const REJECT_CATEGORIES = new Set([
  'sexual/minors', 'hate/threatening', 'self-harm/instructions', 'violence/graphic'
])

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  const { event, type } = JSON.parse(line)
  if (type !== 'new') return emit(event.id, 'accept')

  // Stage 1: kind/schema
  if (!DRIFT_KINDS.has(event.kind)) {
    return emit(event.id, 'reject', 'blocked: kind not allowed by this relay')
  }
  if (event.content.length > 65536) {
    return emit(event.id, 'reject', 'blocked: event too large')
  }

  // Stage 3: AI (Stage 2 omitido aqui — assume DB lookup separado)
  try {
    const text = event.content || ''
    const imageUrls = extractImageUrls(text)  // regex simples nostr.build/imgproxy

    const [textRes, ...imgRes] = await Promise.all([
      text ? withTimeout(openai.moderations.create({
        model: 'omni-moderation-latest',
        input: text
      }), 1500) : null,
      ...imageUrls.map(u => withTimeout(nude.detect(u), 1500))
    ])

    if (textRes?.results[0]) {
      for (const cat of Object.keys(textRes.results[0].categories)) {
        if (textRes.results[0].categories[cat] && REJECT_CATEGORIES.has(cat)) {
          logDecision(event, 'reject', cat, textRes.results[0].category_scores[cat])
          return emit(event.id, 'reject', `blocked: ${cat}. appeal: abuse@example.org`)
        }
      }
    }

    for (const r of imgRes) {
      if (r?.detections?.some(d => d.class === 'EXPLICIT' && d.score > 0.85)) {
        logDecision(event, 'reject', 'image/explicit-unflagged', r.detections[0].score)
        return emit(event.id, 'reject', 'blocked: explicit image without content-warning tag. appeal: abuse@example.org')
      }
    }

    logDecision(event, 'accept', null, null)
    emit(event.id, 'accept')
  } catch (err) {
    // Fail-open (manifesto §16): timeout/erro → aceita + alerta operator
    console.error(`[policy] fail-open on ${event.id}:`, err.message)
    logDecision(event, 'accept-failopen', null, null)
    emit(event.id, 'accept')
  }
})

function emit(id, action, msg) {
  process.stdout.write(JSON.stringify({ id, action, msg: msg || '' }) + '\n')
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}
```

Observação importante: `omni-moderation-latest` da OpenAI também aceita
**imagens nativamente** — você pode simplificar dropping NudeNet caso
aceite enviar imagens pra OpenAI. NudeNet vira escolha por **privacy**
(imagens nunca saem do seu VPS). Trade-off detalhado na seção §7.

---

## 5. Receita quick-start (≤30 min)

### 5.1. Provisionar VPS Hetzner CAX11

1. Criar conta em [hetzner.com/cloud](https://www.hetzner.com/cloud/) (precisa
   confirmar identidade — UE compliance, não KYC bancário). Sem cartão
   cobrado até criar instance.
2. Console → "New project" → "Add Server":
   - **Location:** Helsinki (FI) ou Nuremberg (DE) — jurisdições privacy-friendly UE
   - **Image:** Ubuntu 24.04 LTS
   - **Type:** ARM64 → **CAX11** (€4.49/mês após Apr 2026)
   - **SSH key:** cole sua pubkey SSH (gere com `ssh-keygen -t ed25519` se não tiver)
   - **Name:** `drift-relay-01`
3. Aguardar ~30s. Anote IPv4 público.

### 5.2. Provisionar domínio

Compre um domínio (~€8/ano em namecheap, porkbun, gandi). Crie A record:

```
relay.suacomunidade.org    A    <IPv4-hetzner>
```

Aguarde propagar (~5 min, `dig +short relay.suacomunidade.org`).

### 5.3. SSH + dependências

```bash
ssh root@relay.suacomunidade.org

# 1. Update + deps básicas pra strfry build
apt update && apt upgrade -y
apt install -y git build-essential libyaml-perl libtemplate-perl \
  libregexp-grammars-perl libssl-dev zlib1g-dev liblmdb-dev libflatbuffers-dev \
  libsecp256k1-dev libzstd-dev nginx certbot python3-certbot-nginx ufw

# 2. Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 3. Firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 4. User não-root pro relay
useradd -m -s /bin/bash strfry
```

### 5.4. Build strfry

```bash
sudo -u strfry -i
cd ~
git clone https://github.com/hoytech/strfry
cd strfry
git submodule update --init
make setup-golpe
make -j$(nproc)
# ~5 min em CAX11. Binário fica em ~/strfry/strfry
./strfry --version
```

### 5.5. Plugin policy.mjs + dependências Node

```bash
# Ainda como user strfry
cd ~/strfry
mkdir -p policy && cd policy
npm init -y
npm install openai
# NudeNet via wrapper Node ou diretamente via onnxruntime-node:
npm install onnxruntime-node sharp

# Download modelo NudeNet 320n (~25 MB)
mkdir -p models
curl -L https://github.com/notAI-tech/NudeNet/releases/download/v3.4/320n.onnx \
  -o models/320n.onnx

# Cole o conteúdo da seção §4 em ~/strfry/policy/policy.mjs
nano policy.mjs

# Variáveis de ambiente
echo 'OPENAI_KEY=sk-...' > ~/.strfry-policy.env
chmod 600 ~/.strfry-policy.env
```

### 5.6. Config strfry

Edite `~/strfry/strfry.conf`:

```hocon
db = "./strfry-db/"
relay {
  bind = "127.0.0.1"
  port = 7777
  nofiles = 1000000
  info {
    name = "Drift Community Relay"
    description = "AI-moderated relay (NudeNet + OpenAI). Política: /policy.html"
    pubkey = "<seu_pubkey_hex>"
    contact = "abuse@suacomunidade.org"
    icon = "https://suacomunidade.org/logo.png"
  }
  writePolicy {
    plugin = "/home/strfry/strfry/policy/run.sh"
  }
}
```

Crie `~/strfry/policy/run.sh` (carrega env e roda Node):

```bash
#!/bin/bash
set -a; source ~/.strfry-policy.env; set +a
exec /usr/bin/node /home/strfry/strfry/policy/policy.mjs
```

```bash
chmod +x ~/strfry/policy/run.sh
```

### 5.7. systemd unit

Como root:

```bash
cat > /etc/systemd/system/strfry.service <<'EOF'
[Unit]
Description=strfry Nostr relay
After=network.target

[Service]
User=strfry
Group=strfry
WorkingDirectory=/home/strfry/strfry
ExecStart=/home/strfry/strfry/strfry relay
Restart=on-failure
RestartSec=5
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now strfry
systemctl status strfry  # deve estar "active (running)"
```

### 5.8. nginx + Let's Encrypt

```bash
cat > /etc/nginx/sites-available/relay <<'EOF'
server {
  listen 80;
  server_name relay.suacomunidade.org;
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name relay.suacomunidade.org;
  # ssl_certificate ... (preenchido pelo certbot)

  add_header Strict-Transport-Security "max-age=63072000" always;
  client_max_body_size 256k;

  # NIP-11 endpoint
  location = /.well-known/nostr.json {
    default_type application/nostr+json;
    add_header Access-Control-Allow-Origin *;
    alias /var/www/html/nostr.json;
  }

  location / {
    if ($http_accept = "application/nostr+json") {
      rewrite ^.*$ /.well-known/nostr.json last;
    }
    proxy_pass http://127.0.0.1:7777;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 86400;
  }
}
EOF

ln -s /etc/nginx/sites-available/relay /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

certbot --nginx -d relay.suacomunidade.org --agree-tos -m abuse@suacomunidade.org -n
```

### 5.9. Smoke test com `nak`

Em qualquer máquina:

```bash
# Instale nak (https://github.com/fiatjaf/nak)
go install github.com/fiatjaf/nak@latest

# Publica evento texto sano
echo "hello drift relay" | nak event --sec <sua_nsec_test> -k 1 wss://relay.suacomunidade.org
# → deve responder "OK"

# Tenta publicar conteúdo flagrante (vai falhar com NIP-20)
echo "<conteúdo violador conhecido>" | nak event --sec ... -k 1 wss://relay.suacomunidade.org
# → "blocked: <category>. appeal: abuse@..."

# Fetch
nak req -k 1 --limit 5 wss://relay.suacomunidade.org
```

Se receber OK e o reject vier com mensagem, está vivo.

---

## 6. NIP-11 com `drift_policy`

Crie `/var/www/html/nostr.json`:

```json
{
  "name": "Drift Community Relay",
  "description": "AI-moderated relay com OpenAI + NudeNet. Read free; write filtrado.",
  "pubkey": "<seu_pubkey_hex>",
  "contact": "abuse@suacomunidade.org",
  "supported_nips": [1, 9, 11, 42, 56, 65],
  "software": "https://github.com/hoytech/strfry",
  "version": "master@2026-05",
  "limitation": {
    "max_message_length": 65536,
    "max_subscriptions": 20,
    "auth_required": false,
    "payment_required": false
  },
  "drift_policy": {
    "version": "1.0",
    "tier": "ai-automated",
    "classifiers": [
      {
        "name": "openai-omni-moderation",
        "model": "omni-moderation-latest",
        "modality": ["text", "image"],
        "threshold": 0.7
      },
      {
        "name": "nudenet",
        "model": "v3.4.2-320n",
        "modality": ["image"],
        "threshold": 0.85,
        "runs_locally": true
      }
    ],
    "rejects": [
      "sexual/minors",
      "hate/threatening",
      "self-harm/instructions",
      "violence/graphic",
      "image/explicit-unflagged"
    ],
    "appeal_contact": "abuse@suacomunidade.org",
    "audit_log": "https://suacomunidade.org/relay-audit/",
    "policy_url": "https://suacomunidade.org/policy.html"
  }
}
```

Cliente Drift lê `drift_policy.tier` e exibe badge correspondente
(`ai-automated`, `ai-assisted`, `manual`, `none`) no card de relay em
Settings > Relays > Descobrir. Detalhes da UX em
[`Docs/sessions/relay-moderation-himym-research-2026-05-17.md`](sessions/relay-moderation-himym-research-2026-05-17.md)
seção Lily.

Validação rápida:

```bash
curl -H "Accept: application/nostr+json" https://relay.suacomunidade.org | jq .drift_policy
```

---

## 7. Trade-offs por classifier

| Classifier | Custo | Latência | Privacy | Acurácia | Quando usar |
|---|---|---|---|---|---|
| **OpenAI omni-moderation** | $0 (free, sem rate punitivo) | 80-200ms p95 | Conteúdo passa pelos servers da OpenAI; logs declarados de retenção | Alto recall, baixo false-positive em texto inglês; pior em outras línguas | Texto default. Imagem se aceita exfil pra OpenAI |
| **NudeNet ONNX local** | €0 (CPU local) | ~142ms/img CAX11 ARM | Máxima — imagens nunca saem do VPS | Bom em explicit/sugestivo nudez; nenhum awareness de violence/hate | Sidecar pra imagens quando privacy é hard requirement |
| **Perspective API (Google)** | Free tier limitado, $/req acima | 100-300ms | Pior — Google Cloud logs + Análise | OK em toxicity, ruim em context cultural | Evitar — bias documentado em [EFF 2024](https://www.eff.org/deeplinks/2024/06/global-suppression-online-lgbtq-speech-continues) |
| **Llama-Guard 2B local (llama.cpp)** | €0 (RAM 8GB+) | 800ms-3s CAX11 (lento) | Máxima — tudo local | Alta, prompt-tunável | VPS com mais RAM/GPU; latency-tolerant |
| **Sem classifier (manual + reports)** | €0 | 0ms | Máxima | N/A — reativo, não preventivo | Tier `manual` no NIP-11; reports kind 1984 + threshold dinâmico |

### Avisos importantes

- **AI bias é real e documentado.** Tumblr 2018 acabou em settlement com
  NYC Human Rights por viés algorítmico contra LGBTQ+. Pesquisa atual
  ([UQ News 2026-04](https://news.uq.edu.au/2026-04-how-ai-bias-can-creep-online-content-moderation),
  [Frontiers 2024](https://www.frontiersin.org/journals/communication/articles/10.3389/fcomm.2024.1385869/full))
  confirma que LLMs moderation flag minorias mais. **Audit público do
  classifier é obrigatório.** Publique decisions log mensal agregado.
- **OpenAI free tier** não tem SLA. Se a API cair, fail-open (manifesto §16)
  vira regra — você aceita conteúdo não-classificado. Documente em policy.
- **NudeNet sem update há ~12 meses** ([Snyk advisory 2026](https://snyk.io/advisor/python/nudenet)).
  Considere migrar pra alternativa ONNX mais ativa se o repo continuar
  parado em 2027.

---

## 8. Schema `drift_policy` (NIP-11 extension)

Custom field proposto pelo Drift. Não é NIP oficial — é namespace
`drift_*` reservado pro ecossistema.

```typescript
interface DriftPolicy {
  /** Schema version. */
  version: '1.0'

  /** Tier visível na UI do cliente Drift. */
  tier: 'none' | 'manual' | 'ai-assisted' | 'ai-automated'

  /** Lista de classifiers usados. Pelo menos 1 se tier ≠ 'none'. */
  classifiers: Array<{
    /** Identificador human-readable. */
    name: string
    /** Versão/checkpoint pinada. */
    model: string
    /** O que o classifier vê. */
    modality: Array<'text' | 'image' | 'video' | 'audio'>
    /** Threshold de score acima do qual reject dispara (0..1). */
    threshold: number
    /** Se true, dados não saem do VPS (privacy hint). */
    runs_locally?: boolean
  }>

  /** Categorias rejeitadas (texto livre estável). */
  rejects: string[]

  /** Email ou Nostr URI (nostr:npub1...) pra appeal. Obrigatório. */
  appeal_contact: string

  /** URL com log público de decisions (mensal agregado mínimo). */
  audit_log?: string

  /** URL com política humana legível. */
  policy_url?: string
}
```

**Cliente Drift comportamento:**
- Lê NIP-11 lazy quando user abre Discovery
- Cacheia 24h em `relay_directory_cache`
- Renderiza badge colorido por `tier` (`drift-warning` pra ai-*,
  `drift-spread` pra manual, `drift-danger` pra none)
- Modal expandido mostra `classifiers`, `rejects`, `appeal_contact` em
  texto plain

---

## 9. Operação ongoing

### Logs

```bash
# Strfry runtime
journalctl -u strfry -f --since "1 hour ago"

# Decisões do classifier (formato JSONL append-only)
tail -f /home/strfry/strfry/policy/decisions.jsonl
```

Recomendação: append decisões pra `decisions.jsonl`, rotacionar com
logrotate semanal, gerar agregado mensal anonimizado (sem event_id, sem
pubkey) e publicar em `https://suacomunidade.org/relay-audit/YYYY-MM.json`.

Exemplo de entry agregada (público, sem PII):

```json
{
  "month": "2026-05",
  "events_seen": 142031,
  "accepted": 141618,
  "rejected": 387,
  "shadow_rejected": 26,
  "rejections_by_category": {
    "sexual/minors": 12,
    "hate/threatening": 49,
    "image/explicit-unflagged": 326
  },
  "appeals_received": 4,
  "appeals_reversed": 2
}
```

### Backup

LMDB é single-writer mas read-safe durante quiet hour:

```bash
# Cron diário 04:00 UTC
0 4 * * * cd /home/strfry/strfry && cp -r strfry-db /var/backups/strfry-$(date +\%F)
0 5 * * * find /var/backups -name 'strfry-*' -mtime +14 -exec rm -rf {} +
```

Ou use `strfry export` pra dump JSONL (mais portável):

```bash
sudo -u strfry /home/strfry/strfry/strfry export > /var/backups/strfry-$(date +%F).jsonl
```

### Monitor

Strfry não expõe Prometheus nativamente. Script de probe simples:

```bash
#!/bin/bash
# /usr/local/bin/relay-probe.sh — cron a cada 5min
URL="wss://relay.suacomunidade.org"
START=$(date +%s%3N)
timeout 5 nak req -k 1 --limit 1 "$URL" >/dev/null 2>&1
END=$(date +%s%3N)
if [ $? -ne 0 ]; then
  echo "$(date -Iseconds) DOWN" >> /var/log/relay-probe.log
  # opcional: curl webhook discord/slack
else
  echo "$(date -Iseconds) UP $((END-START))ms" >> /var/log/relay-probe.log
fi
```

### Upgrades

- **strfry** sem release tags formais — siga `master` com
  `git fetch && git log HEAD..origin/master` antes de cada upgrade,
  pelo menos mensalmente. Recompile com `make -j$(nproc)` durante
  janela de baixa atividade.
- **nginx / Ubuntu** — `unattended-upgrades` cobre security patches
  automaticamente; deixe ligado.
- **NudeNet** — se PyPI ressuscitar com nova versão, atualize.
- **OpenAI model** — `omni-moderation-latest` é alias móvel. Se você
  quer pinning estrito, troque pra `omni-moderation-2024-09-26` (pin
  explícito) e re-avalie thresholds quando trocar.

---

## 10. Riscos & mitigation

(Resumo do threat model Barney na sessão referenciada. Vale ler completo
antes de operar relay em produção.)

### Silent drop invisível
- **Risco:** strfry pode rejeitar evento sem enviar NIP-20 OK/false ao
  cliente. User não sabe se foi aceito.
- **Mitigation:** strfry envia NIP-20 automaticamente pra `reject`. Pra
  `shadowReject` (aceita o evento sem persistir), envia OK true — isso é
  **deliberadamente invisível** ao cliente, usado pra spammers.
  **Documente publicamente** quando você usa shadowReject (no
  `policy_url`) e nunca use pra opiniões legítimas.

### AI bias
- **Risco:** classifiers flag minorias mais. False-positive em arte,
  educação sexual, saúde mental, discurso LGBTQ+.
- **Mitigation:**
  - Threshold conservador (0.7+ não 0.5)
  - Audit log público mensal, agregado
  - Appeal contact ativo e responde em <72h
  - Categoria `image/explicit-unflagged` rejeita SÓ se faltar tag
    `content-warning` — autor que tagueia voluntariamente passa
    (manifesto §27)

### Shadow-reject vs reject
- **`reject`** envia NIP-20 false ao cliente com `msg`. User vê
  "blocked: <reason>". Transparente. Use sempre que possível.
- **`shadowReject`** finge aceitar. Use **apenas** pra spam óbvio
  (>20 mesma mensagem em 10s do mesmo pubkey). Documente uso público.

### Operator captura
- **Risco:** você (operator) vira chave-mestra disfarçada do classifier
  (manifesto §25). Cliente Drift confia no seu relay; OpenAI decide via
  classifier; você herda esse poder.
- **Mitigation:**
  - Cliente Drift publica em ≥2 relays sempre (manifesto §14, §20)
  - Seu relay é **opt-in** no Discovery, nunca SEED hardcoded
  - User pode trocar de relay em 2 cliques
  - Audit público permite comunidade verificar se você está
    overreaching

### Legal / jurisdição
- Hetzner Alemanha/Finlândia: jurisdições UE razoáveis pra free speech
  + DMCA-style takedown via processo legal.
- **DSA (Digital Services Act)** UE pode aplicar — se relay tem >50
  active monthly users, pode entrar em escopo de "intermediário online".
  Consulte advogado se passar de 1000 active users.
- Conteúdo ilegal (CSAM, terrorismo): denuncie autoridades competentes
  (NCMEC, Internet Watch Foundation, SaferNet Brasil). Manifesto §17 +
  Nota Legal em `Docs/manifesto.md` cobrem isso explicitamente.

---

## 11. Como aparecer no curated do cliente Drift

Drift mantém lista curada em
[`Docs/curated-relays-2026-05.json`](curated-relays-2026-05.json),
versionada mensalmente. Pra entrar:

### Critérios obrigatórios
1. **Free** (sem paywall NIP-42). Drift constraint do Arquiteto
   2026-05-17 — sem pagos no curated.
2. **Política pública** acessível em URL HTTPS, em linguagem humana.
3. **NIP-11 com `drift_policy`** completo (tier + classifiers + rejects
   + appeal_contact).
4. **Audit publicado** mensal — pelo menos agregados.
5. **Appeal contact ativo** (email funcional, responde ≤72h).
6. **Sem KYC** — não pede documento, ID, número de telefone, etc.
7. **Sem tolerância a CSAM ou conteúdo ilegal sob lei UE/Brasil**.
8. **Operator identificável** (nome ou pseudônimo estável + npub +
   contato).

### Como submeter
1. Fork do repo Drift
2. Editar `Docs/curated-relays-YYYY-MM.json` adicionando entry na tab
   `moderated` (ou `community`, `free`, conforme política)
3. PR contra branch principal com label `relay-submission`
4. Incluir no PR description: URL do policy, URL do audit log, link pro
   NIP-11 vivo (`curl` output OK), e demonstração de smoke test
5. Review faz curador Drift (signed-off Robin persona, ver
   `Docs/sessions/`)

### Critérios subjetivos (curador pode rejeitar)
- Operator em jurisdição com track record forte de censura estatal
  pra free speech (China, Coreia do Norte, Belarus, etc.)
- Política vaga ("nada inadequado", "respeito à comunidade")
- Threshold de classifier suspeito (<0.5 = aggressive over-reach)
- Histórico documentado de retaliação contra reporters

Rejeições são públicas (issue no repo com label `relay-rejected` +
rationale). Manifesto §17 transparência > opacidade.

---

## 12. FAQ

### "Posso rodar relay com IA sem violar §17?"
Sim, desde que: você é livre como operator, mas seu relay nunca vira
SEED default do cliente Drift, e você publica `drift_policy` em NIP-11.
Adendo §17 (2026-05-17) cobre isso.

### "OpenAI lê meu conteúdo. Não fere privacy?"
Lê o conteúdo dos eventos que passam pelo classifier (texto + imagens
URLs). Não lê IP de quem postou (você é proxy). Se isso é inaceitável
pra sua comunidade, use **só NudeNet local** + reports kind 1984
(`tier: "manual"`) e fica em ~€5/mês mesmo assim. Cliente Drift renderiza
badge "manual" sem AI badge — sinal honesto pro user.

### "Posso bloquear conteúdo político específico?"
Tecnicamente sim — seu relay, suas regras. Politicamente: você vai
aparecer como `ai-automated` no Discovery, e users que valorizam free
speech vão fugir. Manifesto §17 não te impede; mas o ecossistema vai
te isolar via escolha agregada. Recomendação: bloqueie só categorias
testáveis (sexual/minors, hate/threatening direta, illegal-per-law) e
deixe spectrum cultural pro feed-level filter do cliente.

### "Quanto custa pra 10k users ativos?"
Linear ~€20/mês (CAX21 — 4 vCPU/8GB) se mantiver OpenAI free. Storage
LMDB é eficiente — ~5 GB por 100k eventos. SSDs Hetzner sobram. Bottleneck
real costuma ser bandwidth uplink em horários de pico (CAX21 dá 20 TB
egress incluído).

### "Tor hidden service também?"
Sim, recomendado. Instale `tor` no VPS, gere `HiddenServicePort 80
127.0.0.1:7777` no `torrc`, publique `.onion` no NIP-11. Cliente Drift
em `network_mode=tor` (Fase 6, cliente nativo Tauri) consome direto.
Veja [0xtrr/onion-service-nostr-relays](https://github.com/0xtrr/onion-service-nostr-relays)
pra setup detalhado.

### "Posso emitir kind 1984 (NIP-56) do meu relay?"
Não. Reports NIP-56 são eventos do **user** (quem reporta). Seu relay
processa reports recebidos via threshold dinâmico (manifesto §26) mas
não cria reports próprios. Isso seria operator-as-reporter, vetor de
captura. Veja schema NIP-56 em Marshall na sessão referenciada.

---

## Referências

**Spec:**
- [NIP-01 / NIP-11 / NIP-20 / NIP-42 / NIP-56 / NIP-65](https://github.com/nostr-protocol/nips)
- [strfry plugin docs](https://github.com/hoytech/strfry/blob/master/docs/plugins.md)

**Tools:**
- [strfry repo](https://github.com/hoytech/strfry)
- [NudeNet PyPI](https://pypi.org/project/nudenet/) — v3.4.2
- [OpenAI Moderation guide](https://platform.openai.com/docs/guides/moderation)
- [nak — Nostr CLI](https://github.com/fiatjaf/nak)

**Threat model / bias:**
- [Tumblr 2018 settlement](https://www.engadget.com/tumblr-porn-ban-settlement-algorithm-training-184739455.html)
- [UQ — AI bias in content moderation 2026](https://news.uq.edu.au/2026-04-how-ai-bias-can-creep-online-content-moderation)
- [EFF — Global suppression LGBTQ+ speech](https://www.eff.org/deeplinks/2024/06/global-suppression-online-lgbtq-speech-continues)
- [W3C — Nostr censorship verification gap](https://lists.w3.org/Archives/Public/public-nostr/2025Mar/0008.html)

**Drift internal:**
- [Manifesto §17 adendo](manifesto.md#17-resistência-ao-fundador)
- [HIMYM research session 2026-05-17](sessions/relay-moderation-himym-research-2026-05-17.md) — fonte completa
- [Curated relays 2026-05](curated-relays-2026-05.json)
- [Coverage matrix](manifesto-coverage-matrix-2026-05-15.md)

**Legal:**
- Veja [`Docs/manifesto.md`](manifesto.md) "Nota Legal" seção final pra
  disclaimers de jurisdição, takedown, e responsabilidade do operator.

---

*Mantido por: Ted (persona arquitetura). Última revisão: 2026-05-17.
Patches via PR contra repo principal Drift.*
