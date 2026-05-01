# Sprint 7 — Smoke test e2e do Tor real

> Manual · executor: você (Eduardo) · ~6-8h estimadas
> Objetivo: validar end-to-end que `cargo tauri build --features arti`
> realmente roteia tráfego pra relays Nostr via circuit Tor, com IP do
> user invisível pro relay.
>
> Critério de aceite: manifesto §15 (anti-censura por país) deixa de ser
> *asserted* e vira *verified*.

---

## Por que não dá pra automatizar

Sprint 7 exige:
- Toolchain Rust local com `cargo tauri build` funcional
- Wireshark ou `tcpdump` (captura de pacotes em interface real)
- Janela de tempo pra rodar (10-15min só pra primeira build, +
  validação manual ~30min)
- Olho humano confirmando "tráfego sai pra IPs de guards Tor, não pros
  relays Nostr direto"

CI roda sandbox sem GUI, sem captura de pacote real, sem internet
genuína (proxy NAT do GitHub runner mascara o que viria a ser
"clearnet"). Por isso ficou de fora dos 9 sprints automatizados.

---

## Pré-requisitos

### 1. Rust toolchain

Você já tem (cargo 1.95.0 confirmado em sessões anteriores). Se mudou
de máquina, instalar via [rustup.rs](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Windows: baixar rustup-init.exe do site
```

Verificar:
```bash
cargo --version
# deve mostrar cargo 1.85+ (1.95 é o que tem hoje)
```

### 2. Tauri CLI

```bash
npm install --save-dev @tauri-apps/cli
# Já está em devDependencies do projeto.
```

### 3. Tauri build deps (Linux)

Se rodar em Linux/WSL:
```bash
sudo apt-get install -y \
  libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev libsoup-3.0-dev pkg-config
```

Em Windows: já vem com WebView2 instalado (Windows 10+). Em macOS:
WebKit nativo. Sem deps adicionais nesses 2.

### 4. Wireshark OU tcpdump

**Recomendação**: Wireshark (GUI, filtros visuais).

Download: <https://www.wireshark.org/download.html>

Alternativa CLI no Linux/macOS:
```bash
sudo apt-get install tcpdump
# ou
brew install tcpdump
```

---

## Etapa 1 — Build do binário Tauri com `--features arti`

```bash
cd C:\Users\Eduardo\Workspace-vscode\Drift

# 1.1. Build do PWA (necessário pro Tauri embarcar)
npm run build
# Output: dist/ atualizado

# 1.2. Build do Tauri com feature arti
cd src-tauri
cargo tauri build --features arti
```

**Tempo esperado:**
- Primeira build cold: 10-15min (cargo baixa ~100 crates do arti
  workspace + tauri-build + tokio + arti-client transitive)
- Builds subsequentes (incremental): ~30s-2min

**Output esperado:**
- Windows: `src-tauri/target/release/drift.exe`
- Linux: `src-tauri/target/release/drift` + `src-tauri/target/release/bundle/{deb,appimage}/`
- macOS: `src-tauri/target/release/bundle/macos/Drift.app`

Se a build falhar com erro de MSRV (deps requerendo `rustc 1.X+`):
upgrade rust local com `rustup update stable`.

---

## Etapa 2 — Configurar relay Nostr alvo (escolha uma)

### Opção A — Relay público clearnet (mais simples)

Já está configurado nos seeds: `wss://relay.damus.io`, `wss://nos.lol`,
etc. Vamos provar que tráfego pra ESSES relays sai via Tor (em vez de
direto), invertendo a expectativa: **se Tor está funcionando, IPs de
destino observados em rede são guards Tor, não os IPs públicos dos
relays**.

**Recomendado pra primeiro smoke** — sem setup extra.

### Opção B — Relay onion `.onion` (validação mais profunda)

Roda relay Nostr local exposto via Tor hidden service:

```bash
# 1. Instalar Tor + relay nostr-rs-relay
sudo apt-get install tor
cargo install nostr-rs-relay

# 2. Configurar hidden service no /etc/tor/torrc
echo "HiddenServiceDir /var/lib/tor/drift_relay/
HiddenServicePort 80 127.0.0.1:8080" | sudo tee -a /etc/tor/torrc

# 3. Restart tor
sudo systemctl restart tor

# 4. Pegar o endereço .onion gerado
sudo cat /var/lib/tor/drift_relay/hostname
# Output: xxxxx.onion

# 5. Subir nostr-rs-relay em 127.0.0.1:8080
nostr-rs-relay --db ./relay.db
```

**Esta opção fica pra depois** se quiser validação completa de
`network_mode: 'onion-only'`. Pra smoke inicial, opção A basta.

---

## Etapa 3 — Iniciar captura de tráfego

### Wireshark

1. Abrir Wireshark
2. Selecionar a interface ativa (geralmente `Ethernet`/`Wi-Fi`)
3. Aplicar filtro de captura: `tcp and not port 22 and not port 80 and not host github.com`
   (filtra noise de SSH/web/git)
4. Clicar **Start**

### tcpdump (CLI alternativa)

```bash
# Linux
sudo tcpdump -i any -nn 'tcp and not port 22 and not host github.com' -w /tmp/drift-tor.pcap

# macOS
sudo tcpdump -i en0 -nn 'tcp and not port 22 and not host github.com' -w /tmp/drift-tor.pcap

# Deixa rodando em background; Ctrl+C ao final
```

---

## Etapa 4 — Smoke test funcional

### 4.1. Boot em clearnet (baseline)

1. Executar binário Tauri:
   ```bash
   # Windows
   .\src-tauri\target\release\drift.exe
   # Linux
   ./src-tauri/target/release/drift
   # macOS
   open ./src-tauri/target/release/bundle/macos/Drift.app
   ```

2. App abre. **DevTools auto-aberta em dev** — em release build, abrir
   manualmente: `Ctrl+Shift+I` (Win/Linux) ou `Cmd+Opt+I` (macOS).

3. **Console deve mostrar boot normal** (sem mensagem de Tor —
   `network_mode` é `clearnet` por default):
   ```
   [bootstrap] DB inicializado · modo: opfs
   [bootstrap] identidade ativa: npub1...
   [sync] subscribe iniciado em 4 relays
   ```

4. **No Wireshark/tcpdump**: ver tráfego TCP saindo pra IPs públicos
   dos relays Nostr. Resolver os IPs:
   ```bash
   nslookup relay.damus.io
   # Anotar IPs pra confirmar como baseline
   ```

   Esperado: tráfego pra esses IPs visível na captura.

### 4.2. Trocar pra modo Tor

5. Settings → modo de rede → clicar **🧅 tor**

6. Modal aparece: *"Trocar para Tor exige recarregar a aba para
   aplicar. Recarregar agora?"*

7. Clicar **OK** — app recarrega.

### 4.3. Validar bootstrap Tor

8. **Console deve mostrar bootstrap Tor**:
   ```
   [bootstrap] DB inicializado · modo: opfs
   [bootstrap] identidade ativa: npub1...
   [bootstrap] Tor conectado · proxy=127.0.0.1:XXXXX · circuits=1
   [TorWebSocket] WebSocket implementation override applied
   [sync] subscribe iniciado em 4 relays
   ```

9. **Tempo esperado pra `Tor conectado`**: 10-30s (download de directory
   consensus na primeira boot; cached em `~/.arti/cache/` pra próximas
   ~5s).

10. Se aparecer `Tor não conectou (state=error, err=...)` no console:
    - Log do erro específico (provavelmente firewall bloqueou conexão
      pra guards Tor — testar de outra rede)
    - Banner amber em Settings deve aparecer também

### 4.4. Validar tráfego routeia via Tor

11. **Wireshark/tcpdump**: filtrar pra ver apenas conexões TCP novas
    desde o reload:
    ```
    Filtro Wireshark display: tcp.flags.syn==1 and tcp.flags.ack==0
    ```

12. **Esperado**:
    - **Conexões pra IPs de guards Tor** visíveis (porta 9001 ou 443
      tipicamente; IPs vão variar — não são os mesmos do passo 4)
    - **ZERO conexões diretas pros IPs dos relays Nostr** (que você
      anotou no passo 4)
    - Se aparecer conexão direta pra IP do relay clearnet com SNI
      `relay.damus.io` ou similar → **VAZAMENTO**, manifesto §15
      quebrado

13. Verificar lista de guards Tor conhecidos pra cross-reference:
    ```bash
    # Lista pública dos relays Tor (pra confirmar que IPs vistos são guards)
    curl https://onionoo.torproject.org/details?type=relay | head -100
    ```

### 4.5. Funcional

14. Voltar ao app. Feed deve carregar normalmente:
    - Eventos chegando (5-30s primeiro frame via Tor — mais lento que
      clearnet)
    - Counter "X eventos" no header sobe
    - Toggle pra `clearnet` + reload → tráfego volta direto pros relays
      (cross-check)

### 4.6. Console verificações

15. Em DevTools console, executar:
    ```js
    await import('/src/lib/transport/tor.ts').then(m => m.torStatus())
    ```
    Esperado:
    ```js
    {
      state: 'connected',
      circuitCount: 1,
      lastError: null,
      proxyAddr: '127.0.0.1:XXXXX'
    }
    ```

16. `localStorage.driftWebRTC` (DEV bridge) — não usado no smoke,
    mas pode validar peers state:
    ```js
    window.driftWebRTC?.getPeers()
    // [] vazio se rodou só feed; tem peers se abriu mapa de spread
    ```

---

## Etapa 5 — Documentar resultado

Crie `Docs/sessions/sprint7-smoke-2026-XX-YY.md` (ou data atual) com:

```markdown
# Sprint 7 — Smoke test e2e Tor (resultado)

> Executado em: YYYY-MM-DD
> Versão: v0.6.0-alpha.X (ou commit hash)
> Plataforma: Windows 10 / Linux Ubuntu 22.04 / macOS 14
> Rede: residencial 1Gbps / 4G / VPN-X

## Resultado

✅ PASS / ❌ FAIL

## Detalhes

- Tempo de bootstrap Tor: XXs (primeira boot) / XXs (cached)
- IPs de guards Tor observados: [lista]
- IPs de relays Nostr observados em conexão direta: [vazio se PASS]
- Issues encontradas: [lista, se houver]

## Screenshots

- Console: `[bootstrap] Tor conectado` (anexar print)
- Wireshark: tráfego TCP filtrado (anexar print)

## Conclusão

Manifesto §15 (anti-censura por país) — VERIFIED / asserted only.
```

Após execução bem-sucedida, atualizar:
- `Docs/webrtc-6.4-plan.md §6 Próximos passos`: marcar smoke test e2e ✅
- `Docs/runtime-pwa-vs-tauri.md`: matriz Tor `🟡` → `✅` (com nota da data
  do smoke)
- `CLAUDE.md` rodapé: bumpar status

---

## Troubleshooting

### `cargo tauri build` falha com "rustc X.Y is not supported"

Algum crate transitivo subiu MSRV. Atualizar Rust:
```bash
rustup update stable
```

### `[bootstrap] Tor não conectou (state=error, err=arti bootstrap falhou: ...)`

Possíveis causas:
1. **Firewall bloqueando porta 443/9001** — testa de outra rede ou via VPN
2. **Sem internet pra directory authorities** — confirmar conexão
3. **Cache corrompido em `~/.arti/`** — deletar diretório e tentar de novo

### Wireshark não captura tráfego

- Linux: precisa `sudo wireshark` ou adicionar usuário ao grupo `wireshark`
- Windows: instalar Npcap (vem junto com Wireshark instalador)
- macOS: precisa permissão BPF — Wireshark pede no primeiro boot

### App congela ao trocar pra Tor

Conhecida em Tauri 2.x se signaling boot async exception. Aceitar
~30s de espera; se passar disso, verificar console pra erro
específico. Reload (Ctrl+R) tipicamente recupera.

### Tráfego suspeito direto pros relays mesmo em modo Tor

Vazamento confirmado de §15. Investigar imediatamente:
1. Verificar console: `[TorWebSocket] WebSocket implementation override
   applied` aparece? Se não, install hook não rodou.
2. `useWebSocketImplementation` pode ter sido chamado *depois* do
   SimplePool inicializar — neste caso, reload força re-init.
3. Algum import paralelo de `nostr-tools/relay` (não `nostr-tools/pool`)
   pode escapar do hook — investigar Sprint 8 follow-up.

---

## Próximas ações pós-smoke

Se PASS:
- Tag `v0.6.0-alpha.3` consolidando os 9 sprints
- Atualizar README/CLAUDE marcando §15 verified
- Considerar release Tauri Linux binary signed (Sprint operacional)

Se FAIL:
- Issue detalhada com screenshot Wireshark + console log
- Não tagar release até resolver

---

*Sprint 7 do roadmap pós-auditoria · 2026-05-01 · `Docs/webrtc-6.4-plan.md §7` complementa este doc*
