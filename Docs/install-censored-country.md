# Instalando Drift em país censurado

**Audiência:** usuário final em jurisdição que filtra/bloqueia
internet (ISP, firewall nacional, store policies).
**Manifesto refs:** §15 (anti-censura por país), §17 (sem chave
mestra na distribuição), §28 (anonimato por design).

Este guia é honesto: não promete o que ainda não foi shipado. Cada
canal lista **status real** e **limitação concreta**. Se o seu
cenário cai num canal ⏳ (planejado), o caminho é VPN+PWA enquanto
Fase 6/7 não chega — não há atalho secreto.

---

## §1 Por que isso importa

Drift é um compromisso público (manifesto §15): "qualquer pessoa,
em qualquer país, com qualquer dispositivo, deve conseguir falar
sem pedir licença." Isso só vale se a **distribuição do cliente**
também resistir a censura — Play Store, App Store e DNS bloqueado
são vetores reais.

Por isso o projeto tem **múltiplos canais** de instalação. Você
escolhe o que cabe na sua ameaça.

---

## §2 Tabela canais

| Canal | Status (2026-05-21) | Quem deve usar | Limitações |
|---|---|---|---|
| **PWA browser** (`drift.vercel.app`) | ✅ shipped | Brasil, EUA, Europa, qualquer país sem bloqueio de DNS Vercel | Sem Tor; se ISP bloqueia o domínio, não abre |
| **PWA via VPN** | ✅ shipped (depende de VPN externa) | ISP bloqueia drift.vercel.app mas país tolera VPN | VPN é third-party — confia no provedor; pode ser bloqueada |
| **Tauri desktop + Tor (arti)** | ✅ source-build shipped; binários cross-platform via release | Jornalista/dissidente em país que tolera Tor; usuário com paciência pra build | Tor pode ser bloqueado em alguns países (China, Irã DPI); binários ainda não estão em store reproduzível |
| **F-Droid TWA (Android)** | ⏳ Fase 7 (manifest pronto, build reproduzível pendente) | Android sem Play Store; ativista; user que quer sideload auditável | Aguardando publicação F-Droid + reproducible build |
| **WebRTC P2P direto** | ✅ código shipped (Fase 6.1-6.3); UX de bootstrap ⏳ Fase 6.4 | País bloqueia Tor + ISP filtra; user com peer de confiança offline | Requer bootstrap peer (QR code, link, bundle) — não é zero-friction |
| **Sneakernet bundle (QR/JSON)** | ⏳ Fase 7 (PeersCard primitivo, bundle completo planejado) | Offline-first; sync entre devices sem internet | Latência alta (horas/dias); manual |
| **Bluetooth LE transport** | ⏳ Fase 7 (btleplug planejado, não iniciado) | Sync entre devices próximos sem rede | Range curto (~10m); apenas Tauri Android |

Legenda: ✅ shipped · ⏳ planejado (manifesto vinculante)

---

## §3 Step-by-step por cenário

### §3.1 "Eu uso Brasil/EUA/Europa sem restrição" → PWA básico

1. Abra `https://drift.vercel.app` no Chrome/Firefox/Safari atualizado
2. Aceite o prompt de "Instalar app" se aparecer (Add to Home Screen)
3. Crie identidade (gera nsec local; **exporte** o nsec antes de
   fazer qualquer ação destrutiva — manifesto §3, dispositivo
   descartável, identidade não)
4. Boot inicial: ~5-10s pra conectar aos relays seed

**Quando NÃO usar este canal:**
- Você não confia em `vercel.app` como host (Vercel é US-based —
  poderia ser pressionado a derrubar o domínio)
- Você quer resistir a request de takedown — neste caso, use
  Tauri+Tor (§3.3) ou aguarde F-Droid (§3.4)

Código: `src/` (build padrão); deploy: `vercel.json`.

---

### §3.2 "Meu ISP bloqueia drift.vercel.app" → VPN + PWA

Quando seu provedor filtra o domínio Vercel mas o país tolera VPN:

1. Instale uma VPN auditada (Mullvad, ProtonVPN, IVPN são bons
   defaults — pagamento Monero/cash possível em alguns). **NÃO** use
   VPN gratuita que loga.
2. Conecte ao endpoint mais próximo (latência importa pra Nostr WSS)
3. Abra `https://drift.vercel.app` normalmente
4. Marque "Add to Home Screen" — a PWA continua funcionando offline
   após o primeiro load (Service Worker do Workbox cache assets)

**Limitação honesta:** VPN é canal third-party. Se a VPN cair,
você cai. Se o país bloqueia VPN também, vá pra §3.3 ou §3.5.

---

### §3.3 "Meu país bloqueia o domínio E a VPN" → Tauri desktop + Tor

Status: source-build shipped (`Docs/tauri-setup.md`); binários
cross-platform disponíveis via GitHub Release (verificar SHA256SUMS).

**Source build (audit-friendly):**

1. Clone o repo: `git clone https://github.com/<owner>/Drift.git`
2. Install Rust + Tauri deps (ver `Docs/tauri-setup.md`)
3. `npm install && npm run tauri build`
4. Execute o binário gerado em `src-tauri/target/release/`
5. Settings → Transport → enable Tor (arti integrado embedded)

**Pré-built binary:**

1. Baixe da release GitHub mais recente (`v0.6.0-alpha.3+`)
2. **Verifique hash:** compare contra `SHA256SUMS` na release
3. Execute e habilite Tor em Settings

**Limitação honesta:**
- Tor é detectável por DPI agressivo (China GFW, Irã). Pluggable
  transports (obfs4, snowflake) NÃO estão integrados ainda — fica
  pra Fase 7 se demanda surgir
- F-Droid reproducible build ainda não shipped — você confia no
  binário compilado por um CI específico

Código: `src/lib/transport/tor.ts`, `src-tauri/src/tor/`. Doc:
`Docs/tauri-setup.md`, `Docs/transport-paths.md`.

---

### §3.4 "Eu quero Android sem Play Store" → F-Droid TWA (⏳ Fase 7)

**Status:** manifest pronto (`Docs/twa.md`, `Docs/fdroid.md`),
publicação F-Droid pendente, reproducible build em validação.

Quando shipar:

1. Abra F-Droid client (`https://f-droid.org`) — sideload do APK
   F-Droid se Play Store bloquear
2. Pesquise "Drift" no repo F-Droid oficial
3. Instale; verifique cert assinatura contra documento público
   do projeto

**Alternativa temporária:** TWA via Bubblewrap já antecipada via
CI (`twa.md`). APK pode ser baixado do GitHub Release. Sideload
manual (`Settings → Apps → Install unknown apps`).

**Limitação honesta:** TWA é wrapper de PWA — depende do domínio
hospedado responder. Se `drift.vercel.app` cair, TWA cai junto.
Fix correto: TWA apontar pra IPFS gateway (Fase 7).

Código: `twa/` (Bubblewrap config), `.github/workflows/twa.yml`.

---

### §3.5 "Tor bloqueado, VPN bloqueada" → WebRTC P2P (Fase 6)

**Status:** core shipped (6.1-6.3); UX de bootstrap (PeersCard QR)
em Fase 6.4. Hoje requer fricção:

1. Encontre **um peer Drift de confiança** (amigo, contato offline)
2. Esse peer abre Settings → Peers → mostra QR/bundle de bootstrap
3. Você escaneia QR (ou recebe JSON bundle via Bluetooth/USB)
4. Drift estabelece WebRTC direct connection com ICE/STUN/TURN
   (se peer-to-peer falha por NAT simétrico, TURN relay cobre)
5. A partir daí, sincroniza via Nostr DM signaling + peer-to-peer

**Limitação honesta:**
- Requer pelo menos 1 peer que já tenha Drift (bootstrap problem)
- WebRTC traffic pode ser bloqueado por DPI agressivo (mais raro
  que Tor, mas existe)
- Bundle offline (sneakernet) ainda é Fase 7

Código: `src/lib/transport/webrtc/` (15 arquivos), signaling em
`webrtc-signaling-nostr.ts` (NIP-44 + kind 1059). Doc:
`Docs/webrtc-6.4-plan.md`, `Docs/fase-6-roadmap.md`.

---

## §4 Verificação de integridade — sempre

Não importa qual canal você usa, **verifique o build** antes de
inserir nsec:

- **PWA:** cheque SRI hashes no HTML servido (`<script integrity="sha384-...">`)
  — baseline em `Docs/ci/sri-baseline.md`
- **Binário:** sha256 contra `SHA256SUMS` na release
- **APK:** signature cert contra docs do projeto
- **Source build:** `git log` review + auditoria visual antes de `npm install`

Manifesto §17 promete: cliente oficial nunca tem chave mestra. Mas
você confia no canal que entregou o cliente — verificação é a
defesa.

---

## §5 Quando NADA funciona

Cenários edge: país com firewall total (Coreia do Norte), device
locked-down sem sideload, etc. Roadmap honesto:

- **Bluetooth LE transport** (Fase 7): sync entre devices próximos
  sem rede
- **Sneakernet bundle** (Fase 7): JSON exportável via USB/SD card
- **IPFS pin** (Fase 7): conteúdo viral replicado fora do controle
  do operador original

Se você está nesse cenário hoje (2026-05-21), o caminho é:
1. Sair do país com o nsec exportado
2. Continuar a identidade em outro device/canal (manifesto §3:
   identidade é portável, dispositivo é descartável)

Não há feature secreta. O projeto está sendo construído em público.

---

## §6 Cross-refs

- Manifesto: `Docs/manifesto.md` (§15, §17, §28)
- Fase 6 roadmap: `Docs/fase-6-roadmap.md`
- Transport paths: `Docs/transport-paths.md`
- Threat model Tor/WebRTC: `Docs/webrtc-threats.md`
- Build reproduzível: `Docs/build-reproducible.md`
- Run your own relay: `Docs/run-your-own-relay.md`
- Tauri setup: `Docs/tauri-setup.md`
- F-Droid + TWA: `Docs/fdroid.md`, `Docs/twa.md`

---

*Última atualização: 2026-05-21 · pt-BR · Robin (research/docs persona) ·
Drift Fase 5.x + Fase 6 em curso · Fase 7 vinculante via manifesto §ROADMAP.*
