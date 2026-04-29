# Fase 6.1b — Plano Executável: Signaling Real via Nostr DM (NIP-44)

Substitui o BroadcastChannel mock de 6.1a por **signaling cifrado end-to-end via DM Nostr**. Permite peers em redes diferentes se conectarem usando relays Nostr existentes como rendezvous, sem inventar diretório paralelo (invariante #14).

**Decisão fechada**: `nostr-tools` 2.7.0 já exporta `nip44` com `getConversationKey`, `encrypt`, `decrypt`. **Zero deps novas**. Usar direto.

## 1. Mecânica do signaling Nostr

Fluxo end-to-end (A.npub conhecido por discovery; A inicia):

1. **A computa peerKey** = `nip44.getConversationKey(A.nsecBytes, B.npub)` — cacheado por par (A,B). Custo HKDF/ECDH ~1ms; `Map<npub, Uint8Array>` por sessão.
2. **A cria `RTCPeerConnection`**, abre DataChannel `'drift-v1'`, chama `pc.createOffer()` + `pc.setLocalDescription(offer)`.
3. **A serializa** `OfferMsg` JSON com **mesmo schema da 6.1a** (`{type:'offer', from:A.npub, to:B.npub, sdp, ts}`), **mas `from`/`to` agora são npubs hex 64-char** (não UUIDs).
4. **A cifra**: `ciphertext = nip44.encrypt(JSON.stringify(msg), peerKey)`.
5. **A publica via wssTransport.publish** evento Drift assinado **kind 1059** (gift wrap NIP-59 minimal):
   - Payload já cifrado NIP-44 v2 vai em `content`
   - Tag `['p', B.npub]`
   - **Drift NÃO usa NIP-17 seal layer completo** — só camada 1059 com cifra direta. Trade: vaza pubkey do remetente em `event.pubkey`. Aceitável pra signaling — nó hostil já saberia npub via `from` interno do msg.
6. **B subscribe** desde o boot: `wssTransport.subscribe({ kinds:[1059], '#p':[B.npub], since: bootTs - 60 })` com handler que decifra e despacha pra `nostrSignalingChannel.onmessage`.
7. **B decifra**: `getConversationKey(B.nsecBytes, event.pubkey)` (npub do remetente está validado via Schnorr — invariante #5). Decrypt falha → drop silencioso (defesa contra spam).
8. **B parseia** msg, vê `to===B.npub`, processa offer (createAnswer, setLocalDescription, manda answer cifrado de volta).
9. **ICE candidates trickle**: cada `pc.onicecandidate` vira novo evento kind 1059 cifrado.
10. Após `dc.readyState === 'open'`, signaling termina. Subscribe Nostr permanece (custo zero) pra novos peers ou reconnects.

**Sanity check anti-spoofing**: `msg.from` (interno cifrado) deve `=== event.pubkey` (público). Impede peer C envenenar `from` enquanto envia mensagem cifrada pra B (não conseguiria, mas defesa-em-profundidade).

## 2. Discovery — como A obtém B.npub

**PoI-only** (sem broadcast global, respeita invariante #14):

- Lista candidata = `db.exec('SELECT DISTINCT spreader_pub FROM spreads WHERE post_id = ?', [postId])` no SQLite local.
- Hook `useSpreadMap(postId)` em 7.1 chama `seeder.startSeeding(postId)` que itera candidates e dispara `webrtcTransport.connectTo(npub)`.
- Em **6.1b puro** (sem 7.1 ainda), exposição via DEV: `window.driftWebRTC.transport.connectTo(npub)` chamado manualmente do console — esse é o smoke-test ponte.

Sem heartbeat global, sem "estou online" broadcast. Se B estiver offline, A publica offer em 1059 → fica nos relays até retention (~24-72h) → B recebe ao bootar via `since` no subscribe inicial. Edge case desejável: signaling **store-and-forward** sem custo extra.

## 3. `webrtc-signaling-nostr.ts` — substituível pela mock

**Interface comum** (extrair de `webrtc-signaling-mock.ts` durante 6.1b-B):

```typescript
// src/lib/transport/signaling.ts
export interface SignalingChannel {
  send(msg: SignalingMessage): Promise<void>
  onMessage(handler: (msg: SignalingMessage) => void): () => void
  close(): void
}
```

`webrtc.ts` recebe a impl via DI (param do init). Tie-break, schema das mensagens — **idênticos**. Único delta: `from`/`to` passam a ser npub hex 64-char.

```typescript
// src/lib/transport/webrtc-signaling-nostr.ts
export function nostrSignalingChannel(opts: {
  myNpub: string
  myNsecBytes: Uint8Array
  transport: Transport
  signEvent: typeof signDriftEvent
}): SignalingChannel {
  const handlers = new Set<(msg: SignalingMessage) => void>()
  const keyCache = new Map<string, Uint8Array>()

  const getKey = (peerNpub: string) => {
    let k = keyCache.get(peerNpub)
    if (!k) { k = nip44.getConversationKey(opts.myNsecBytes, peerNpub); keyCache.set(peerNpub, k) }
    return k
  }

  const unsub = opts.transport.subscribe(
    { kinds: [1059], '#p': [opts.myNpub], since: Math.floor(Date.now()/1000) - 60 },
    { onevent: (ev) => {
        try {
          const key = getKey(ev.pubkey)
          const plaintext = nip44.decrypt(ev.content, key)
          const msg = JSON.parse(plaintext) as SignalingMessage
          if (msg.from !== ev.pubkey) return  // anti-spoof
          for (const h of handlers) h(msg)
        } catch { /* drop: cifra inválida ou JSON mal-formado */ }
    }}
  )

  return {
    async send(msg) {
      const peerNpub = 'to' in msg ? msg.to : null
      if (!peerNpub) return  // bye é broadcast — em Nostr, drop
      const key = getKey(peerNpub)
      const ciphertext = nip44.encrypt(JSON.stringify(msg), key)
      const ev = await opts.signEvent({
        kind: 1059, tags: [['p', peerNpub]], content: ciphertext
      })
      await opts.transport.publish(ev)
    },
    onMessage(h) { handlers.add(h); return () => handlers.delete(h) },
    close() { unsub(); handlers.clear(); keyCache.clear() }
  }
}
```

**Diferenças do mock que afetam comportamento**:
- **`bye` broadcast**: mock notifica exit. Em Nostr custaria publicar pra cada peer. **Drop** — peer detecta close via `dc.onclose` / `pc.connectionState === 'failed'` (delay ~5-10s aceitável).
- **`hello` broadcast**: mesmo problema. **Não há hello em Nostr** — quem inicia já conhece o npub do alvo (PoI). Tie-break: glare só se 2 peers abrem mapa simultâneo — `min(myNpub, peerNpub) === myNpub` resolve igual.

## 4. NIP-44 helpers — decisão fechada

`nostr-tools` 2.7.0 exporta `nip44` em `node_modules/nostr-tools/lib/types/nip44.d.ts`:

```typescript
import { nip44 } from 'nostr-tools'
// ou: import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
```

**Versão estável** (não beta). Sem wrapper próprio inicialmente — só facade fino `encryptDM(plain, peerNpub)` / `decryptDM(payload, peerPubkey)` em `src/lib/nostr.ts`.

## 5. Otimizações (listar, não bloquear)

- **Trickle ICE batching**: implementar simples primeiro (1 evento por candidate). Batching 200ms vira 6.2.
- **Relay storm**: SimplePool já reusa conexões. Throttle no publish vira 6.2.
- **Spam defense**: NIP-44 decrypt falha = drop silencioso. Pra flood deliberado >50 falhas, blacklist 5min — issue 6.2.
- **Replay window**: `IceMsg` com `ts` antiga reaplicada — reject se `ts < now - 120s`. **Implementar em 6.1b** (5 linhas).

## 6. Sub-fases concretas

**6.1b-A** — `src/lib/nostr.ts` ganha `encryptDM` / `decryptDM` (facade nip44). Tests Vitest com vetores oficiais NIP-44 v2. ~30min. `feat(nostr): NIP-44 encrypt/decrypt facade`.

**6.1b-B** — Extrai `SignalingChannel` interface pra `signaling.ts`. Refactor `webrtc-signaling-mock.ts` pra implementar (sem mudança de comportamento). `refactor(transport): extract SignalingChannel interface`.

**6.1b-C** — `webrtc-signaling-nostr.ts` implementando `SignalingChannel` com fake `Transport` mock. Tests cobrem: round-trip cifrado, drop em decrypt fail, drop em `from !== ev.pubkey`, ICE forwarding, replay window. `feat(transport): Nostr NIP-44 signaling channel`.

**6.1b-D** — `webrtc.ts` ganha factory param `signaling` (DI). Default DEV: mock. Prod: nostr via flag `VITE_USE_NOSTR_SIGNALING`. `window.driftWebRTC.transport.connectTo(npub)` exposto. `feat(transport): wire Nostr signaling into webrtcTransport`.

**6.1b-E** — Smoke e2e manual + docs (CHANGELOG, marcar 6.1b done). `chore: bump 0.6.1-alpha — Phase 6.1b shipped`.

PoI integration (`useSpreadMap` → `connectTo`) **fica fora de 6.1b**, vira **7.1a**.

## 7. Critério de aceite 6.1b

E2e manual cross-machine real:

- PC (peer A): npub_A. Boot Drift, copiar npub.
- Celular (peer B, 4G/Wi-Fi diferente): npub_B. Boot Drift.
- A console: `await window.driftWebRTC.transport.connectTo('<npub_B>')`. Aguarda DC open (~2-5s, NAT-dependente).
- A: `getPeers()` → `[{ id: '<npub_B>', status: 'open', latencyMs: ~50-200 }]`.
- B subscreve `{ kinds: [9078] }` no `webrtcTransport`.
- A: `await transport.publish(<spreadEvent kind 9078>)`.
- B: handler dispara, `verifyDriftEvent` passa, evento recebido via DataChannel.
- A fecha aba: B detecta close em ~5-10s.

Tests Vitest:
- `nip44-facade.test.ts`: vetores oficiais NIP-44 v2 + round-trip
- `signaling-nostr.test.ts`: fake Transport, Alice/Bob com nsecs determinísticos, trocam offer/answer/ice cifrados

## 8. Tempo / risco

**Estimativa: 8-12h em 2-3 sessões**. Mais incerto que 6.1a por NAT real no smoke test.

Riscos não-óbvios:

1. **Symmetric NAT em rede móvel**: 4G carrier-grade NAT bloqueia STUN-only. 6.1b sem TURN pode falhar entre peers móveis em redes diferentes. **Documentar como limite aceito**; TURN em 6.3. Smoke alternativo: 2 PCs em redes residenciais.
2. **Relays podem não aceitar kind 1059**: alguns têm policy `allow_kinds`. Validar nos 4 relays seed antes de 6.1b-D (5min de teste com `wscat`). Fallback: kind 4 NIP-04 legado com payload NIP-44 v2 dentro.
3. **`getConversationKey` exige `Uint8Array` 32 bytes**: identity.ts já tem `nsecHexToBytes`. Casar tipos — não passar nsec hex crua.

## 9. Pré-requisitos

- 6.1a merged (mock signaling funcionando, smoke 2-tabs OK)
- Test suite 6.1a verde
- ✅ Decisão registrada: nostr-tools nip44 (não custom)
- Confirmar que os 4 relays seed aceitam kind 1059 (validar antes do 6.1b-D)
- `signDriftEvent` aceita kind arbitrário (já aceita — `kind: number` opaco)
