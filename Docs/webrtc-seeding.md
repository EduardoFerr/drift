# WebRTC Seeding — Proof of Interest

**Fases**: 6.1-6.3 (transporte WebRTC — capacidade técnica) + 7.1 (Proof of Interest seeder — distribuição via cliente).

Blueprint pra transformar dispositivos Drift em **relays Nostr efêmeros via WebRTC**, ativados por interesse contextual (abrir mapa de espalhamento de um post → celular vira seeder daquela árvore de eventos).

Origem: análise da arquitetura proposta numa conversa externa, refinada contra invariantes do Drift e manifesto.

## TL;DR

Quando o user abre `useSpreadMap(postId)`:
1. Cliente abre DataChannel WebRTC com peers conhecidos do post
2. Serve eventos (POST + SPREADS + BURIES) do SQLite local sob demanda
3. Buffer circular só dos dados visíveis no mapa
4. Cleanup do hook = encerra socket, libera CPU/bateria

Outros usuários abrindo o mesmo mapa **fazem bootstrap direto do peer** em vez de bater nos relays WSS centrais. Quanto mais popular um post, mais nós orgânicos o servem. **Resolve o problema de cold-start em conteúdo viral sem depender de servidor central** (manifesto §16).

## Compatibilidade com manifesto

### Fortalece

- **§12 Múltiplos Transportes** — materialização concreta do compromisso de Fase 6 (transporte abstrato com WSS / Tor / WebRTC)
- **§16 Disponibilidade Distribuída** — literalmente a frase do manifesto: *"Espalhar = seedear: quem espalhou um post se compromete (no cliente oficial) a republicá-lo se um par solicitar."* Hoje é apenas re-broadcast oportunista por `addRelay()`. PoI vira seeding ativo em tempo real
- **§15 Anti-Censura por País** — peers servindo dados sem depender de WSS clearnet bloqueado pelo Estado
- **§20 Resistência a Isolamento** — path diversity scoring (já compromisso explícito do invariante #14 *"vivem dentro do transport WebRTC"*)

### Tensiona — adaptações obrigatórias

- **Invariante #14 (sem discovery paralelo)** — proposta original sugere *"relay de diretório"* anunciando pubkey + endpoint, o que viraria protocolo paralelo. **Adaptação**: usar **NIP-65 estendido** (relay list anuncia que oferece WebRTC) + handshake via **DM cifrado NIP-44**. Sem kind novo. Manifesto §12 já indica esse caminho: *"signaling via Nostr (publica oferta como evento Drift, par responde via DM cifrado), conexão direta após handshake"*
- **§28 Privacidade pelo Mínimo** + nota explícita do §16 — *"em modo paranoia, seeding é desligado por padrão"*. **Adaptação**: opt-in granular (ver §"Modos operacionais" abaixo)

### Não tensiona

- **§11 sem afinidade** — PoI serve dados, não personaliza ranking
- **Invariante #2 optimistic não persiste** — SQLite servido via WebRTC é leitura. Eventos vindos por DataChannel ainda passam por `onNostrEvent` + Schnorr verify (invariante #5). Sem exceção.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│ Cliente Drift (PWA / TWA / Tauri)                           │
│                                                              │
│   useSpreadMap(postId) ──── trigger ────┐                   │
│                                          ▼                   │
│   pin.ts → posts pinados ──── trigger ──► seeder.ts         │
│                                          │                   │
│   ┌──────────────────────────────────────┼───────────────┐  │
│   │ transport/webrtc.ts (Fase 6)          │              │  │
│   │   • signaling: NIP-44 DM via          │              │  │
│   │     transport/wss.ts                  │              │  │
│   │   • DataChannel abertos por peer       │              │  │
│   │   • peerRegistry: path diversity §20  │              │  │
│   └────────────────────────────────────────┼──────────────┘ │
│                                            │                 │
│                                       SQLite WASM            │
│                                       (posts/spreads/buries) │
└──────────────────────────────────────────────────────────────┘
```

`seeder.ts` (Fase 7.1) é a camada de **policy** sobre `transport/webrtc.ts` (Fase 6.1):
- Decide quando ligar/desligar seeding (`startSeeding(postId)` / `stopSeeding(postId)`)
- Aplica gating de bateria + rede + opt-in
- Mantém buffer policy (TTL 5min após cleanup do mapa)

## Sinergia com features existentes

PoI é **extensão natural de `rebroadcast.ts`**, não paralela:

| Hoje (`rebroadcast.ts`)         | Com Proof of Interest                          |
|--------------------------------|------------------------------------------------|
| Trigger: `addRelay()` (raro)   | Trigger: abrir mapa ou pin                     |
| Destino: relay novo via WSS    | Destino: peer WebRTC sob demanda               |
| Conjunto: todos eventos do user| Conjunto: árvore do post (buffer circular)     |
| Modo: fire-and-forget batch    | Modo: socket vivo enquanto mapa aberto         |

A query de `rebroadcast.ts:91-109` já sabe selecionar "post + spreads + buries do user". PoI é a **versão dirigida por demanda** disso — mesmo SQL, escopo de um `post_id`.

`useSpreadMap` é o gatilho perfeito (mount → abre socket; cleanup → fecha socket). Encaixe limpo, sem modificar a UX existente.

`probe.ts` (anti-eclipse) se beneficia: peers WebRTC entram no probe sample com mesmo critério (path diversity scoring §20).

`cache.ts` precisa de regra adicional: posts com seeding ativo não são despejados durante a sessão (similar ao que `pinned` já faz).

## Modos operacionais (opt-in granular)

Default = `lan-wifi-only` resolve simultaneamente bateria + privacidade IP parcial.

| Modo            | Quando seedeia                               | Privacidade IP                |
|-----------------|----------------------------------------------|-------------------------------|
| `off`           | Nunca                                        | N/A                           |
| `lan-wifi-only` | Wi-Fi + bateria > 30% (default)              | Limitada à LAN                |
| `always-on`     | Sempre que `useSpreadMap` ativo              | Vaza IP via ICE candidates    |
| `relay-mode`    | TURN-only, sem ICE direto                    | Equivalente a usar TURN       |
| `tor-mode`      | Tor + WebRTC mutuamente exclusivos           | Anonimato Tor preserved       |

Gating técnico:
- `navigator.connection.type === 'wifi'` (Network Information API)
- Battery API → `level > 0.3 && !charging.discharging` ou `charging`
- Service Worker em Android é morto pelo OS sob doze mode → aceitar como limite, não combater

## Sub-fases concretas

### Fase 6.1 — `transport/webrtc.ts` esqueleto

- **6.1a-A** ✅ — `matchFilter` NIP-01 + cobertura de tests pré-6.1a (2026-04-28).
- **6.1a-B** ✅ — `webrtc-signaling-mock` BroadcastChannel pra smoke test local (2026-04-28).
- **6.1a-C** ✅ — `transport/webrtc.ts` core implementado (2026-04-29, 432 LOC): `publish`/`subscribe`/`health` + `RTCPeerConnection` lifecycle, pipeline §5 com kind check pré-verify, `pagehide` cleanup, `outboundQueue` reset em failed/closed. DEV bridge `window.driftWebRTC` em `src/main.tsx`. Apenas mock signaling — real fica pra 6.1b. Checklist de aceite em [webrtc-6.1a-c-checklist.md](webrtc-6.1a-c-checklist.md) (Barney).
- **6.1b** — Signaling real via Nostr DM NIP-44 sobre `wssTransport`. Teste: peer A publica oferta, peer B responde, DataChannel abre. Plano em [webrtc-6.1b-plan.md](webrtc-6.1b-plan.md).

### Fase 6.2 — Peer registry + path diversity

- `peerRegistry.ts`: store Zustand de peers conhecidos. Path diversity score (§20). Teste puro Vitest da função de scoring.

### Fase 6.3 — STUN/TURN policy

- Config + fallback. STUN gratuito (Google / Cloudflare); TURN comunitário ou modo relay-mode. Teste manual: NAT simétrico → TURN; NAT cone → STUN direto.

### Fase 7.1 — Proof of Interest seeder

- **7.1a** — `seeder.ts`: liga/desliga seeding por `postId`. Hooks: `useSpreadMap` chama `startSeeding(postId)` no mount, `stopSeeding(postId)` no cleanup. Teste: count de seeds ativos
- **7.1b** — Buffer policy + battery/network gating. Teste: mock Battery API < 20% → seeding pausa
- **7.1c** — UI: indicador "você está servindo N posts a M peers" (transparência §28)
- **7.1d** — Integração com `probe.ts`: peers WebRTC entram no probe pool

Cada sub-fase isolável com critério de aceite verificável.

## Riscos não-óbvios

| Risco | Mitigação |
|-------|-----------|
| **Sybil envenenando dados** — 1000 peers fake servindo eventos com id falso | Invariante #5 cobre — Schnorr verify ANTES de persistir. Adversário não tem nsec do autor → não assina alternativa válida com mesmo id |
| **Withholding** — peer entrega só subset dos dados | Probe sobre WebRTC (extensão de `probe.ts`), path diversity scoring §20 |
| **Privacidade IP via ICE** — peer A descobre IP de peer B mesmo com TURN | Modo `relay-mode` força TURN-only; Tor + WebRTC mutuamente exclusivos no `tor-mode`; UI avisa explicitamente ao ativar (§28); default `lan-wifi-only` reduz superfície |
| **Bateria/dados móveis** | Gating Battery API > 30% + Wi-Fi only (default). Aceitar Service Worker doze mode como limite |
| **Sybil-amplificação no diretório** | Por isso **descartar** diretório próprio e usar NIP-65 + handshake DM. Custo de Sybil sobe (precisa relay aceitando spam) |
| **DataChannel como overlay scan** — adversário rastreia quem seedeia o quê | Cover traffic é caro; documentar como limite explícito (§4 *"não somos mixnet"*) |
| **Liability legal** — seedear conteúdo de terceiros pode atribuir responsabilidade | Opt-in explícito + `content-warning` §27 respeitado (não seedeiar `nsfw-unmarked` sem ack) |

## Pré-condições

- **PWA pode entregar parte** (browser tem WebRTC) mas Service Worker em background no Android tem limites severos
- **Plenitude exige Tauri/TWA** — Fase 6 (cliente nativo) ou Fase 7 (TWA já antecipada). Manifesto consente
- Reusar `transport/wss.ts` como camada de signaling (sem reinventar)
- `crossOriginIsolated === true` para SharedArrayBuffer (já garantido no Vercel via COOP/COEP)

## Referências

- Manifesto §12, §15, §16, §20, §28
- Invariantes #2, #5, #14 (CLAUDE.md)
- `src/lib/transport/index.ts` (interface), `src/lib/transport/wss.ts`
- `src/lib/rebroadcast.ts` (extensão natural)
- `src/hooks/useSpreadMap.ts` (gatilho)
- `src/lib/probe.ts` (path diversity)
- NIP-44 (encrypted DM), NIP-65 (relay list metadata)

## Quando atacar

Sub-fase de Fase 6 — depois de:
- ✅ Manifesto v2.2 + roadmap
- ✅ Cliente PWA estável (v0.5+)
- ⏳ Decisão: começar Tauri shell antes ou colocar PoC WebRTC no PWA primeiro?

A decisão acima impacta ordem real:
- **Caminho A** (PWA-first): 6.1a-6.1b funcionam no PWA → testável agora → mas Service Worker doze mode no Android limita produção
- **Caminho B** (Tauri-first): 6.1 espera shell desktop estar pronto (Fase 6.0) → mais demorado mas plenitude desde dia 1

Recomendação Ted: **A**. PoC WebRTC no PWA, valida arquitetura (Schnorr verify, path diversity, signaling NIP-44), depois migra pro Tauri ganhando os limites superiores. Custo do refactor é baixo porque interface `Transport` já abstrai.
