# Rodar seu próprio relay Nostr (e usá-lo no Drift)

> **Por quê:** manifesto §16 (disponibilidade distribuída) — "o que a
> comunidade espalhou, a comunidade guarda". Os 4 seeds clearnet do
> Drift hoje (`relay.damus.io`, `nos.lol`, `relay.nostr.band`,
> `nostr.wine`) cobrem o caso comum, mas você não precisa confiar
> neles. Subir seu próprio relay leva ~30min e custa ~$5/mês.
>
> **Esse guia é operacional, não acadêmico.** Comandos prontos, copy-paste,
> com explicações curtas do "por quê". Se algo aqui ficar desatualizado,
> abra um PR em `Docs/run-your-own-relay.md`.

---

## 1. O que é um relay Nostr

Servidor WebSocket que aceita eventos Nostr (NIP-01) — guarda, deduplica,
e retransmite pra clientes que assinaram filtros compatíveis. Drift
publica seus 4 kinds (9078..9081) em N relays simultaneamente; clientes
sincronizam de qualquer um. Quanto mais relays diversos, mais difícil
censurar.

**Seu relay precisa fazer:**
- Aceitar conexões WSS (TLS obrigatório pra clients PWA — secure context).
- Aceitar `EVENT`, `REQ`, `CLOSE` per NIP-01.
- Persistir eventos por algum período (configurável).
- (Opcional) Filtrar por kind, autor, etc. — mas Drift assume relays
  abertos pra kinds 9078..9081.

**Não precisa fazer:**
- Validar conteúdo Drift especificamente. Schema check é cliente-side.
- Implementar TODOS os NIPs. Os críticos pro Drift hoje:
  NIP-01 (core), NIP-11 (relay info opcional). NIP-42 (auth) e NIP-50
  (search) são bonus.

---

## 2. Opções de software

| Software | Linguagem | Recomendado pra | Notes |
|---|---|---|---|
| **[strfry](https://github.com/hoytech/strfry)** | C++ | Produção, qualquer escala | Performance excelente, footprint baixo, configuração detalhada |
| **[nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay)** | Rust | Hobby/pequeno-médio | Setup rápido, SQLite, pouca dep |
| **[khatru](https://github.com/fiatjaf/khatru)** | Go | Customização Lua | Mais simples pra hackear; performance inferior ao strfry |

Esse guia usa **`strfry`** porque é o mais usado em produção e tem
docker-compose pronto. Se você prefere Rust ou Go, os passos de TLS,
firewall e Drift wire-up valem igual — só troque a parte do binário.

---

## 3. Hardware mínimo

Pra um relay pessoal/pequeno (até ~1000 users ativos, ~50req/s):

- **CPU:** 1 vCPU
- **RAM:** 1 GiB
- **Disk:** 20 GB SSD (cresce ~1 GB / 100k eventos retidos)
- **Bandwidth:** 100 GB/mês
- **Custo:** ~$5/mês (Hetzner CX11, DigitalOcean basic, Vultr standard)

Pra ~10k users e retenção longa: 4 GiB RAM + 100 GB SSD (~$15/mês).

---

## 4. Setup com strfry + Docker

### 4.1. VPS + DNS

1. Provisione uma VPS Linux (Ubuntu 24.04 LTS recomendado).
2. Aponte um subdomínio A/AAAA pra o IP. Ex.: `relay.seudominio.com`.
3. SSH como root, depois:

```bash
adduser drift && usermod -aG sudo drift
su - drift
sudo apt update && sudo apt -y upgrade
sudo apt -y install docker.io docker-compose-v2 ufw fail2ban
```

### 4.2. Firewall + fail2ban

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (certbot)
sudo ufw allow 443/tcp    # HTTPS/WSS
sudo ufw enable
sudo systemctl enable --now fail2ban
```

### 4.3. TLS via Caddy (mais simples que nginx + certbot)

Crie `/srv/drift-relay/docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - strfry

  strfry:
    image: dockurr/strfry:latest
    restart: unless-stopped
    expose:
      - "7777"
    volumes:
      - ./strfry-data:/app/strfry-db
      - ./strfry.conf:/etc/strfry.conf:ro

volumes:
  caddy_data:
  caddy_config:
```

Crie `/srv/drift-relay/Caddyfile`:

```
relay.seudominio.com {
    reverse_proxy strfry:7777
    encode gzip

    # NIP-11 relay info: cliente faz HTTP GET com Accept: application/nostr+json
    # Caddy passa direto, strfry trata.

    # Bloqueio simples de scrape massivo (não é DDoS-proof, mas filtra ruído)
    @abusive {
        header_regexp User-Agent (curl|wget|scrapy|axios.*Node)
    }
    rate_limit @abusive {
        zone abusive {
            key {remote_host}
            events 60
            window 1m
        }
    }
}
```

Caddy resolve TLS automaticamente via Let's Encrypt — sem `certbot`.

### 4.4. strfry config mínima

Crie `/srv/drift-relay/strfry.conf` (config completo em
[strfry.conf.example](https://github.com/hoytech/strfry/blob/master/strfry.conf)):

```hcl
db = "/app/strfry-db"

relay {
    bind = "0.0.0.0"
    port = 7777
    realIpHeader = "x-forwarded-for"

    info {
        name = "relay.seudominio.com"
        description = "Relay pessoal — Drift + Nostr geral"
        pubkey = "<seu_npub_em_hex>"   # opcional, NIP-11
        contact = "you@seudominio.com" # opcional
        software = "git+https://github.com/hoytech/strfry"
    }

    # Limites pra evitar abuso. Drift posts são ~2-4KB; spreads ~500B.
    # 65KB cobre caso extremo (post com muitos subposts).
    maxWebsocketPayloadSize = 131072
    maxFilterLimit = 500
    maxSubsPerConnection = 20
    maxEventBytes = 65536

    # Auth opcional (NIP-42). Default off — relay público.
    # Se ligar, configure allowlist por pubkey ou pague.
    # auth { ... }

    # Quanto tempo antes de dropar conexão idle
    autoPingSeconds = 55
}

events {
    # Retenção — em dias. 90 cobre uso típico Drift (90d > tipical
    # post lifecycle). Crescimento estimado: 100k eventos = ~1GB.
    maxAgeSeconds = 7776000  # 90 dias

    # Reject se evento tem tags de mais (anti-spam)
    rejectEventsNewerThanSeconds = 900   # 15min no futuro
    rejectEventsOlderThanSeconds = 94608000  # 3 anos no passado
}
```

### 4.5. Subir

```bash
cd /srv/drift-relay
mkdir -p strfry-data
sudo docker compose up -d
sudo docker compose logs -f
```

Depois de ~30s o Caddy obtém TLS e o relay tá online. Teste:

```bash
# NIP-11 info
curl -H "Accept: application/nostr+json" https://relay.seudominio.com/

# WSS handshake (websocat: brew/apt install websocat)
echo '["REQ","test",{"kinds":[1],"limit":3}]' | websocat wss://relay.seudominio.com/
```

Você deve ver eventos JSON ou um `EOSE` se ninguém publicou ainda.

---

## 5. Conectar Drift no seu relay

No app Drift:

1. Settings → **relays**
2. Click **+ adicionar relay**
3. Cole `wss://relay.seudominio.com`
4. Marque ☑ leitura ☑ escrita
5. Salvar

Drift vai começar a usar imediatamente. Pra remover seeds default,
desmarque-os ali — mas mantém pelo menos 1 ativo (defesa anti-eclipse).

### Anunciar o relay (NIP-65)

Manifesto §29 — **outros clientes Drift** descobrem que você usa esse
relay via NIP-65 (kind 10002). No app:

1. Settings → relays → **publicar lista (NIP-65)**
2. Confirma → Drift assina kind 10002 com seus relays read/write
   atuais e publica nos seeds.

Outros clientes Nostr-aware (Coracle, Iris, Snort, Damus...) que tiverem
seu npub vão preferir esses relays pra te alcançar. Manifesto §29 (compat
ecossistema) deixa de ser teórico.

---

## 6. Hardening operacional

### Backup

`strfry` guarda tudo em LMDB plano em `strfry-data/`. Backup é só `tar`
do diretório (offline pra consistência) ou snapshot do volume. Cron
diário é o suficiente:

```bash
# /etc/cron.daily/drift-relay-backup
#!/bin/bash
cd /srv/drift-relay
docker compose stop strfry
tar czf /var/backups/drift-relay-$(date +%F).tar.gz strfry-data/
docker compose start strfry
# Mantém últimos 7 backups
find /var/backups -name 'drift-relay-*.tar.gz' -mtime +7 -delete
```

### Atualizações

```bash
cd /srv/drift-relay
docker compose pull
docker compose up -d
```

Acompanhe [strfry releases](https://github.com/hoytech/strfry/releases)
pra mudanças de schema. Geralmente é seguro auto-pull semanal.

### Métricas

strfry expõe `prometheus` em `/metrics` se você habilitar. Pra hobby,
`docker stats drift-relay-strfry-1` resolve — RAM/CPU/disk no terminal.

---

## 7. Moderação (manifesto §17 — sem chave mestra)

Você é dono do seu relay. Pode:

- **Banir um pubkey** (rejeita eventos dele): config strfry `relay.writePolicy.plugin`
  com Lua/Python script. Veja [strfry policies](https://github.com/hoytech/strfry/blob/master/docs/plugins.md).
- **Allowlist por pubkey** (modo "convidados"): mesmo mecanismo.
- **Rate limit** por IP/pubkey: já no Caddy + strfry built-in.

**Manifesto §17 cuidado:** moderação no SEU relay é OK — você decide
o que serve do seu disco. NÃO confunda com "moderar a rede": outros
relays continuam servindo o que você bloqueou. Cliente Drift respeita
isso por design (filtros locais, score determinístico).

Se for relay público em geral, considere publicar uma policy de moderação
(README.md no GitHub do projeto + endpoint `/policy.html`). Manifesto §28
(transparência) aplica ao operador também.

---

## 8. Mirror Tor (opcional, manifesto §15)

Se quer que seu relay seja acessível via `.onion` (anti-censura por
país), suba um Hidden Service:

### 8.1. Instalar Tor

```bash
sudo apt -y install tor
```

### 8.2. Configurar Hidden Service

Edite `/etc/tor/torrc`, adicione:

```
HiddenServiceDir /var/lib/tor/drift-relay/
HiddenServiceVersion 3
HiddenServicePort 80 127.0.0.1:7777
```

```bash
sudo systemctl restart tor
sudo cat /var/lib/tor/drift-relay/hostname
# yourrelayxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.onion
```

### 8.3. Anunciar onion alias

NIP-11 relay info pode incluir um campo `onion` (extensão Drift). Ou
publique manualmente:

```
Clearnet: wss://relay.seudominio.com
Onion:    ws://yourrelayxxxx.onion
```

Quando o Drift Tauri+arti suportar `network_mode=tor`, users com seu
relay configurado verão o onion alias automaticamente.

---

## 9. Custos reais (referência)

| Recurso | Hobby (~100 users) | Médio (~1k users) | Grande (~10k users) |
|---|---|---|---|
| VPS | $5/mês | $15/mês | $40/mês |
| Bandwidth | inclusa | inclusa | $5-10/mês |
| Backup storage | $1/mês | $3/mês | $8/mês |
| Domínio | $1/mês | $1/mês | $1/mês |
| **Total** | **~$7/mês** | **~$20/mês** | **~$60/mês** |

A maior parte é VPS+IP. Disco e bandwidth são marginais até relay viral.

---

## 10. Referências

- [strfry docs](https://github.com/hoytech/strfry/tree/master/docs) —
  config, plugins, métricas
- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) —
  protocolo core
- [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) —
  relay information document
- [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md) —
  user relay list (kind 10002)
- [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) —
  auth (opcional, pra relay com allowlist)
- [`Docs/manifesto.md`](manifesto.md) §16, §17, §28, §29
- [`src/config/relays.ts`](../src/config/relays.ts) — seed list Drift
- [`src/lib/nip65.ts`](../src/lib/nip65.ts) — publishRelayList helper

---

## Histórico

- **2026-05-07 v0.1**: Doc inicial. Track C.1 (`roadmap-v060.md`).
  Cobre strfry + Docker + Caddy + Tor opcional. ~30min setup mínimo.
