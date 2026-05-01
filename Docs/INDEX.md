# Drift — Índice de Documentação

> last-updated: 2026-04-29 · curador: Robin (research)

Mapa navegável de toda a documentação do repositório. Se você é novo aqui,
comece pela seção **Pra novo contribuidor**. Se já conhece, use **Por área**
ou **Por persona** pra pular direto.

---

## Pra novo contribuidor (ler nessa ordem)

1. **[../README.md](../README.md)** — visão geral 30s, swipes, stack, status
2. **[manifesto.md](manifesto.md)** — 34 princípios, contrato público (vence sobre arquitetura)
3. **[drift-arquitetura-v4.md](drift-arquitetura-v4.md)** — fonte da verdade técnica
4. **[../CLAUDE.md](../CLAUDE.md)** — invariantes operacionais (relevante mesmo sem usar Claude Code)
5. **[conformance-conversa-29-04.md](conformance-conversa-29-04.md)** — última verificação ampla de conformance (abril 2026), útil pra calibrar o que é compromisso vs aspiração

---

## Por área

### Manifesto / contrato
- **[manifesto.md](manifesto.md)** — 34 princípios + roadmap vinculante (v2.2, abril 2026)

### Arquitetura
- **[drift-arquitetura-v4.md](drift-arquitetura-v4.md)** — modelo, fluxos, decisões técnicas (v5.3, abril 2026)
- **[drift-fluxograma-v4.html](drift-fluxograma-v4.html)** — fluxograma visual interativo (v5.3)
- **[../CLAUDE.md](../CLAUDE.md)** — 17 invariantes operacionais (abril 2026)

### Fase 6 (cliente nativo + transports)
- **[webrtc-seeding.md](webrtc-seeding.md)** — visão geral WebRTC + Proof of Interest (TBD)
- **[webrtc-6.1a-plan.md](webrtc-6.1a-plan.md)** — esqueleto `transport/webrtc.ts` + signaling mock (entregue; 6.1a-C core shipped 2026-04-29)
- **[webrtc-6.1a-c-checklist.md](webrtc-6.1a-c-checklist.md)** — checklist de aceite 6.1a-C (Barney, 2026-04-29) — peer review + smoke test e2e
- **[webrtc-6.1b-plan.md](webrtc-6.1b-plan.md)** ✅ — signaling real via Nostr DM (NIP-44 + kind 1059) — shipped `0.6.0-alpha.1`
- **[webrtc-6.2-plan.md](webrtc-6.2-plan.md)** — peer registry SQLite + path diversity scoring + orchestrator multi-transport (em planejamento)
- **[webrtc-threats.md](webrtc-threats.md)** — threat model WebRTC, 23+ ameaças classificadas (v1.0, 2026-04-28)

### Fase 7 (distribuição)
- **Fase 7.1a** ✅ shipped — PoI auto-discovery via SpreadMap (Lily). `src/lib/seeder.ts:seedFromSpreaders(postId)` consumido por `useSpreadMap`. Manifesto §16 (espalhar = seedear). Detalhes em [../CHANGELOG.md](../CHANGELOG.md) `[Unreleased]` e [webrtc-seeding.md](webrtc-seeding.md) §"Fase 7.1".
- **[twa.md](twa.md)** — Trusted Web Activity Android (sub-fase 7.1, ✅ antecipada)
- **[fdroid.md](fdroid.md)** — submissão ao catálogo F-Droid (7.2, pendente)
- **[fase-6-roadmap.md](fase-6-roadmap.md)** — roadmap honesto da Fase 6 inteira (7 sub-fases, 6.1a/6.1b ✅; 6.2/6.3/6.4/6.5/6.6/6.7 ⏳). §15 (anti-censura) ainda não cumprido até 6.4+6.5+6.6 fecharem.
- *(futuro: `ipfs-pin.md`, `sneakernet.md`, `run-your-own-relay.md`)*

### Operacional
- **[tauri-setup.md](tauri-setup.md)** — setup do shell desktop Tauri (Fase 6.5 ✅ validado 2026-04-29). Pré-requisitos Rust, `npm run tauri:dev/build`, permissões mínimas (manifesto §17).
- **[build-reproducible.md](build-reproducible.md)** ✅ — Fase 6.7. Como verificar binário publicado vs source público. Docker + SHA256 + `Dockerfile.reproducible`. Linux PWA + Tauri bit-identical. Manifesto §17 (build reproduzível).
- **[deploy.md](deploy.md)** — Vercel + GitHub Releases + Cloudflare Tunnel + F-Droid/Play
- **[vercel-protection.md](vercel-protection.md)** — histórico do Deployment Protection (2026-04-29: mudou pra `preview-only`, justificativa + reversão)
- **[../CHANGELOG.md](../CHANGELOG.md)** — histórico de versões (último: v0.6.0-alpha.1, 2026-04-29)
- **[../LICENSE](../LICENSE)** — licença do projeto

### Pesquisa / análise
- **[research-backlog.md](research-backlog.md)** — itens externos pendentes enquanto WebFetch está bloqueado
- **[conversa-29-04-analise.md](conversa-29-04-analise.md)** — análise da conversa Gemini/ChatGPT do dia (Ted, 2026-04-29)- **[conformance-conversa-29-04.md](conformance-conversa-29-04.md)** — validação de conformance derivada da mesma conversa (Marshall, 2026-04-29)

---

## Por persona

### Sou um user querendo entender Drift
[../README.md](../README.md) → [manifesto.md](manifesto.md)

### Sou um dev querendo contribuir
[../README.md](../README.md) → [manifesto.md](manifesto.md) → [../CLAUDE.md](../CLAUDE.md) → [drift-arquitetura-v4.md](drift-arquitetura-v4.md)

### Sou um auditor de segurança
[manifesto.md](manifesto.md) §17 + §25 → [../CLAUDE.md](../CLAUDE.md) (invariantes #7, #8, #12) → [webrtc-threats.md](webrtc-threats.md) → [drift-arquitetura-v4.md](drift-arquitetura-v4.md) §36 (threat model geral) → [conformance-conversa-29-04.md](conformance-conversa-29-04.md)

### Quero rodar Drift no meu servidor
[deploy.md](deploy.md) → [../CHANGELOG.md](../CHANGELOG.md) (versões testadas) → release artifacts (`dist.zip` + `SHA256SUMS` em GitHub Releases)

### Quero contribuir pra Fase 6 (WebRTC)
[webrtc-seeding.md](webrtc-seeding.md) → [webrtc-6.1a-plan.md](webrtc-6.1a-plan.md) → [webrtc-6.1b-plan.md](webrtc-6.1b-plan.md) → [webrtc-6.2-plan.md](webrtc-6.2-plan.md) → [webrtc-threats.md](webrtc-threats.md)

### Quero empacotar Drift pra Android / F-Droid
[twa.md](twa.md) → [fdroid.md](fdroid.md) → [deploy.md](deploy.md) §4

### Sou pesquisador / quero atacar dúvidas externas
[research-backlog.md](research-backlog.md) → [conversa-29-04-analise.md](conversa-29-04-analise.md)

---

## Por princípio do manifesto

| Princípio | Onde é tratado |
|-----------|----------------|
| §2-3 identidade portável | [../CLAUDE.md](../CLAUDE.md) invariantes #8, #9, #15; `src/lib/identity.ts`, `lib/identities.ts` |
| §4 anonimato (não-mixnet) | [drift-arquitetura-v4.md](drift-arquitetura-v4.md) §36 threat model |
| §6 verdade por eventos | [conformance-conversa-29-04.md](conformance-conversa-29-04.md) §1 (spread+bury simultâneo) |
| §7 determinismo | [../CLAUDE.md](../CLAUDE.md) invariantes #3, #16 (Vitest tests) |
| §12 múltiplos transportes | [webrtc-seeding.md](webrtc-seeding.md), [webrtc-6.1a-plan.md](webrtc-6.1a-plan.md), [webrtc-6.2-plan.md](webrtc-6.2-plan.md), `src/lib/transport/` |
| §15 anti-censura por país | [webrtc-seeding.md](webrtc-seeding.md), Fase 6.3 (TBD: Tor via arti) |
| §16 disponibilidade distribuída | [webrtc-seeding.md](webrtc-seeding.md) (PoI seeder), [fdroid.md](fdroid.md), `lib/rebroadcast.ts` |
| §17 sem chave mestra + build reproduzível | [fdroid.md](fdroid.md), [../CLAUDE.md](../CLAUDE.md) invariante #12 |
| §20 resistência a isolamento | `lib/probe.ts` (probe anti-eclipse), [webrtc-threats.md](webrtc-threats.md), [webrtc-6.2-plan.md](webrtc-6.2-plan.md) (path diversity scoring) |
| §22, §24 score sem afinidade | [../CLAUDE.md](../CLAUDE.md) invariante #11; `src/lib/scoring.ts`; [conformance-conversa-29-04.md](conformance-conversa-29-04.md) (rejeição EigenTrust) |
| §23 bury não pune | `src/lib/scoring.ts` (peso simétrico) |
| §25 sem scan automático | [../CLAUDE.md](../CLAUDE.md) invariante #7 |
| §26 moderação reativa | `src/lib/moderation.ts` (threshold dinâmico) |
| §27 auto-classificação voluntária | `content-warning` tag, `lib/feed.ts:applyContentFilters` |
| §28-30 compatibilidade Nostr | [drift-arquitetura-v4.md](drift-arquitetura-v4.md) §30.12-13; `lib/nip65.ts`, `lib/follows.ts`, `lib/bip39.ts` |

---

## TL;DR de cada doc

| Doc | TL;DR |
|-----|-------|
| [../README.md](../README.md) | Visão de 30s. Stack, kinds 9078-9081, garantias resumidas, setup local. Aponta pra manifesto pra spec completa. |
| [../CLAUDE.md](../CLAUDE.md) | Instruções pra Claude Code: TL;DR do sistema, 17 invariantes que se quebrados quebram o sistema, stack pinado, padrões (Zustand, SQL via worker, idempotência), tecnologias proibidas. Útil pra qualquer dev. |
| [../CHANGELOG.md](../CHANGELOG.md) | Keep a Changelog. Última: v0.6.0-alpha.1 (Phase 6.1b: NIP-44 signaling real), v0.6.0-alpha.0 (Phase 6.1a-C: WebRTC core + heatmap + multi-tab modal), v0.5.4 (TWA bubblewrap driver). |
| [../LICENSE](../LICENSE) | Licença do repositório. |
| [manifesto.md](manifesto.md) | Contrato técnico v2.2. 34 princípios divididos em 5 partes (Existência/Identidade, Eventos, Transporte, Score/Comunidade, Compromisso). Cada princípio tem Regras + Implementação + Fase. Vence sobre arquitetura quando conflita. |
| [drift-arquitetura-v4.md](drift-arquitetura-v4.md) | Documento técnico completo v5.3. 36 seções incluindo modelo de dados, fluxos, schema SQLite, transport abstract, decisões registradas (§30.x), tests (§34), threat model (§36). Mudanças vs v5.2 documentadas no topo. |
| [drift-fluxograma-v4.html](drift-fluxograma-v4.html) | Visualização interativa dos fluxos da arquitetura v5.3. Página HTML standalone, fundo escuro, monospace. |
| [deploy.md](deploy.md) | 4 caminhos pra rodar Drift em produção: Vercel (recomendado, COOP/COEP corretos, push em main → deploy), GitHub Releases (`dist.zip` por tag), Cloudflare Tunnel (dev), F-Droid/Play (TWA). |
| [twa.md](twa.md) | Sub-fase 7.1, ✅ implementada. Embrulha PWA Vercel num APK Android via Bubblewrap. ~3MB, atualização instantânea via deploy do site. Inclui keystore setup + assetlinks SHA256. Comparação com Capacitor. |
| [fdroid.md](fdroid.md) | Sub-fase 7.2, pendente. Submissão ao catálogo F-Droid OSS. Lista pré-requisitos, conflitos identificados (`VITE_PHOTODNA_KEY` no `.env.example`, host Vercel = AntiFeature `NonFreeNet`), esboço `metadata/com.driftnet.client.yml`. Bloqueador atual: repo precisa ser público. |
| [webrtc-seeding.md](webrtc-seeding.md) | Visão geral: dispositivos Drift como relays Nostr efêmeros via WebRTC, ativados por interesse contextual (abrir mapa de spread → vira seeder). Compatibilidade com manifesto detalhada (fortalece §12/§16/§15/§20; tensões com invariante #14 e como resolver via NIP-65 estendido + DM NIP-44). |
| [webrtc-6.1a-plan.md](webrtc-6.1a-plan.md) | Plano da sub-fase 6.1a: especificação `Transport`, esqueleto `webrtc.ts`, BroadcastChannel mock signaling, armadilhas de teste. Status: entregue (matchFilter + signaling-mock shipped 2026-04-28). |
| [webrtc-6.1b-plan.md](webrtc-6.1b-plan.md) | Sub-fase 6.1b ✅ entregue em `0.6.0-alpha.1`: signaling via Nostr DM cifrado (NIP-44 v2 + kind 1059 gift wrap minimal, sem NIP-17 seal). Zero deps novas (nostr-tools 2.7.0 já tem `nip44`). Discovery PoI-only. Doc mantido como referência histórica do plano executado. |
| [webrtc-6.2-plan.md](webrtc-6.2-plan.md) | Plano sub-fase 6.2 (Ted, 2026-04-28): `peers_known` SQLite (migration v7) + `scorePeer()` puro (latência+fail+ASN/country diversity) + `transport/orchestrator.ts` que substitui chamadas diretas a `wssTransport` em `sync.ts` + caps (MAX_PEERS=32, 1 conn/pubkey, 100 msg/s). Endereça T-WRTC-006/007/008/010/017. |
| [webrtc-threats.md](webrtc-threats.md) | Threat model dedicado WebRTC v1.0 (Barney, 2026-04-28). 23+ ameaças classificadas em 5 categorias (Peer / Rede / Signaling / Discovery / Recursos), cada uma com probabilidade, mitigação por fase, status (Aceito / Aberto / Crítico). Complementa §36 da arquitetura. |
| [research-backlog.md](research-backlog.md) | Itens externos pendentes enquanto WebFetch está bloqueado. Cada item: pergunta + por quê bloqueia + workaround interim + fonte ideal. Mantida pela Robin. ~25 itens organizados por fase. |
| [conversa-29-04-analise.md](conversa-29-04-analise.md) | Análise técnica da conversa do dia com Gemini/ChatGPT — propostas de defesa Sybil, EigenTrust, debate sobre afinidade no feed, decisões registradas (Ted, 2026-04-29). |
| [conformance-conversa-29-04.md](conformance-conversa-29-04.md) | Validação por Marshall (2026-04-29) de tudo que apareceu na conversa do dia contra invariantes do CLAUDE.md e princípios do manifesto. Identifica bug "spread+bury simultâneo do mesmo user" (UI não bloqueia), valida rejeição de EigenTrust como afinidade implícita (§24), confirma conformance dos planos 6.2. |

---

## Por sessão (histórico recente)

### 2026-04-28 — Fase 6.1a-A/B + cleanup
- 6.1a-A `matchFilter` NIP-01 + cobertura pré-6.1a (5 agentes paralelos)
- 6.1a-B `webrtc-signaling-mock` BroadcastChannel
- threat model WebRTC ([webrtc-threats.md](webrtc-threats.md)) — 23 ameaças (Barney)
- research backlog ([research-backlog.md](research-backlog.md))
- 6.1b shipped em `0.6.0-alpha.1` (CHANGELOG)
- plano 6.2 ([webrtc-6.2-plan.md](webrtc-6.2-plan.md)) — Ted
- fix GPS warm-up + indicador (captura antes de `createPost`/`spreadPost`)

### 2026-04-29 — Análise conversa Gemini/ChatGPT + scoring weighted + Fase 6.1a-C
- [conversa-29-04-analise.md](conversa-29-04-analise.md) (Ted) — síntese das propostas externas
- [conformance-conversa-29-04.md](conformance-conversa-29-04.md) (Marshall) — validação contra invariantes/manifesto
- fix sync entre devices (Barney) — janela 24h→7d em `sync.ts` (commit 6062422)
- fix mapa não abre (Lily) — migration `spreads.location` (commit 6062422)
- scoring "última ação vale" (spread+bury simultâneo do mesmo user resolve pelo `created_at` mais recente) + scoring weighted Σ`weight` em vez de COUNT (anti-Sybil, manifesto §22/§24) + UX `myActions` em `ProfileModal` (commit 3cdd211)
- chunking 500-by-500 em `recalculateScore` (mitiga estouro `IN(?)` em posts virais) + `getWeightTier` função pura (sinal social, manifesto §22)
- manifesto §23 estendido com seções "Mudança de opinião" e "Score weighted"; §24 fórmula atualizada
- fix hints enganosos em `location_granularity` (manifesto §28) — commit 9240064
- **GpsErrorBanner** (Lily) — `src/components/UI/GpsErrorBanner.tsx` + `GpsHelpModal` interno; `geolocation.ts` ganhou `lastFailureReason` + getter; `App.tsx` integra banner gated por `granularity != 'off'` + janela <60s + não-dismissed; +7 tests
- **Badge weight tier no ProfileModal** (Marshall) — integra `getWeightTier`, remove número exato (gaming-resistant), 3 tiers (🏆 estabelecido / ⭐ ativo / 🌱 novo) com tooltip §22
- **`transport/webrtc.ts` core** (Ted, Fase 6.1a-C) — 432 LOC publish/subscribe/health + RTCPeerConnection; pipeline §5 com kind check pré-verify; `pagehide` cleanup; outboundQueue reset em failed/closed; DEV bridge `window.driftWebRTC` em `src/main.tsx`
- **Checklist 6.1a-C** (Barney) — [webrtc-6.1a-c-checklist.md](webrtc-6.1a-c-checklist.md) peer review + smoke test e2e
- atualização do INDEX + CHANGELOG (Robin)

---

## Buracos conhecidos

- Docs prometidos pelas Fases 6/7 ainda não criados: `ipfs-pin.md` (Fase 7), `sneakernet.md` (Fase 7), `run-your-own-relay.md` (Fase 7), `tor-arti.md` (Fase 6.3), `capacitor.md` (alternativa TWA).
- Nenhum doc tem campo formal `last-updated:` no frontmatter — datas inferidas via versão (manifesto v2.2, arquitetura v5.3) ou cabeçalho (`webrtc-threats.md` 2026-04-28, `webrtc-6.2-plan.md` 2026-04-28).
- `Docs/icones-oquesao-cada um.PNG` é asset órfão (sem doc explicando o que documenta).
- ~~`getWeightTier` ainda não aplicada na UI~~ — resolvido em 2026-04-29 (badge tier no `ProfileModal`, Marshall).
