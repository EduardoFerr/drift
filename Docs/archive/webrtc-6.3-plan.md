# Fase 6.3 — TURN + Reconnect + Health Checks

> ⚠ **PLANO HISTÓRICO** — Fase 6.3 ✅ entregue (TURN env var,
> reconnect backoff exponencial, health ping/pong, anti-pong-injection,
> grace period em 'disconnected'). Documento mantido em `Docs/archive/`
> como referência do plano executado.
> **Não é documentação ativa.** Status agregado em `Docs/fase-6-roadmap.md`.

Habilita WebRTC entre **peers móveis em redes diferentes** (4G CGN, symmetric NAT) via TURN relay TCP. Adiciona resiliência: reconnect com backoff exponencial + health checks RTT periódicos. Pré-requisito pra §15 (anti-censura por país) ser cumprido em mobile real.

## 1. Mecânica TURN

ICE flow atual em 6.1a usa só STUN (`stun:stun.l.google.com:19302`):
- STUN funciona pra ~70% das conexões (cone NAT, port-restricted NAT)
- **Falha** em ~30%: symmetric NAT (CGN 4G/5G), firewalls corporativos restritivos
- TURN é fallback: relay TCP/UDP que ambos peers podem alcançar via outbound HTTPS

Após 6.3, `RTCIceServer[]` inclui STUN + N TURN servers. Browser tenta STUN primeiro (P2P direto, baixa latência); se falhar, fallback automático pra TURN (relay, ~50-100ms extra latência).

### Lista de TURN públicos consideráveis

| Provider | URL | Custos | Notas |
|---|---|---|---|
| `numb.viagenie.ca` | `turn:numb.viagenie.ca` | grátis, sem reg | Conhecido, mas instável em horários de pico |
| Twilio | `turn:global.turn.twilio.com` | $0.40/GB | Precisa account + ephemeral creds via REST API |
| Cloudflare TURN | `turn:turn.cloudflare.com` | grátis até 1k DAU | Opt-in via dashboard; ephemeral creds |
| Self-hosted `coturn` | depende | infra própria | Manifesto §1 — sempre opção; doc separada futura |

**Default Drift**: lista vazia (só STUN). User opt-in via env var `VITE_TURN_SERVERS=` (formato `turn:host:port?username=...&credential=...,turn:host2:port?...`). Razão: TURN traffic vaza IP do user pro provider TURN (manifesto §28). Default sem TURN = sem leak. User decide ativar quando precisa mobile.

> **AVISO CRÍTICO** (Barney R3): Vite EMBUTE env vars `VITE_*` no bundle JS público. Credentials TURN comerciais (Twilio, Cloudflare paid) **NÃO** devem ir nesta env — usar **ephemeral creds via REST API runtime**. Esta env é segura APENAS pra TURN gratuito com creds públicas (numb.viagenie.ca) ou self-hosted coturn aberto. Marcar Twilio/Cloudflare como "**não usar via env var**".

## 2. Reconnect com backoff exponencial

Quando `pc.connectionState === 'failed'` ou `pc.connectionState === 'disconnected'`, peer fica órfão até timeout ICE (30s). Hoje, sem reconnect — user precisa reabrir aba.

6.3 adiciona:
- Detecção de drop em `onconnectionstatechange`
- Schedule reconexão com backoff exponencial: 1s → 2s → 4s → 8s → 16s → 30s (cap)
- Reset do counter em `dc.onopen` (sucesso)
- Cap de tentativas: 5 (depois marca peer como permanently failed; user reconecta manual)
- **Grace period 5s em `disconnected`** (Barney R2): WebRTC oscila connected↔disconnected em redes flakey (Wi-Fi handover, 4G→5G). Sem grace, cap=5 atinge em ~31s de oscilação real. Espera 5s; se peer voltou pra `open`, cancela schedule.
- **Só funciona em modo Nostr** (peer.id é npub estável; mock UUID per-tab não persiste)

## 3. Health checks ping-pong

Cada peer envia ping a cada 15s via DataChannel `__ping__` channel separado (pra não poluir filtros do `subscriptions`). Outro lado responde com `__pong__`. RTT atualiza `peer.lastPingMs`.

- 3 pings sem resposta consecutivos → peer marcado `degraded` (não `failed` — pode recuperar)
- Latência > 5s → degraded
- `getPeers()` agora retorna `lastPingMs` real (não mais placeholder)
- Smoke test e2e: console mostra "peer X latência: 87ms" depois de 15s

## 4. Tests Vitest

Mocks de `RTCPeerConnection` lifecycle (já existem helpers em test-only exports do webrtc.ts). Cobertura:

- TURN config: `getICEServers()` retorna STUN + TURN parsed da env var
- Reconnect backoff: schedule chama `connectTo` em delays exponenciais; reset em sucesso
- Health: ping enviado a cada 15s; pong atualiza lastPingMs; 3 misses → degraded

## 5. Smoke test e2e (manual, pendente Fase 6.3-final)

PC + celular 4G mesmo npub:
- PC console: `await window.driftWebRTC.connectTo('<celular_npub>')`
- Sem TURN: pode falhar (STUN-only). Espera 30s → ICE timeout
- Com TURN (`VITE_TURN_SERVERS=...`): conecta em ~5-10s via relay
- `getPeers()` mostra `latencyMs > 100ms` (relay overhead)
- Mata 4G no celular: PC vê `peer.status: degraded` em ~45s; reconnect em backoff

## 6. Limites conhecidos

- TURN traffic vaza IP do user pro provider TURN (manifesto §28). Default sem TURN protege.
- Cloudflare TURN exige account + ephemeral creds (não está hardcoded — user configura).
- Health check overhead: 1 ping/15s/peer = ~4 msgs/min/peer. Negligível.
- Reconnect cap=5 evita storm em peer permanentemente caído. User reconecta manual depois.

## 7. Arquivos modificados

- `src/lib/transport/webrtc.ts` — TURN config + reconnect + health
- `src/lib/transport/signaling.ts` — opcional: novo type `PingMsg`/`PongMsg` se via signaling em vez de DC channel separado (decisão a tomar)
- `.env.example` — `VITE_TURN_SERVERS=`
- `src/vite-env.d.ts` — type pro env var
- `tests/webrtc-reconnect.test.ts` — novo (Marshall faz)
- `tests/webrtc-health.test.ts` — novo (Marshall faz)

## 8. Manifesto coverage

- **§12** (multi-transport): WebRTC fica viável em mobile real
- **§15** (anti-censura): mobile pode usar Drift mesmo em redes restritivas (TURN bypass + Tor seria ideal — combinar com 6.4)
- **§20** (resiliência): reconnect + health = robustez automática
- **§28** (privacidade): TURN é opt-in pra não vazar IP por default

## 9. Próximos passos

- 6.4 Tor: combinar com TURN onion (TURN over Tor — ~3x latência, mas anti-censura completo)
- Mobile real smoke test (precisa user com 2 dispositivos em redes diferentes)
