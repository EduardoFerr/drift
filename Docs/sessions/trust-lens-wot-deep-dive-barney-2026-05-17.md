# Trust Lens — Web of Trust Deep Dive (Barney)

**Data:** 2026-05-17
**Persona:** Barney (peer review crítico + threat modeling)
**Escopo:** WoT mechanics aplicadas ao plano Phase 1. Complementa zero-trust survey do Ted.

## Veredito

**Drift Trust Lens é "WoT honesto que não promete o que não pode entregar — mas tem 4 gaps conceituais sérios e 8 attack vectors que o plano não nomeia."** Phase 1 ship-ready se honesto. Bandeira é Phase 3 multi-list — fronteira "WoT honesto" colapsa pra "WoT entregando promessas que não tem como cumprir".

## Taxonomia — onde Drift PPR encaixa precisamente

Drift PPR é classe específica: **WoT distribuído automático behavioral + capability-based view**. Trust derivada de comportamento observável (não atestação explícita) + cada viewer tem lente própria. **Sem precedente canônico bem-sucedido em produção** — Scuttlebutt FoF é mais próximo, estagnou. Drift está pioneirando uma classe.

Implicação: não importar lessons de WoT manual (PGP) achando que se aplicam.

## 8 Attack Patterns ALÉM de Sybil

| # | Ataque | P × S | Mitigação atual | Gap |
|---|---|---|---|---|
| A1 | Trust capture (rogue insider) | Alta × Alta | Nenhuma | GAP-REVOGAÇÃO — sem TOFU alarm |
| A2 | Trust drift (radicalização lenta) | Alta × Média | Nenhuma | GAP-DECAY — sem temporal decay |
| A3 | Eclipse via trust manipulation | Baixa × Alta | Probe Fase 5 cobre transport | OK |
| A4 | Trust laundering (compra retweet) | Média × Alta | M=0.3 path cap parcial | GAP-PATH-AUDIT |
| A5 | Reverse Sybil (brigading) | Média × Média | PPR per-viewer protege | GAP-VISIBILITY (vítima sem detect) |
| A6 | Bandwagon attack (Phase 3) | Alta × Média | "X% escondido" indicator | GAP-FALSE-NEG-VIS |
| A7 | Trust theft (NIP-02 reciprocidade) | Alta × Baixa | Drift não auto-follow | GAP-EXTERNAL-CLIENTS |
| A8 | Cross-context contamination | Certa × Média | Nenhuma | GAP-CONTEXT (fundamental) |

**5 dos 8 sem mitigação alguma.** 4 fundamentalmente impossíveis sem mudanças estruturais. Plano é honesto em não prometer defesa — manter assim.

## Revogação — gap conceitual mais sério

Plano Phase 1 não tem palavra "revogação". 3 gaps:

1. **Sem TOFU alarm**: nsec rotation não detectada (hijack mantém npub)
2. **Filter_rule local NÃO propaga pra PPR**: long-press esconde mas walks ainda passam → distribuem influence pra targets transitivos
3. **Phase 3 lista revogação**: compromised silencioso passa diff review

**Sugestão Phase 2:**
- `if filter_rule.action === 'hide' for target: influence_out = 0`
- TOFU-style "grafo mudou >40% em 24h" alarm (Ted Phase 3 → Phase 2 bump)

## Escala — viabilidade Drift millions

PPR escala matematicamente (Monte Carlo linear em K). Risco não é compute — é **distorção semântica em power-users**:

- Power-user 500 follows + 200 hubs (10k+ followers) → top-10 hubs receberão ~70% das visits (power-law)
- 10 npubs dominam feed re-ordenado — **hub tirania** não mencionada no plano

**Sugestão**: dampening hub indegree: `influence *= 1 / log(1 + target_followers)`.

## 8 Gaps no plano (priorizados)

### GAP-1 — Trust decay temporal (P0 conceitual)
Edge influence é cumulativo histórico. 100 spreads há 2 anos pesam igual a 100 spreads esta semana. Trust enrijece. Fix: `weight *= exp(-(now - last_spread_ts) / τ)` com τ=90d.

### GAP-2 — Filter rule não propaga pra edge influence
`filter_rule.action='hide'` veta render mas PPR continua visitando. Walks passam por target removido e amplificam transitivos. Fix: `edge.influence_out = 0` se hide rule active.

### GAP-3 — Transitive trust semântica não definida
PPR L=6 implica "Carla→Bia→Ana → trust Ana" automaticamente. Plano não documenta se isso é desejado.

### GAP-4 — Trust transfer cross-device
nsec preserved mas SQLite local. Novo device → cache vazio. Sugere snapshot encrypted opcional (privacy concern — grafo leak).

### GAP-5 — Explicit attestation primitive ausente
User só pode dizer "confio em @x" via follow. Sugere "anchor follow" (3-5 npubs manualmente designados como anchors com influence boost).

### GAP-6 — Cross-context contamination
@x dev confiável + spammer político mistura num número. Phase 3 multi-list PODE ser solução — reframe como "contextos".

### GAP-7 — PPR cache privacy (Fase 6)
`lens_walks_cache` em claro. Tauri attacker extrai grafo. At-rest encryption opcional Fase 6.

### GAP-8 — Conformance test #9 insuficiente
Adicionar grep `console.log` + Sentry em `trust-lens/*` proibindo emit de npub+score.

## 5 Cenários threat concretos

### Cenário A — Famous npub hijacked
50k followers, 2FA bypass via SIM-swap. 24h scam crypto. **Drift defesa Phase 1: zero.** Fix: TOFU alarm Phase 2.

### Cenário B — Coordinated political campaign
50 sock puppets, 6 meses honest, mês 7 messaging coordenada. Fix: cluster detection (SybilRank padrão).

### Cenário C — Mass-mute brigading
1000 users coordenam mute. Per-viewer PPR protege direct, mas target sem ferramenta detect self-isolation. Fix: "auto-check Rede" alarm.

### Cenário D — State actor "official lens"
Governo publica NIP-51 "Lente Oficial". User opt-in pensando neutralidade. Fix: refusal de gov-attested lists + disclosure obrigatório.

### Cenário E — Whaling: hub-npub compromise
@journalist 50k followers compromised. 100 paths × M=0.3 = 30, não 0.3. Fix: **aggregate cap por target_npub**: `final_score = min(final_score, P_MAX=0.2)`.

## 8 Insights outros sistemas WoT

| Sistema | Adopt/Avoid | Razão |
|---|---|---|
| Bluesky stackable labelers | **Adopt Phase 3** | Clean separation moderation source × user identity |
| Advogato max-flow capacity | **Adopt parcial** | Aggregate cap (Cenário E) absorve ideia |
| Keybase multi-proof | **Avoid** | Service died; NIP-05 cobre nicho honesto |
| EigenTrust pre-trusted seeds | **Avoid** | Já rejeitado por Ted §17 |
| Reputation slashing (Bitcoin) | **Avoid** | Manifesto §22 sem reputação |
| Signal Safety Number TOFU | **Adopt Phase 2** | Cenário A fix |
| Scuttlebutt FoF gossip | **Avoid storage** | "Download tudo" não escala |
| CT append-only logs | **Adopt spirit local** | "X% escondido" cumulative é local-CT-spirit |

## 5 Bandeiras vermelhas adicionais Phase 2/3

Plano §2.9 lista 6. Barney adiciona:

7. **Auto-boost por NIP-05 verified** — NIP-05 prova DNS, não trust. NÃO.
8. **PPR feedback em cliente próprio** ("você tem PPR alto") — vira karma → catedral. NÃO.
9. **Anchor follow auto-suggest onboarding** — vira default trust list de facto. NÃO.
10. **Telemetry PPR computation network** — agregado vira sinal. Medir só dev tools. NÃO.
11. **"Lente recomendada pra você"** ML — catedral amazon-style. NÃO.

## Sumário executivo

- **3 attack vectors fundamentais sem defesa** (A1 capture, A2 drift, A8 cross-context) — manter honestidade UX
- **GAP-1 e GAP-2 candidatos pra Phase 1 freeze ou Phase 1.1 patch** (decay temporal + filter→edge propagation)
- **Cenários A, C, E** merecem Phase 2 antes de Vertex DVM (defesa antes de aceleração)
- **5 bandeiras adicionais (7-11)** especialmente A7 NIP-05 verified ≠ trust
- **Phase 3 multi-list mais perigoso que plano sugere** — Cenário D state actor não-hipotético 2026 geopolitics
- **Hub tirania power-user** não discutido no plano — sugere hub dampening

**Plano passou peer review crítico. Não passa peer review paranoid.** Diferença é qual standard Drift quer alcançar. Manifesto sugere paranoid. Decida.

## Handoff por persona

- **GAP-1 decay** → Marshall (schema + pure function)
- **GAP-2 filter→edge** → Lily (core code + Phase 1.5 UX integration)
- **GAP-3 transitive semântica** → Ted (decisão arquitetural)
- **GAP-4 transfer** → Marshall + Lily
- **GAP-5 anchors** → Ted + Lily (primitive novo)
- **GAP-6 cross-context** → Robin (reframe Phase 3)
- **GAP-7 cache encryption** → Ted (Tauri-specific)
- **GAP-8 conformance** → Marshall
- **Cenário A TOFU alarm** → Ted + Marshall
- **Cenário B cluster detection** → Marshall (pure function)
- **Cenário C self-isolation alarm** → Lily
- **Cenário D state-actor hardening** → Robin + Ted
- **Cenário E aggregate cap** → Ted (algorithm change)
- **Bandeiras 7-11** → Barney pre-Phase-2/3 checkpoint
