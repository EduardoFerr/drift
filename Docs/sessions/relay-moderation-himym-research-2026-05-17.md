# Relay Moderation — HIMYM Research Session

**Data:** 2026-05-17
**Trigger:** Backlog R26-R32 (relay moderation landscape).
**Personas:** Robin (curadoria), Ted (arquitetura), Marshall (schema/NIP-56), Barney (threat), Lily (UX).
**Status:** ✅ Fase A IMPLEMENTADA e shipped (11 commits 2026-05-17). Esse doc preserva a pesquisa original.

## Mapeamento research → commits shipped

| Item proposto na pesquisa | Status | Commit |
|---|---|---|
| Lista curada Robin → `Docs/curated-relays-YYYY-MM.json` | ✅ | `567870a` feat(relays): curated directory + NIP-11 fetch |
| Manifesto §17 adendo (cliente vs operador de relay) | ✅ | `cef9e4b` docs(manifesto): §17 adendo + CLAUDE invariante #18 |
| CLAUDE.md invariante #18 (relay moderado é opt-in) | ✅ | `cef9e4b` (mesmo commit acima) |
| NIP-56 (kind 1984) dual emit + ingest + LOCK_VIA_TEST | ✅ | `b17e2ca` feat(reports): NIP-56 kind 1984 dual emit |
| Salvaguarda D2 — silent-drop warning quando há relay moderado | ✅ | `f5bae5d` feat(relays): D2 + D3 guardrails Barney |
| Salvaguarda D3 — RelayTierBadge per relay (none / manual / ai-assisted / ai-automated) | ✅ | `f5bae5d` (mesmo) |
| Salvaguarda D4 — warning de privacidade do reporter pré-submit | ✅ | `5e38205` feat(ux): D4 warning reporter privacy |
| DiscoverRelaysCard Lily (5 tabs por política) | ✅ | `df9e1b8` feat(relays): DiscoverRelaysCard + banner one-time |
| DiscoverNudgeBanner one-time (E6 da deliberação) | ✅ | `df9e1b8` (mesmo) |
| `Docs/run-your-own-relay-with-ai.md` (Ted) | ✅ | `5e38205` (mesmo de D4) |
| CI mensal curated-relays-health (A5) | ✅ | `93ce889` feat(ci): A5 monthly curated relays health check |

## Items conscientemente deferred (NÃO no scope original deste doc, surgiram durante implementação)

- **A3** — reavaliar damus.io no SEED. Precisa telemetria runtime (1-2 semanas de health data) pra decidir.
- **D6** — contador de relays OK por post ("publicado em N/M relays"). Substancial, mexe em `feed.ts`/`protocol.ts`. UX-polish, não guardrail crítico.
- Adicionar `wss://relay.nos.social` (Tagr Bot opt-in) + `wss://nos.lol` (high-volume free) ao SEED — pendente decisão.

Conteúdo original da pesquisa preservado abaixo.

---

---

## TL;DR

5 análises paralelas cobrem:

1. **Landscape** (Robin) — quais relays existem hoje, moderação por categoria, recomendações pra `SEED_RELAY_CONFIGS`.
2. **Run-your-own-relay com IA** (Ted) — stack strfry + plugin + AI classifier, custo ~€5/mês.
3. **NIP-56 implementation** (Marshall) — emitir kind 1984 lado-a-lado com kind 9081 Drift.
4. **Threat model** (Barney) — riscos de relay-as-censor, AI bias documentado, NIP-56 reporter privacy leak.
5. **Discovery UX** (Lily) — sub-card "Descobrir" em Settings > Relays com tabs por política.

**Veredito conjunto:** feature é viável MAS exige guardrails fortes — sem eles, viola §17 (sem chave mestra disfarçada), §24 (sem afinidade no feed) e §27 (filter é do user, não do servidor).

---

## 1. Robin — Landscape de relays (2026-05)

### Moderados / family-friendly

| Relay | Política | Custo | Source |
|---|---|---|---|
| `wss://relay.nos.social` | Tagr Bot via NIP-56 (kind 1984), opt-in | Grátis | [nos.social/tagr-bot](https://www.nos.social/tagr-bot) |
| `wss://nostr.wine` | Whitelist via NIP-42 (paywall anti-spam) | ~10k sats/mês | [filter.nostr.wine](https://nostr-wine.github.io/filter-relay/) |
| `wss://relay.damus.io` | Posting paid-only (Damus Purple ~$7/mês) | Paid | [Damus Purple #659](https://github.com/damus-io/damus/issues/659) |
| `wss://nostr.land` | Premium spam-free, Lightning paywall | Paid | [nostr.co.uk/relays](https://nostr.co.uk/relays/) |
| `wss://filter.nostr.wine` | Web-of-contacts filter (follows-of-follows) | 10k sats/mês | [docs.nostr.wine](https://docs.nostr.wine/filter/readme) |

### Sem moderação / free-speech

| Relay | Política | Custo |
|---|---|---|
| `wss://nos.lol` | Public, alto volume + spam | Grátis |
| `wss://relay.snort.social` | Public, sem rejeição | Grátis |
| `wss://nostr.sethforprivacy.com` | Cloud diverso (Bytefilter) | Grátis |
| `wss://relay.primal.net` | Infra Primal, filtros mínimos | Grátis |

### Onion (Tor hidden service)

`oxtr.dev`, `snort.social`, `nostr.land`, `bitcoiner.social` — todos com mirror `.onion` documentado em [0xtrr/onion-service-nostr-relays](https://github.com/0xtrr/onion-service-nostr-relays).

### Recomendações pra Drift `SEED_RELAY_CONFIGS`

**ADICIONAR:**
- `wss://relay.nos.social` — único moderado opt-in que respeita §25 (user escolhe seguir o bot)
- `wss://nos.lol` — high-volume free, complementa damus.io

**EVITAR:**
- `wss://nostr.wine` / `filter.nostr.wine` — paywall NIP-42. Drift hoje não implementa NIP-42; user fica sem cobertura silenciosamente.
- `wss://relay.damus.io` como único default — restrição de posting a Purple subs em alguns períodos.

**Disclaimer técnico:** [95% dos relays Nostr não cobrem custo operacional](https://dev.to/jonathan_greenallidoizc/95-of-nostr-relays-cant-cover-costs-heres-why-that-matters-189l); 343 de 1000 já saíram do ar. Recomenda CI mensal validando saúde via `health()` do transport.

---

## 2. Ted — Stack pra Drift Community Relay

### Recomendado

**Backend:** strfry + plugin Node.js TypeScript via stdin/stdout JSONL.

Por quê strfry vs khatru/nostr-rs-relay:
- 23% dos relays reachable, LMDB rápido, negentropy nativo (set reconciliation pra sync incremental)
- Plugin neutro à linguagem
- Comunidade pode forkar policy sem rebuild

### Pipeline (write policy)

```
stdin (JSONL)
  ├─ Stage 1 [0.05ms]  kind/schema check (whitelist Drift kinds + NIP-01 padrão)
  ├─ Stage 2 [0.5ms]   local cache lookup (reports acumulados → shadowReject)
  ├─ Stage 3 [50-300ms] AI classifier (OpenAI Moderation API texto + NudeNet local imagens)
  └─ Stage 4           store via strfry LMDB
```

**Fail-open em timeout** (manifesto §16: cliente continua tendo onde escrever).

### Custo operacional

| Item | Custo/mês |
|---|---|
| Hetzner CAX11 (ARM, 2 vCPU, 4GB, 40GB NVMe) | €3.79 |
| OpenAI Moderation API (free) | $0 |
| NudeNet ONNX local (CPU, 142ms/imagem) | €0 |
| TLS Let's Encrypt + domínio | ~€1 |
| **Total** | **~€5/mês** pra 1000 active users |

### Trade-offs por classifier

| Classifier | Custo | Latência | Privacy | Recomendação |
|---|---|---|---|---|
| **OpenAI Moderation** | $0 | 80-200ms | log moderado | Default texto |
| **NudeNet ONNX local** | $0 | ~142ms/img | máxima | Sidecar imagens |
| **llama.cpp + Llama-Guard 2B** | $0 | 800ms-3s | máxima | Avançado (RAM 8GB+) |

### Integração manifesto

NIP-11 com campo custom `drift_policy`:
```jsonc
{
  "supported_nips": [1, 9, 11, 42, 56, 65],
  "drift_policy": {
    "version": "1.0",
    "classifiers": ["openai-moderation", "nudenet-v3"],
    "rejects": ["nsfw-unflagged", "hate", "self-harm"],
    "appeal_contact": "abuse@example.org"
  }
}
```

Cliente Drift lê `drift_policy` no NIP-11 fetch e exibe **badge "AI-Moderated"** ao lado do relay em `RelaySettings`.

**Crítico:** relay moderado é **opt-in via lista do user** (`relays_user`), nunca hardcoded em `SEED_RELAY_CONFIGS`.

---

## 3. Marshall — NIP-56 implementation

### Decisão recomendada

**Opção B: emitir AMBOS (9081 + 1984)** com dedup canônico no SQLite via LWW por `(post_id, reporter_pub, created_at)`.

Razão:
1. Manifesto §29 exige interop Nostr — kind 9081 é dialeto privado
2. Threshold dinâmico (§26) depende do pipeline SQLite — não pode dropar 9081 sem migrar
3. Custo de migração ~350-450 LOC + tests

### Schema NIP-56 pra Drift emitir

```
kind: 1984
content: ''  // Drift sempre vazio (manifesto §29 minimal data)
tags:
  ['e', '<event_id>', '', '<report_type>']  // reason no [3]
  ['p', '<pubkey>',   '', '<report_type>']
  ['drift-version', '<version>']
  ['client', '<CLIENT_ID>']
```

### Mapeamento de reason

| Drift emit | NIP-56 emit | NIP-56 ingestão → Drift bucket |
|---|---|---|
| `illegal` | `illegal` | `illegal`, `malware` → `illegal` |
| `spam` | `spam` | `spam`, `impersonation`, `profanity` → `spam` |
| `harassment` | `other` (NIP-56 sem canônico) | `nudity` → `spam` (já cobrimos via content-warning §27) |

### Pipeline events.ts

- Adicionar `1984` ao `KIND_DISPATCH` com `validate1984Shape` + `persist1984Report`
- LWW por `created_at` em `(post_id, reporter_pub)` UNIQUE
- Reusa `maybeModerate` — zero mudança no threshold

### LOCK_VIA_TEST proposto

1. Wire format NIP-56 conformance (tags + reason position)
2. Reason whitelist enforcement (7 valores canônicos)
3. Mapping bidirecional determinístico (manifesto §7)
4. Dedup cross-kind (9081 + 1984 do mesmo reporter = 1 row)
5. Threshold pipeline preserva score=-999 com fixtures
6. Compat retro (SQLite sem coluna `kind` → boot com migration default 9081)

---

## 4. Barney — Threat model

### Tier 1 — riscos altos (UI deve avisar inline)

**1. Relay-as-censor invisível** — Nostr não exige relay reportar rejeição. [Proposta W3C March 2025](https://lists.w3.org/Archives/Public/public-nostr/2025Mar/0008.html) reconhece: "there is no way for users to ensure that relays are not censoring or tampering". Mitigação: pub em ≥2 relays + UI mostra count confirmados.

**2. AI bias documentado** — Tumblr 2018 ban [resultou em settlement NYC Human Rights por viés algorítmico](https://www.engadget.com/tumblr-porn-ban-settlement-algorithm-training-184739455.html). Pesquisas atuais ([UQ News 2026](https://news.uq.edu.au/2026-04-how-ai-bias-can-creep-online-content-moderation), [Frontiers 2024](https://www.frontiersin.org/journals/communication/articles/10.3389/fcomm.2024.1385869/full)) confirmam LLM moderation flag minorias mais. [EFF 2024](https://www.eff.org/deeplinks/2024/06/global-suppression-online-lgbtq-speech-continues) documenta supressão LGBTQ+ via filtros "neutros".

**3. NIP-56 reporter privacy leak** — report é evento público assinado. Target sabe quem reportou; stalker mapeia padrões; retaliação trivial. [Discussão NIP-56 PR #205](https://github.com/nostr-protocol/nips/pull/205) reconhece: "private reporting would have to be a separate nip" — não existe ainda.

### Tier 2 — riscos médios

**4. "Family-friendly" lock-in + dog whistle** — [décadas de uso anti-LGBTQ+](https://swu-union.org.uk/2023/01/part-4-dog-whistles-in-context-transphobia/). User opta uma vez, nunca mais sabe o que foi dropado.

**5. False positives em arte/educação** — Vênus, Goya, breast health, sex ed, mental health.

**6. Pay-walled relays excluem low-income** — pressão econômica empurra qualidade pra paid; divide rede por classe.

### Salvaguardas obrigatórias na UI Drift

1. **NUNCA** default-on relay moderado
2. **Aviso inline**: "este relay pode dropar posts sem te notificar"
3. **TIER visível** em cada card: `none` / `manual` / `ai-assisted` / `ai-automated` ⚠
4. **"Adicionar relay sem moderação" 1-clique** — fricção simétrica
5. **Warning antes de submit de report**: "público, assinado, target verá quem reportou. Considere identidade descartável (§15)"

### Red flags (NÃO incluir em SEED list)

- Sem política pública documentada
- Requer KYC (quebra §3)
- Delete por operator sem evento Nostr (silent edit history)
- Operador em jurisdição autoritária
- AI scan obrigatório sem audit público do modelo
- "Wholesome" / "community standards" sem definição testável

### Veredito

Feature defensável SE E SOMENTE SE as 5 salvaguardas forem hard requirements. Risco real não é o user que escolhe relay moderado — é o user que **não percebeu que escolheu**.

---

## 5. Lily — UX de Discovery

### Referências analisadas

- **Damus iOS** — só lista crua, zero curadoria
- **Snort** — dropdown "Popular Relays" estático
- **Coracle** — marketplace com filtros (Public/Private/Paid), pull NIP-11
- **Iris** — lista plana
- **Mastodon `joinmastodon.org`** — referência canônica (filtros por região/idioma/moderação, regras visíveis, sinal de saúde)
- **Bluesky labelers** — paradigma mais próximo: user escolhe múltiplos labelers, labels combinam

### UX proposta — Settings > Relays > sub-card "Descobrir"

NÃO menu novo (Settings já crowded). Sub-card lançado a partir de RelaySettings.

```
[hero — 2 frases]
Descobrir relays
Drift conecta a múltiplos servidores (relays). Cada relay
decide o que aceita guardar. Você escolhe quais usar.

[segmented control]
recomendados · family-friendly · livre · community · onion

[lista de relay cards]

  ┌─────────────────────────────────────────┐
  │ relay.damus.io               [adicionar]│
  │ ✓ moderado · grátis · ~80ms             │
  │ filtros: spam, illegal                  │
  │ supports: 1, 4, 11, 65                  │
  └─────────────────────────────────────────┘
  [tap pra expandir → modal NIP-11 dump]

[footer]
ⓘ você decide. drift não escaneia (§7). relay pode (§17, §27).   → manifesto
```

### Anatomia do card

1. **Nome canônico** alto contraste
2. **Badge de política** uma só, com tom semântico:
   - 🟢 `moderado por Tagr Bot` (drift-spread)
   - 🟡 `auto-classificação apenas` (drift-warning)
   - 🔴 `sem moderação` (drift-danger sem alarmismo)
3. **Custo + latência** mono pequeno
4. **NIPs suportados** chips clicáveis
5. **Botão `adicionar`** single-click; toggle pra "remover"

Tap no card abre modal NIP-11 dump completo. **Sem reviews de peers** (manifesto §22 — sem reputação subjetiva).

### Discovery automática — quando empurrar?

- **A.** Primeira boot ❌ rejeitado (decisão prematura)
- **B.** Settings sempre disponível ✓
- **C.** Banner one-time pós-7 dias OU 50 posts vistos, dismissible permanente ✓

**Recomendação:** B + C.

### Modelo de dados

```ts
// src/config/relays-directory.ts (JSON estático bundle)
interface RelayDirectoryEntry {
  url: string
  onion?: string
  tab: 'curated' | 'family' | 'free' | 'community' | 'onion'
  policy: 'moderated' | 'self-classify' | 'unmoderated' | 'private'
  policyDetail: string
  cost: 'free' | { perMonth: number; currency: 'USD'|'BTC' }
  policyUrl?: string
  trustNote?: string
}
```

NIP-11 fetch lazy só na tab aberta. Cache 24h em nova tabela `relay_directory_cache`.

### Custo de implementação

| Item | Esforço |
|---|---|
| Curated JSON (~25 relays) | 1d (depende R26/R27) |
| `lib/relay-directory.ts` + NIP-11 fetcher + cache | 2d |
| `DiscoverRelaysCard` component | 3d |
| Migration v9 `relay_directory_cache` | 0.5d |
| Banner one-time pós-onboarding | 0.5d |
| Test NIP-11 parser conformance | 1d |

**Total: ~8 dias.** Encaixa em Fase 7 (distribuição) — fundamental pra TWA Android e F-Droid.

### Riscos / decisões pendentes

1. **Curated list é proto-chave-mestra?** Mitigação: versionada em git público + adicionar manual sempre disponível. Lista é **sugestão**, não whitelist. Documentar em §17.
2. **NIP-11 expõe IP?** Sim. Em `network_mode=tor` roteia via arti. Aceitável (igual WSS connect).
3. **Latency probe é fingerprint?** Pequeno, não correlaciona com identidade.
4. **Tab "community/NIP-29"**: NIP-29 ainda draft. Ship sem inicialmente.
5. **Sem reviews/social proof** — manifesto §22 fecha. Coracle faz; Drift NÃO faz.

---

## Próximos passos sugeridos (não executados nesta sessão)

1. **Decisão de scope**: implementar quais sub-features? (NIP-56, Discovery UX, Community Relay docs)
2. **Antes de tudo**: confirmar lista curada Robin (R26/R27 viraram ações concretas)
3. **Manifesto adendo**: documentar explicitamente que relay moderado é **vetor adicional**, não substituto do feed neutro. Atualizar §17 com nota de escopo (operador de relay vs cliente).
4. **Ordem natural**:
   - 4.1. Lista curada Robin → atualizar `Docs/curated-relays-2026-05.json`
   - 4.2. NIP-56 emit/ingest Marshall → kind 1984 pipeline
   - 4.3. DiscoverRelaysCard Lily → sub-card descoberta
   - 4.4. Run-your-own-relay Ted → guide separado em `Docs/` quando comunidade pedir

---

## Sources (consolidadas)

**Spec:**
- [NIP-11 — Relay Information Document](https://github.com/nostr-protocol/nips/blob/master/11.md)
- [NIP-29 — Community Groups](https://nips.nostr.com/29)
- [NIP-56 — Reporting (kind 1984)](https://github.com/nostr-protocol/nips/blob/master/56.md)
- [NIP-56 PR #205 discussion](https://github.com/nostr-protocol/nips/pull/205)

**Tools:**
- [strfry](https://github.com/hoytech/strfry) + [plugin docs](https://github.com/hoytech/strfry/blob/master/docs/plugins.md)
- [khatru framework](https://github.com/fiatjaf/khatru)
- [NudeNet](https://github.com/notai-tech/NudeNet)
- [OpenAI Moderation API](https://platform.openai.com/docs/guides/moderation)

**Discovery:**
- [nostr.watch](https://nostr.watch/) — relay health monitoring
- [nostr.co.uk/relays](https://nostr.co.uk/relays/) — directory
- [nostr.how/relays](https://nostr.how/en/relays)

**Bias / threat model:**
- [Tumblr 2018 settlement](https://www.engadget.com/tumblr-porn-ban-settlement-algorithm-training-184739455.html)
- [UQ — AI bias in content moderation 2026](https://news.uq.edu.au/2026-04-how-ai-bias-can-creep-online-content-moderation)
- [Frontiers — Instagram moderation bias 2024](https://www.frontiersin.org/journals/communication/articles/10.3389/fcomm.2024.1385869/full)
- [EFF — LGBTQ+ speech suppression](https://www.eff.org/deeplinks/2024/06/global-suppression-online-lgbtq-speech-continues)
- [W3C — Nostr censorship verification gap](https://lists.w3.org/Archives/Public/public-nostr/2025Mar/0008.html)
- [95% relays não cobrem custos](https://dev.to/jonathan_greenallidoizc/95-of-nostr-relays-cant-cover-costs-heres-why-that-matters-189l)

**Other clients UX reference:**
- [Damus](https://damus.io/support/) (+ [GitHub](https://github.com/damus-io/damus))
- [Snort](https://snort.social)
- [Coracle](https://github.com/coracle-social/coracle)
- [joinmastodon.org/servers](https://joinmastodon.org/servers) — picker reference
- [join-lemmy.org/instances](https://join-lemmy.org/instances)
- [Bluesky labelers docs](https://docs.bsky.app/docs/advanced-guides/moderation)

---

*Documento mantido por Robin (curadoria). Última atualização: 2026-05-17.*
