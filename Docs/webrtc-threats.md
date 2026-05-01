# Threat Model — WebRTC Transport (Fases 6.1-6.3 + 7.1)

**Atribuição original**: papel de revisão de segurança · **Versão**: 1.0 · **Data**: 2026-04-28
**Atualização parcial**: 2026-05-01 — status pós-6.2/6.3 sintetizado abaixo.

Análise rigorosa dos ataques específicos contra a arquitetura WebRTC do Drift,
focada em **6.1a** (esqueleto + signaling mock), **6.1b** (signaling NIP-44 real),
**6.2** (peer registry + path diversity), **6.3** (STUN/TURN policy) e
**7.1** (Proof of Interest seeder).

Complementa — **não duplica** — o threat model geral em
`Docs/drift-arquitetura-v4.md §36`. Aquele cobre adversários de protocolo
e relay; este cobre **adversários no plano P2P direto** (DataChannel +
ICE + signaling cifrado).

Referências: `Docs/archive/webrtc-seeding.md`, `Docs/archive/webrtc-6.1a-plan.md`,
`Docs/manifesto.md` §15/§17/§20/§28, invariantes #2/#5/#14 do `CLAUDE.md`.

> ⚠ **Status pós-6.2/6.3 (atualizado 2026-05-01)** — sub-fases 6.2
> (peer registry + path diversity + cross-proto threshold) e 6.3
> (TURN env var + reconnect backoff + health ping/pong) foram entregues.
> Várias ameaças listadas como "Aberto / mitigação 6.2" abaixo
> **estão mitigadas em código** mas a tabela resumo + descrições
> individuais ainda não foram re-classificadas linha-a-linha. Síntese:
>
> - **T-WRTC-006 / T-WRTC-009 / T-WRTC-010 / T-WRTC-014 / T-WRTC-017**:
>   mitigações 6.2 implementadas (peerRegistry com blacklist, MAX_PEERS=32,
>   cross-proto threshold=50, path diversity scoring em `peerScore.ts`,
>   random walk timer 30min). Status real: **mitigado parcialmente**;
>   campo "Status" deveria ser "Mitigado em 6.2 — auditoria de fit pendente"
>   em vez de "Crítico/Aberto".
> - **T-WRTC-002 / T-WRTC-005**: mitigação parcial via TURN opt-in (6.3 —
>   `VITE_TURN_SERVERS`). Status: **opt-in shipado**; user precisa configurar.
> - **T-WRTC-018**: probe estendido NÃO foi implementado em 6.2 — segue Aberto.
>
> Re-classificação linha-a-linha é follow-up de doc-hygiene
> (sprint pós-Fase 6.4 inteira). Por hora, leia status individual com
> ressalva "datado de 2026-04-28".

---

## Tabela resumo

| ID            | Categoria | Probabilidade | Mitigação Fase 6      | Status         |
|---------------|-----------|---------------|------------------------|----------------|
| T-WRTC-001    | 1 — Peer  | **Alta**      | Parcial (modos)        | Aceito c/ doc  |
| T-WRTC-002    | 1         | Média         | Não — só Fase 6.3      | Aberto         |
| T-WRTC-003    | 1         | **Alta**      | Default `lan-wifi-only`| Aceito         |
| T-WRTC-004    | 1         | Média         | Parcial (peerId UUID)  | Aberto         |
| T-WRTC-005    | 1         | Média         | TURN-only opcional     | Aberto         |
| T-WRTC-006    | 2 — Rede  | **Alta**      | Não em 6.1; §6.2       | **Crítico**    |
| T-WRTC-007    | 2         | **Alta**      | Parcial — invar #14    | **Crítico**    |
| T-WRTC-008    | 2         | Média         | Kind check pre-verify  | Mitigado       |
| T-WRTC-009    | 2         | Alta          | Path diversity (6.2)   | Aberto         |
| T-WRTC-010    | 2         | Média         | Não em 6.1a            | Aberto         |
| T-WRTC-011    | 3 — Integ | Baixa         | NIP-44 (6.1b)          | Mitigado       |
| T-WRTC-012    | 3         | Média         | Nonce/timestamp NIP-44 | Verificar      |
| T-WRTC-013    | 3         | **Alta**      | DRIFT_KIND_SET check   | Mitigado (6.1a)|
| T-WRTC-014    | 3         | Baixa         | Invariante #15         | Aberto         |
| T-WRTC-015    | 3         | Baixa         | nostr-tools/secp256k1  | Aceito         |
| T-WRTC-016    | 4 — Social| Média         | Opt-in + warning       | Aceito         |
| T-WRTC-017    | 4         | **Alta**      | Path diversity (6.2)   | **Crítico**    |
| T-WRTC-018    | 4         | Média         | Random sampling probe  | Aberto         |
| T-WRTC-019    | 5 — Bug   | Alta          | §8.6 do plano 6.1a     | Mitigado       |
| T-WRTC-020    | 5         | Alta          | §8.4 + JSDoc           | Mitigado       |
| T-WRTC-021    | 5         | Média         | Tie-break determinístico| Mitigado      |
| T-WRTC-022    | 5         | Baixa         | crypto.randomUUID()    | Mitigado       |
| T-WRTC-023    | 5         | Média         | Não em 6.1a            | Aberto         |

**Total**: 23 ameaças · **Críticas**: 3 (T-006, T-007, T-017)
**Distribuição**: cat.1=5 · cat.2=5 · cat.3=5 · cat.4=3 · cat.5=5

---

## Categoria 1 — Ataques contra peers individuais

### T-WRTC-001 · IP leak via ICE candidates

| Campo | Valor |
|---|---|
| **Categoria** | 1 — Peer |
| **Descrição** | WebRTC publica todos os endereços IP locais e públicos do peer em `RTCIceCandidate`s. Mesmo com mDNS hostname obfuscation (Chrome 76+), o IP público do server-reflexive STUN candidate é trocado em claro no SDP. |
| **Vetor** | Peer hostil B aceita o `hello` de A. No handshake SDP/ICE, B coleta os ICE candidates de A: `host` (IP LAN), `srflx` (IP WAN via STUN), eventualmente `prflx`. mDNS só esconde host candidates; srflx revela IP WAN. B agora correlaciona `pubkey(A)` ↔ `IP público(A)`. |
| **Impacto** | Confidentiality — **alto**. Quebra anonimato pseudônimo do npub. Permite geolocation grosseira, correlação ISP, vetor pra subpoena/coercion. |
| **Probabilidade** | **Alta**. É comportamento padrão do WebRTC; qualquer peer que aceite handshake aprende o IP. Não requer "ataque" — é como o protocolo funciona. |
| **Mitigação Fase 6** | Modo `lan-wifi-only` (default — só LAN, IP público nunca sai); modo `relay-mode` (TURN-only, IP público é o do TURN); modo `tor-mode` (mutuamente exclusivo com WebRTC — desativa). UI **deve** avisar antes de habilitar `always-on`. Doc `archive/webrtc-seeding.md` "Modos operacionais". |
| **Mitigação Fase 7+** | Mandatory TURN relay para usuários em jurisdições hostis; integração com Tor onion services para signaling + datachannel via Tor (Fase 6 cliente nativo, fora do escopo do PWA). |
| **Aceito?** | **Sim, com mitigação**. Manifesto §4 — "não somos mixnet". Default `lan-wifi-only` reduz risco; usuário que ativa `always-on` recebe aviso explícito (§28 transparência). |

### T-WRTC-002 · Browser fingerprinting via WebRTC stats

| Campo | Valor |
|---|---|
| **Categoria** | 1 |
| **Descrição** | RTT, codec capabilities, suportes de SCTP, DTLS fingerprint, ICE order — formam fingerprint do device, vinculável à pubkey via DataChannel. |
| **Vetor** | B mede RTT com 100ms accuracy via ping/pong no DataChannel. Combina com `RTCRtpReceiver.getCapabilities()` exposto no SDP (codecs OPUS/VP8/etc). DTLS fingerprint do peer é único por device. Resultado: device fingerprint estável associado à pubkey ativa. |
| **Impacto** | Confidentiality — **médio**. Não revela IP direto, mas permite re-identificação cross-session (mesmo device, npub diferente após reset). |
| **Probabilidade** | Média. Requer atacante com volume de observações; surface area é menor que T-001. |
| **Mitigação Fase 6** | Nenhuma direta. SDP precisa expor capacidades pra negociar conexão. |
| **Mitigação Fase 7+** | Documentar como limite explícito; cliente Tauri pode ter fingerprint reduzido (controle sobre stack DTLS). Não combater no PWA. |
| **Aceito?** | Sim. Manifesto §28 honestidade — documentar como limitação reconhecida. |

### T-WRTC-003 · Local network discovery

| Campo | Valor |
|---|---|
| **Categoria** | 1 |
| **Descrição** | Host ICE candidates revelam topologia interna da LAN do alvo (subnets, IPs de roteador, número de devices). |
| **Vetor** | Peer remoto B coleta `host` candidates de A: `192.168.1.42`, `192.168.1.1` (gateway via mDNS reverse?), `10.0.0.5` (VPN corp). Mapeia rede interna sem nunca tocar nela. |
| **Impacto** | Confidentiality — médio. Útil pra ataque follow-up (e.g., CVE em router específico, recon corp). |
| **Probabilidade** | **Alta** se modo `always-on`. Baixa se default. |
| **Mitigação Fase 6** | Modo `lan-wifi-only` paradoxalmente NÃO mitiga (os candidates compartilhados são exatamente os de LAN). Mitigação real: `relay-mode` (TURN-only suprime host candidates) — `iceTransportPolicy: 'relay'`. |
| **Mitigação Fase 7+** | Tornar `iceTransportPolicy: 'relay'` o default em modo paranoia; documentar trade-off bateria/dados. |
| **Aceito?** | Sim, com avisos. Default `lan-wifi-only` aceita esse leak dentro da LAN como custo de operar P2P. |

### T-WRTC-004 · Linkability pubkey ↔ peerId

| Campo | Valor |
|---|---|
| **Categoria** | 1 |
| **Descrição** | Em 6.1a o `peerId` é UUID v4 random por tab — não vinculado à pubkey. Em 6.1b com signaling NIP-44 real, signaling **vai** carregar pubkey (sender do DM). Sem cuidado, pubkey ↔ DataChannel session vira trivialmente correlacionável. |
| **Vetor** | Em 6.1b: A publica `kind:4`/NIP-44 DM com offer SDP pra B. Pubkey de A está no envelope. B abre DataChannel; agora ele sabe `pubkey(A) === peer atrás deste socket`. Logo, todos os eventos publicados via aquele DataChannel correlacionam-se com pubkey(A) — inclusive eventos kind:9078 que A republica de **outros** autores (seeder mode). |
| **Impacto** | Confidentiality — médio. Dilui anonimato do seeder: "quem está seedando o quê" vira observable. |
| **Probabilidade** | Média. Surge em 6.1b/7.1, não em 6.1a. |
| **Mitigação Fase 6** | Em 6.1a, `peerId` random é boa prática — manter. Em 6.1b, signaling via NIP-44 já cifra conteúdo, mas metadata (sender pubkey do DM) é público. Considerar **signaling identity ≠ posting identity**: signaling usa nsec efêmero rotacionado por sessão. Nota: invariante #14 — sem inventar protocolo paralelo; rotação é cliente-side. |
| **Mitigação Fase 7+** | Nsec efêmero por sessão de seeding. Re-key a cada N minutos. Documentar trade-off (perde reputation across sessions). |
| **Aceito?** | Não — endereçar em 6.1b. Recomendação prioritária #2. |

### T-WRTC-005 · Mapeamento "quem segue quem" via padrões de connection

| Campo | Valor |
|---|---|
| **Categoria** | 1 |
| **Descrição** | Observador de signaling (relays Nostr usados pra DM NIP-44) vê metadata: pubkey A manda DM cifrado pra pubkey B. Ciphertext opaco, mas grafo de conexão é público. Cruzando com NIP-02 follows, atacante mapeia "interest graph" mesmo sem ler conteúdo. |
| **Vetor** | Relay maliciosamente passivo registra todos os pares (sender, recipient) de kind:4 entre clientes Drift (heurística: kind:4 + tag `drift-version`). Sobre semanas, infere "A frequentemente abre canal com B/C/D quando C postou X" → grafo social + interesse. |
| **Impacto** | Confidentiality — médio. Quebra deniability do seeding; vincula seeders a posts específicos. |
| **Probabilidade** | Média-alta. Relays grandes têm a visão. |
| **Mitigação Fase 6** | Não direta em 6.1. Mitigação possível em 6.1b: spread signaling DMs por relays heterogêneos (NIP-65 outbox); cover-traffic (caro, descartado em `archive/webrtc-seeding.md` "Riscos não-óbvios"). |
| **Mitigação Fase 7+** | Signaling via Tor (cliente nativo) suprime metadata pro relay. |
| **Aceito?** | Sim, documentado. Manifesto §4 "não somos mixnet" cobre. |

---

## Categoria 2 — Ataques contra a rede / disponibilidade

### T-WRTC-006 · Sybil em signaling

| Campo | Valor |
|---|---|
| **Categoria** | 2 — Rede |
| **Descrição** | Atacante gera 10k npubs e anuncia presença via signaling NIP-44. Cada npub responde a `hello` de qualquer peer, monopolizando peer registry da vítima. |
| **Vetor** | Atacante roda script: para cada post viral em `useSpreadMap`, broadcast `hello` por 10k npubs. Vítima abre 10k DataChannels (limite browser ~256 simultâneos antes de degradar; mas tentativa custa CPU/memória). Mais sutil: atacante seedeia só 100 npubs, todos servindo dados consistentes — mas forma 100 dos top peers no registry da vítima. Path diversity score ainda passa (IPs diferentes via proxies/cloud). |
| **Impacto** | Availability — **alta**. Eclipse efetivo: 100% dos peers conhecidos da vítima são do atacante. |
| **Probabilidade** | **Alta**. npub generation é grátis; spam de DMs cifrados em relays comuns custa pouco. |
| **Mitigação Fase 6** | **Em 6.1a: NENHUMA — invariante crítica.** Mock signaling (BroadcastChannel) não tem ataque externo. **Em 6.1b**: rate-limit por pubkey no signaling handler (cliente-side). **Em 6.2**: path diversity scoring (manifesto §20) penaliza concentração ASN/CIDR; cap absoluto de peers (`MAX_PEERS = 32`); rotação aleatória. |
| **Mitigação Fase 7+** | NIP-65 outbox + relay diversity score (já em §20); PoW opcional em handshake (manifesto §31). |
| **Aceito?** | **Não — crítico**. Recomendação prioritária #1 pro Ted incorporar em 6.1b. |

### T-WRTC-007 · Eclipse via bootstrap envenenado

| Campo | Valor |
|---|---|
| **Categoria** | 2 |
| **Descrição** | Cliente novo entra na rede; primeiros peers que aceitam handshake são todos do atacante (Sybil + presença antecipada nos relays de signaling). Vítima vê "rede" sintética. |
| **Vetor** | Atacante mantém 1000 npubs sempre online em relays populares anunciando presença. User Drift novo abre `useSpreadMap` pela primeira vez; busca peers via NIP-65; primeiros K respondentes são do atacante (latência otimizada). Vítima nunca alcança peers honestos. |
| **Impacto** | Availability + Confidentiality — **alta**. Atacante decide o que vítima vê (withholding) e correlaciona pubkey ↔ IP. |
| **Probabilidade** | **Alta** em rede pequena (Drift early-stage). Diminui com adoção. |
| **Mitigação Fase 6** | Em 6.2: bootstrap **não-determinístico** — random walk de peers, não top-K por latência. Cap em peers do mesmo ASN. Em 6.3: TURN diversity (não confiar em 1 só TURN). |
| **Mitigação Fase 7+** | Sneakernet bootstrap (`bundle.ts`) — peers iniciais via QR/file de fonte confiável (Fase 7); IPFS pin de peerlist comunitária. |
| **Aceito?** | **Não — crítico**. Recomendação prioritária #3. |

### T-WRTC-008 · DataChannel flooding pós-handshake

| Campo | Valor |
|---|---|
| **Categoria** | 2 |
| **Descrição** | Peer B passou handshake (Schnorr verify de algum evento inicial OK), depois envia 10k mensagens/s de garbage no DataChannel. |
| **Vetor** | B envia eventos kind:1 (Nostr global, NÃO Drift) com sig **válida** (B é dono daquele npub). Cada evento força parse + `isPlausibleSignedEvent` + kind check. Sem kind check pré-verify, queima ~1ms/evento × 10k/s = 100% CPU. |
| **Impacto** | Availability — alta. DoS local. |
| **Probabilidade** | Média (requer peer já conectado). |
| **Mitigação Fase 6** | **Já mitigado no 6.1a** — `webrtc-6.1a-plan.md §5` checagem `DRIFT_KIND_SET.has(event.kind)` ANTES de `verifyDriftEvent`. Adicional necessário (não no plano): rate-limit por peer (e.g., 100 msg/s; excedeu → close + status `failed`). |
| **Mitigação Fase 7+** | Reputation por peer (count de garbage), dropar peers ruidosos. |
| **Aceito?** | Mitigado parcialmente. Adicionar rate-limit por peer no commit C de 6.1a. |

### T-WRTC-009 · Withholding seletivo

| Campo | Valor |
|---|---|
| **Categoria** | 2 |
| **Descrição** | Peer B entrega corretamente eventos `e1, e2, e3` mas omite silenciosamente `e4` (post sensível ao atacante). Honesto na superfície, censor seletivo. |
| **Vetor** | B controla seedeing local. Vítima pede árvore do post X via `useSpreadMap`. B serve POST + 80% dos SPREADs, mas suprime os SPREADs de pubkeys do grupo dissidente. Vítima vê post "isolado". |
| **Impacto** | Integrity (visão da rede) — alta. Censura invisível. |
| **Probabilidade** | Alta — é o ataque óbvio contra seeders. |
| **Mitigação Fase 6** | **6.2 path diversity scoring** + probe estendido pra WebRTC (extensão de `probe.ts`). Cruzar dados de N peers; flag peer cujo subset diverge sistematicamente. |
| **Mitigação Fase 7+** | Bloom filter de "o que cada peer alega ter" + auditing comunitário. |
| **Aceito?** | Não — endereçar em 6.2. Limite reconhecido em manifesto §20. |

### T-WRTC-010 · Resource exhaustion via N DataChannels

| Campo | Valor |
|---|---|
| **Categoria** | 2 |
| **Descrição** | Atacante (1 npub, múltiplas conexões via N tabs/devices) abre 1000 DataChannels contra mesma vítima. Cada DC consome ~MB de buffer SCTP. |
| **Vetor** | Browser limita ~256 DCs concorrentes; atacante satura, vítima não consegue aceitar peers honestos. |
| **Impacto** | Availability — média. |
| **Probabilidade** | Média. Requer infra do atacante. |
| **Mitigação Fase 6** | Cap absoluto `MAX_PEERS = 32` (recomendação 6.2). Cap por pubkey: 1 conexão. |
| **Mitigação Fase 7+** | Cap por ASN/IP-prefix. |
| **Aceito?** | Não — adicionar caps em 6.2 quando peerRegistry materializar. |

---

## Categoria 3 — Ataques contra integridade

### T-WRTC-011 · MITM em signaling

| Campo | Valor |
|---|---|
| **Categoria** | 3 — Integridade |
| **Descrição** | Relay comprometido entrega DM NIP-44 de A pra B alterado. NIP-44 v2 usa AEAD (ChaCha20-Poly1305 + HMAC); manipulação detectada. |
| **Vetor** | Relay tenta substituir SDP no DM. AEAD falha decrypt → cliente descarta. Relay tenta replay de DM antigo (ver T-012). |
| **Impacto** | Integrity — baixo (AEAD cobre). Sem AEAD seria alto. |
| **Probabilidade** | Baixa — NIP-44 v2 é AEAD-correto se implementado certo. |
| **Mitigação Fase 6** | Usar **NIP-44 v2** (não v1, deprecated). Verificar implementação `nostr-tools` >= 2.x. |
| **Mitigação Fase 7+** | Auditoria periódica da impl NIP-44 do `nostr-tools`. |
| **Aceito?** | Sim — mitigado pelo crypto. |

### T-WRTC-012 · Replay de signaling messages

| Campo | Valor |
|---|---|
| **Categoria** | 3 |
| **Descrição** | Mesmo `OfferMsg` cifrado reenviado por relay malicioso → vítima abre múltiplas conexões espúrias. |
| **Vetor** | Relay captura kind:4 com offer de A pra B. 10min depois, reenvia. B aceita e abre novo DC pensando ser nova oferta. |
| **Impacto** | Availability (peer registry pollution) — médio. Não compromete confidencialidade. |
| **Probabilidade** | Média. |
| **Mitigação Fase 6** | NIP-44 inclui `created_at` (event level). Cliente deve **rejeitar offers com `created_at` mais antigo que 60s** ou já-vistas (cache de event.id por TTL). Verificar se plano 6.1b inclui — **não está explícito**. |
| **Mitigação Fase 7+** | Nonce dentro do payload SDP cifrado (defense-in-depth). |
| **Aceito?** | Não — Ted: adicionar timestamp window + dedup explícito ao plano 6.1b. |

### T-WRTC-013 · Cross-protocol confusion (kind injection)

| Campo | Valor |
|---|---|
| **Categoria** | 3 |
| **Descrição** | Atacante envia evento Nostr não-Drift (kind:1, kind:30023, etc) via DataChannel — força cliente Drift a processar/exibir conteúdo fora do protocolo Drift. Quebra invariante #14. |
| **Vetor** | Peer B publica `{kind:1, content:"<phishing link>", sig:valid}` via DC. Sem filtro, evento chega a `onevent` handler do consumidor; se 6.2 conectar a `onNostrEvent`, persiste em SQLite global. |
| **Impacto** | Integrity — alta (poluição de SQLite com kinds não-Drift). |
| **Probabilidade** | **Alta** — trivial de tentar. |
| **Mitigação Fase 6** | **Mitigado em 6.1a** pelo `DRIFT_KIND_SET.has(event.kind)` no pipeline §5 do plano. Verify nunca roda em kinds não-Drift. **Mas o plano 6.1a não loga/conta tentativas** — adicionar `console.warn` + counter por peer. |
| **Mitigação Fase 7+** | Peer reputation: peer com >N tentativas inválidas → blacklist temporário. |
| **Aceito?** | Mitigado. Adicionar telemetria local (sem reportar fora). |

### T-WRTC-014 · Race em multi-id durante seeding

| Campo | Valor |
|---|---|
| **Categoria** | 3 |
| **Descrição** | User troca identidade ativa via `setActiveIdentity` (invariante #15 → `location.reload`). Janela: peer hostil envia evento via DC durante o reload, cuja `onevent` callback ainda referencia identidade antiga. Possível mistura de contexto. |
| **Vetor** | A1 → A2 troca de ID. B publica evento durante shutdown pré-reload. Subscription órfã processa evento antes do `closeAll()`. |
| **Impacto** | Integrity — baixa. SQLite não persiste (sync.ts faz isso, e sync.ts já reset em reload). |
| **Probabilidade** | Baixa — janela curta + invariante #15 reload já fecha. |
| **Mitigação Fase 6** | `setActiveIdentity` deve chamar `webrtcTransport.closeAll()` ANTES de `location.reload()` (sequenciamento). Adicionar ao plano 6.2 quando integration sync↔webrtc materializar. |
| **Mitigação Fase 7+** | n/a |
| **Aceito?** | Não — adicionar guard explícito em 6.2. |

### T-WRTC-015 · Schnorr verify side-channel

| Campo | Valor |
|---|---|
| **Categoria** | 3 |
| **Descrição** | Timing attack contra `verifyDriftEvent` revelaria estado do signer. Tradicionalmente Schnorr (BIP-340) é constant-time se a impl for boa. |
| **Vetor** | Peer mede tempo de resposta (RTT da próxima mensagem) após enviar evento com sig estrategicamente malformada → infere bits da chave? Improvável; a verificação não usa chave do receiver. |
| **Impacto** | Confidentiality — N/A (verify usa pubkey do sender, não chave secreta do receiver). Side-channel relevante seria no signer, não no verifier. |
| **Probabilidade** | Baixa. |
| **Mitigação Fase 6** | nostr-tools usa @noble/secp256k1 (constant-time). |
| **Mitigação Fase 7+** | n/a |
| **Aceito?** | Sim — não é vetor real para verify. |

---

## Categoria 4 — Ataques econômicos / sociais

### T-WRTC-016 · Liability transfer (seeding involuntário)

| Campo | Valor |
|---|---|
| **Categoria** | 4 — Social |
| **Descrição** | Atacante cria post com conteúdo ilegal (jurisdição-específico) e força A a seedear via `useSpreadMap`. A torna-se nó de distribuição. Manifesto §28 nota explicitamente "seedear pode revelar quem tem o quê". |
| **Vetor** | Atacante posta CSAM/material ilegal. Bot orquestra peers pedindo o conteúdo via DC para A. A, em modo `always-on`, serve. Logs de ISP mostram A distribuindo o material. |
| **Impacto** | Availability + risco legal — alto pessoalmente, médio na rede. |
| **Probabilidade** | Média. |
| **Mitigação Fase 6** | Default `lan-wifi-only` reduz exposição. UI explícita ao habilitar `always-on` ("você está distribuindo conteúdo de terceiros"). Respeitar `content-warning` §27 (não seedear `nsfw-unmarked` sem ack). Indicador "servindo N posts a M peers" (`archive/webrtc-seeding.md` §7.1c). |
| **Mitigação Fase 7+** | Modo `tor-mode` (mutuamente exclusivo) oferece anonimato real. Documentar no onboarding que seeding tem implicações legais. |
| **Aceito?** | Sim, com transparência radical. Manifesto §16/§17 — disponibilidade distribuída implica esse custo. Cliente NÃO seedeia by default sem opt-in. |

### T-WRTC-017 · Reputation manipulation via path diversity

| Campo | Valor |
|---|---|
| **Categoria** | 4 |
| **Descrição** | Atacante distribui Sybil peers em ASNs diversos (cloud providers diferentes: AWS us-east, GCP eu, Azure ap), maximizando path diversity score artificialmente. Vítima vê "alta diversidade" → confia. |
| **Vetor** | Mesmo botmaster, 1000 peers em 50 ASNs. Path diversity score (manifesto §20, `probe.ts` paradigma) flagueia como ótima rede; vítima depende deles para visão da rede. |
| **Impacto** | Integrity — **alta**. Bypass da defesa principal anti-eclipse. |
| **Probabilidade** | **Alta** em rede pequena. Custo do atacante: ~$100/mês em VPS. |
| **Mitigação Fase 6** | Em 6.2: path diversity é necessário-mas-não-suficiente. Combinar com: random walk obrigatório (descobrir peers não através dos peers atuais), NIP-65 follow graph (peers de gente que sigo via NIP-02), challenge-response (asks por dados que só peer honesto teria). Manifesto §20 já reconhece o limite ("sybil adaptativo com mimicry"). |
| **Mitigação Fase 7+** | Web of trust ponderado (NIP-02 follows × tempo). PoW opcional encarece Sybil. |
| **Aceito?** | **Não — crítico**. Recomendação prioritária pra 6.2. Documentar como limite em 6.1b release notes. |

### T-WRTC-018 · Targeted withholding (filtro invisível)

| Campo | Valor |
|---|---|
| **Categoria** | 4 |
| **Descrição** | Variante de T-009 mas sutil: peer atacante seedeia 99% dos posts honestamente, censura só posts de pubkeys-alvo. Difícil distinguir de "peer não tem aquele post ainda". |
| **Vetor** | B é seeder confiável por meses. Stato-nação coopta B (legal/coerção). B agora suprime posts de N pubkeys dissidentes. Vítima percebe "bolha" mas vincula a tema, não ao peer. |
| **Impacto** | Integrity — média. Forma de censura distribuída. |
| **Probabilidade** | Média. Requer adversário com leverage. |
| **Mitigação Fase 6** | `probe.ts` extension pra WebRTC (Fase 6.2): sample aleatório de eventos conhecidos × peers. Cruz-check entre peers. Flag se peer X consistentemente "não tem" eventos de pubkeys Y. |
| **Mitigação Fase 7+** | Auditoria comunitária — exportar probe results pra grafo público (com privacy preserving). |
| **Aceito?** | Não — endereçar em 6.2 com probe estendido. Limite §20 reconhecido. |

---

## Categoria 5 — Bugs implementáveis (errar é fácil)

### T-WRTC-019 · `outboundQueue` memory leak

| Campo | Valor |
|---|---|
| **Categoria** | 5 — Bug |
| **Descrição** | Mensagens enfileiradas em `peer.outboundQueue` antes de `dc.onopen` permanecem se DC nunca abrir. |
| **Vetor** | Peer B em ICE failed; A já chamou `publish()` 100×. Buffer cresce sem flush. |
| **Impacto** | Availability — média (memory leak local). |
| **Probabilidade** | Alta sem mitigação. |
| **Mitigação Fase 6** | **Mitigado em 6.1a** — plano §3 e §8.6 explícitos: reset `outboundQueue.length = 0` na transição `connecting → failed/closed`. Verificar implementação no commit C. |
| **Mitigação Fase 7+** | n/a |
| **Aceito?** | Mitigado. Test deve cobrir explicitamente. |

### T-WRTC-020 · Subscription órfã (memory leak)

| Campo | Valor |
|---|---|
| **Categoria** | 5 |
| **Descrição** | Caller chama `subscribe()` e nunca `Unsubscribe`; `seenIds` cresce até cap mas record vive. |
| **Vetor** | Hook React esquece cleanup → re-mount → vazamento progressivo. |
| **Impacto** | Availability — média. |
| **Probabilidade** | Alta (bug recorrente em React). |
| **Mitigação Fase 6** | **Mitigado em 6.1a** plano §8.4: cap `seenIds=1000` FIFO; warning DEV se `subscriptions.size > 50`; `closeAll()` limpa tudo. JSDoc contractual. |
| **Mitigação Fase 7+** | WeakRef em handlers? (overkill em 6.x). |
| **Aceito?** | Mitigado. |

### T-WRTC-021 · Race no handshake glare

| Campo | Valor |
|---|---|
| **Categoria** | 5 |
| **Descrição** | Dois peers A, B emitem `hello` simultaneamente; ambos tentam ser offerer; SDP collision. |
| **Vetor** | Boot sincronizado (e.g., 2 tabs abrindo juntas). |
| **Impacto** | Availability — baixa (handshake falha, retry funciona). |
| **Probabilidade** | Média. |
| **Mitigação Fase 6** | **Mitigado em 6.1a** §2: tie-break determinístico `min(myId, otherId) === myId` → este envia offer. Test cobre. |
| **Mitigação Fase 7+** | n/a |
| **Aceito?** | Mitigado. |

### T-WRTC-022 · Crypto random weak source

| Campo | Valor |
|---|---|
| **Categoria** | 5 |
| **Descrição** | `Math.random()` em vez de `crypto.getRandomValues()` para peerId, nonces, etc. |
| **Vetor** | Dev escreve `peerId = Math.random().toString(36)`. Predictable → atacante prediz peerIds → spoofing. |
| **Impacto** | Confidentiality + Integrity — média. |
| **Probabilidade** | Baixa (plano usa `crypto.randomUUID()` explicitamente — §3 e §8.7). |
| **Mitigação Fase 6** | **Mitigado em 6.1a** — `crypto.randomUUID()` lazy (§8.7). Lint rule sugerida: proibir `Math.random` em `src/lib/transport/**`. |
| **Mitigação Fase 7+** | n/a |
| **Aceito?** | Mitigado. Adicionar ESLint rule `no-restricted-globals` para `Math.random` em transport/. |

### T-WRTC-023 · Timing leaks em decrypt loop (NIP-44)

| Campo | Valor |
|---|---|
| **Categoria** | 5 |
| **Descrição** | Em 6.1b, decrypt de muitos DMs cifrados em loop síncrono pode bloquear main thread + timing leak via processamento variável. |
| **Vetor** | Atacante envia 1000 DMs cifrados; cliente decrypt sequencial bloqueia 500ms; user perceive UI freeze. |
| **Impacto** | Availability — média. Não é side-channel exploitable diretamente (nostr-tools NIP-44 v2 deve ser constant-time AEAD). |
| **Probabilidade** | Média. |
| **Mitigação Fase 6** | Em 6.1b: process signaling DMs num **worker** ou em batches com `await scheduler.yield()`/`setTimeout(0)`. Não no plano atual — adicionar. |
| **Mitigação Fase 7+** | n/a |
| **Aceito?** | Não — Ted: incluir async batching de signaling no plano 6.1b. |

---

## Conclusão — 3 recomendações prioritárias para Ted

### Recomendação #1 (CRÍTICA) — Cap de peers + rate-limit por peer ANTES de 6.1b

Ataques **T-WRTC-006 (Sybil)** e **T-WRTC-008 (DC flooding)** são triviais e
explorables no momento que signaling sair do mock. Antes de 6.1b mandar pra
qualquer ambiente compartilhado:

- Adicionar `MAX_PEERS = 32` constant em `webrtc.ts` (drop new peer connections além disso).
- `MAX_PEERS_PER_PUBKEY = 1` em 6.1b (rejeitar connection se pubkey já tem peer ativo).
- Rate-limit por peer no handler `handleDataChannelMessage`: 100 msg/s; excedeu → status `failed` + close. Token bucket simples no `PeerState`.
- Counter de eventos `kind not in DRIFT_KIND_SET` por peer; >50 → blacklist sessão.

Não é Fase 6.2 — é hardening do 6.1b. Sem isso, um peer hostil torna o cliente inutilizável.

### Recomendação #2 (ALTA) — Signaling identity ≠ posting identity em 6.1b

**T-WRTC-004 (Linkability)** + **T-WRTC-005 (grafo social)** ficam piores
em 6.1b se signaling NIP-44 usar a pubkey principal do user. Propor:

- Gerar **nsec efêmero** por sessão WebRTC (rotacionado a cada N min ou ao mudar de post seedeado).
- Anunciar ephemeral pubkey como destino de signaling via `tag` em evento Drift próprio (o **autor** do evento usa nsec principal; o **target de signaling** é o ephemeral). Não viola invariante #14 — usa kinds Drift existentes ou padrão NIP.
- Trade-off documentado: ephemeral keys quebram persistent reputation entre sessões. Default OFF, opt-in para usuários sensíveis. Manifesto §4 (anonimato por design).

Considerar com cuidado: solução pode tensionar invariante #14 — discutir opções concretas em RFC antes de implementar.

### Recomendação #3 (CRÍTICA arquitetural) — Bootstrap não-determinístico + random walk no 6.2

**T-WRTC-007 (eclipse via bootstrap)** + **T-WRTC-017 (reputation gaming)** são
o vetor de ataque dominante contra Drift WebRTC. Path diversity score sozinho é
**insuficiente** — atacante competente vence. Em 6.2, peer registry deve:

1. **Random walk obrigatório**: descobrir K peers via NIP-65 outbox, mas **não** conectar aos top-K por latência. Sample aleatório dentro do pool (manifesto §20).
2. **NIP-02 weighting**: dar prioridade a peers cuja pubkey aparece em `kind:3` follows do user (ou follows-of-follows). Web of trust de baixo custo.
3. **Probe estendido pra WebRTC** (`probe.ts` extension): aplicar mesma mecânica de probe contra peers. Reusa código existente — manifesto §20 já compromete.
4. **Cap por ASN**: max 4 peers por ASN/CIDR /16. Sybil distribuído é caro mas factível; cap reduz superfície.

Estes 4 itens são pré-requisito pra 7.1 (seeder em produção). Sem eles, seeding amplifica vetor de censura em vez de mitigar.

---

*Manifesto §20 reconhece honestamente: "Drift não impede mentira; impede consenso estável da mentira". Este threat model é a base operacional desse compromisso para o transport WebRTC.*
