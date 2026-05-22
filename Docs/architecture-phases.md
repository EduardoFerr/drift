# Architecture Phases — Fase 6 + Fase 7 (épicos implementáveis)

**Propósito:** mapear compromissos do manifesto (§15, §16, §17, §21,
§28) em épicos concretos com status, tasks dependentes e reopener.
Não é roadmap mutável — é **decomposição arquitetural**. Roadmap
mutável fica em `Docs/fase-6-roadmap.md` e `BACKLOG.md`.

**Manifesto vinculante:** §ROADMAP (manifesto.md, linha ~950):
> "Fase 6 + Fase 7 não são 'talvez'. São 'vão acontecer'."

Cross-refs: `Docs/fase-6-roadmap.md`, `Docs/manifesto.md`,
`Docs/webrtc-6.4-plan.md`, `Docs/fdroid.md`, `Docs/twa.md`,
`Docs/blob-distribution.md`, `Docs/transport-paths.md`.

---

## Fase 6 — Cliente nativo + transportes alternativos

Capacidade técnica do manifesto §15 (anti-censura por país) +
§21 (anonimato). Fase 6 trata da CAPACIDADE; Fase 7 trata da
DISTRIBUIÇÃO.

### Épico 6.1: Tauri shell + arti (Tor embedded)

- **Manifesto:** §15 anti-censura, §21 anonimato (Tor masks IP do
  publisher), §17 sem chave mestra (binary auditable)
- **Status:** ✅ source build shipped (`src-tauri/`, `Docs/tauri-setup.md`);
  arti integrado, smoke test e2e VERIFIED 2026-05-01; binários
  cross-platform via release (`v0.6.0-alpha.3+`)
- **Tasks dependentes (ship → distribuir):**
  - F-Droid manifest finalizado → Épico 7.2
  - Build reproduzível validado (`Docs/build-reproducible.md`) → Épico 7.2
  - Pluggable transports (obfs4/snowflake) se demanda surgir
  - DPI evasion documentation
- **Reopener:** demanda de user em país com Tor blocked (China, Irã)
  com DPI agressivo → priorizar pluggable transports

### Épico 6.2: WebRTC P2P transport

- **Manifesto:** §15 (alternativa quando Tor blocked), §20 (peer
  discovery resiliente)
- **Status:** ✅ core shipped (6.1a + 6.1b + 6.2 + 6.3 fechadas em
  `[Unreleased]`); 15 arquivos em `src/lib/transport/webrtc/`
  (peer/pipeline/state/health/reconnect/discovery/boot/ice/
  rateLimit/config/types/index/peerLink/followsDiscovery/bundle);
  signaling via NIP-44 + kind 1059 (`webrtc-signaling-nostr.ts`)
- **Tasks dependentes:**
  - Random walk pós-CONNECTED (ver `known-limitations.md` §8) → Fase 6.4
  - Cluster detection contínuo (não só entry) → Fase 6.4
  - Telemetria local de path diversity (sem leak fora device)
- **Reopener:** telemetria mostrar eclipse attempt real OU PeersCard
  UX validado em campo

### Épico 6.3: Multi-transport orchestration

- **Manifesto:** §15 (failover automático WSS → Tor → WebRTC quando
  detect censorship)
- **Status:** ✅ shipped — `src/lib/transport/index.ts` itera
  transportes ativos sem saber qual é qual; health-check + reconnect
  + TURN cobre symmetric NAT / 4G CGN
- **Tasks dependentes:**
  - UX de transport switching (Settings → Transport tier badges)
  - Auto-fallback policy quando WSS detect filter (probe sinaliza)
  - Per-transport metrics em local dashboard (debug-only)
- **Reopener:** Probe detection algorithm refinado OR user report
  de censorship não detectada

### Épico 6.4: PeersCard UI (bootstrap P2P)

- **Manifesto:** §15 (user precisa descobrir peer sem internet
  central), §16 (mecânica social de propagação)
- **Status:** ⏳ em curso — primitivos em `src/components/Peers/`
  scaffolded; QR code generation via `qrcode` lib; bundle
  offline (JSON exportável) parcial
- **Tasks dependentes:**
  - QR code com peer identity + bootstrap relay subset
  - Link direto `drift://peer/<npub>?bundle=<base64>`
  - Bundle offline JSON serializable (peer registry snapshot)
  - Auto-discovery via mDNS quando same-LAN (Tauri only)
  - Test e2e PC ↔ celular via QR scan
- **Reopener:** UX validation com user real em scenario offline-first

---

## Fase 7 — Distribuição (cliente + protocolo)

Garantia política do manifesto §16 (disponibilidade distribuída) +
§17 (sem chave mestra na distribuição). Fase 6 entrega a CAPACIDADE;
Fase 7 entrega o cliente nas mãos do user sem depender de
intermediário com poder de censura.

### Épico 7.1: TWA Android (Bubblewrap) — ANTECIPADO

- **Manifesto:** §15 (Android é majoritário no Sul Global), §17
  (sideload sem Play Store policies)
- **Status:** ✅ antecipada — Bubblewrap CI shipped
  (`.github/workflows/twa.yml`, `Docs/twa.md`); APK gerável da
  release; sideload manual funciona
- **Tasks dependentes:**
  - Play Store opcional (não bloquear distribuição se rejeitado)
  - TWA → IPFS gateway alternativa quando `drift.vercel.app` cair
- **Reopener:** Play Store rejection event OR Vercel domain takedown

### Épico 7.2: F-Droid manifest + reproducible build

- **Manifesto:** §17 (build auditável), §15 (Android sem Google
  account)
- **Status:** ⏳ manifest pronto (`Docs/fdroid.md`); reproducible
  build em validação
- **Tasks dependentes:**
  - F-Droid metadata YAML completo
  - Reproducible build CI (mesma toolchain → mesmo hash)
  - Submission pra repo F-Droid oficial
  - Signing cert documentation pública
- **Reopener:** F-Droid submission accepted OR reproducible build
  verified by external auditor

### Épico 7.3: IPFS pin finalize (helia integration)

- **Manifesto:** §16 (disponibilidade distribuída de conteúdo
  viral além dos relays)
- **Status:** ⏳ design em `Docs/blob-distribution.md`; helia
  scaffolded em `package.json`; integração pin opportunistic
  pendente
- **Tasks dependentes:**
  - `src/lib/pin.ts` implementation (pin post + blobs quando
    score > threshold)
  - UX: badge "pinned to IPFS" + unpin manual
  - Garbage collection policy (auto-unpin quando score cair)
  - Tauri-only (browser CORS limita peers)
- **Reopener:** primeiro post viral relevante (score > X) OR
  relay takedown event

### Épico 7.4: Sneakernet bundle (QR/JSON export)

- **Manifesto:** §16 (offline-first quando rede falha
  completamente)
- **Status:** ⏳ PeersCard primitivo cobre bootstrap (Épico 6.4);
  bundle completo (posts + identity + peer registry exportável
  pra USB/SD) planejado
- **Tasks dependentes:**
  - JSON schema do bundle (versioned, forward-compat)
  - Compression (gzip/brotli antes de QR encode)
  - Multi-QR pra bundles grandes (>3KB)
  - Import flow + conflict resolution
- **Reopener:** demanda em scenario offline-first concreto
  (jornalista em zona de conflito, ativista em país com internet
  totalmente cortada)

### Épico 7.5: BLE transport (offline sync entre devices próximos)

- **Manifesto:** §15 (último recurso quando WSS/Tor/WebRTC todos
  bloqueados), §16 (sync local sem internet)
- **Status:** ⏳ não iniciado; `btleplug` (Rust BLE lib) candidato
- **Tasks dependentes:**
  - Tauri-only (browser não tem Web Bluetooth raw)
  - Pairing UX (proximity-based, no central server)
  - Rate limit + battery considerations
  - Threat model BLE (Bluetooth attacks documented)
- **Reopener:** scenario validado em campo (event-based mesh,
  protest comms, disaster recovery)

### Épico 7.6: Run-your-own-relay docs + tooling

- **Manifesto:** §17 (operador não depende de relay central),
  §16 (relay diversity)
- **Status:** ✅ parcialmente shipped (`Docs/run-your-own-relay.md`,
  `Docs/run-your-own-relay-with-ai.md`); tooling de discovery
  em UI (Settings → Relays → Descobrir) shipped
- **Tasks dependentes:**
  - Curated relay list pública versionada (`Docs/curated-relays-*.json`)
  - Docker compose / 1-click deploy pra strfry/nostream
  - Tier badge UI (none/manual/ai-assisted/ai-automated) já
    shipped em Settings > Relays
  - Discovery via NIP-65 já shipped (`src/lib/nip65.ts`)
- **Reopener:** demanda de operador novo OR relay takedown event

---

## §3 Visão consolidada

| Épico | Manifesto | Status | Block |
|---|---|---|---|
| 6.1 Tauri+Tor | §15 §21 | ✅ source/binary | Épico 7.2 (F-Droid build) |
| 6.2 WebRTC P2P | §15 §20 | ✅ core | Épico 6.4 (PeersCard UX) |
| 6.3 Multi-transport | §15 | ✅ | Telemetria UX |
| 6.4 PeersCard | §15 §16 | ⏳ em curso | Bundle offline |
| 7.1 TWA Android | §15 §17 | ✅ antecipado | — |
| 7.2 F-Droid | §15 §17 | ⏳ manifest pronto | Reproducible build |
| 7.3 IPFS pin | §16 | ⏳ design | Helia integration |
| 7.4 Sneakernet | §16 | ⏳ primitivo (6.4) | Bundle schema |
| 7.5 BLE | §15 §16 | ⏳ não iniciado | Demanda concreta |
| 7.6 Run-relay | §17 §16 | ✅ parcial | Curated list versioning |

---

*Última atualização: 2026-05-21 · Robin (research/curadoria/docs persona) ·
Decomposição arquitetural de Fase 6 + Fase 7. Roadmap mutável em
`fase-6-roadmap.md` + `BACKLOG.md`.*
