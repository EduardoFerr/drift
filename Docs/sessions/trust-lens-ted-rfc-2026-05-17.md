# Trust Lens — Architecture RFC (Ted)

**Data:** 2026-05-17
**Persona:** Ted (arquitetura)
**Status:** RFC pré-implementação. Aguarda Barney (threat), Marshall (schema), Lily (UX), Robin (research).
**Manifesto:** v2.2 — §17, §22, §24, §25, §27, §28-30

---

## 0. Framing

User ask reduz a: **cada user roda seu próprio ranking/filter sobre o feed, derivado de web-of-trust, sem reintroduzir chave mestra.**

§24 explícito: "Bloqueios/silenciamentos são camada de **visualização local**, não de ranking." → trust lens é local view, protocolo canônico fica uniforme.

"Zero trust" em NIST 800-207 (BeyondCorp lineage): nenhum trust implícito de posição na rede; toda asserção verificada por uso; trust é **derivado, atribuído, revogável** — nunca ambiente.

---

## 1. Prior art (highlights)

### Web-of-trust históricos
- **PGP/OpenPGP WoT** — manual signing UX fatal. Não copiar.
- **Advogato** (Levien 2003) — max-flow attack-resistant. **Math correto: random walk com capacity constraint.**
- **Freenet WOT** — client-side WoT viável em graphs pequenos; storage growth é o custo real.
- **EigenTrust** (Kamvar 2003) — global view required → não fit client-only. **PPR (Personalized PageRank) sim.**
- **Bluesky Ozone** — stackable labelers; precedente direto pra §25.

### Math relevante
- **Personalized PageRank** (Haveliwala 2002) — random walk biased pro source node. **Exatamente "meu próprio algoritmo"** matematicamente.
- **Monte Carlo PPR** (Fogaras 2005) — aproximação O(walks × walk_length), trivialmente paralelizável.
- **SybilGuard/SybilRank** — honest region fast-mixing, sybil region não.
- **Trust transitivity decay** — FoF (depth 2) carrega sinal; FoFoF (depth 3) ruído; depth 4+ random.

### Nostr primitives já existentes
| NIP | Kind | Uso |
|---|---|---|
| NIP-02 | 3 | Follow list — edge atômico FoF |
| NIP-51 | 10000 | Mute list |
| **NIP-32** | **1985** | **Labeling events — Bluesky-Ozone-equivalent native** |
| NIP-56 | 1984 | Reports (já emitido por Drift) |
| NIP-78 | 30078 | App-specific data — filter rules portáveis |

**NIP-32 é o primitive crítico.** Underused, mas é a plumbing que Bluesky reinventou com Ozone.

---

## 2. Opções

### A — Heurísticas locais sobre primitives existentes
- Data: NIP-02 follows + kind 9079 SPREAD + kind 10000 mute (tudo já em SQLite)
- Algo: Approximate PPR via Monte Carlo, depth 3
- Score: `s_local = s_global × f(PPR(autor), mutual_spread, my_spreads − my_buries)`
- **Zero novos kinds.** ~400 LoC.
- Falha: cold start, Sybil via fake follows (mitigado pela direção do walk).

### B — Labelers NIP-32
- User subscribes a kind 1985 de labeler npubs que confia
- Cliente aplica união de labels com regras user-defined
- **Zero novos kinds.** ~600 LoC + UX.
- Falha: quem roda labelers? Discoverability. Risco de centralização de-facto.

### C — Novo kind de attestation
- Inventar kind 30382 ("npub A endorsa npub B")
- **Rejeitado**: §28-30 violation. NIP-32 já cobre semântica.

### D — Híbrido: A baseline + B Phase 2
- A zero-config default. B opt-in via Settings → labelers. Sem novos kinds.

### E — Implicit attestation de comportamento observado
- Próprios SPREADs (+) e BURYs/mutes (−) como sinais; sem novo primitive.
- BitTorrent tit-for-tat insight: trust por observação direta.
- **Folded into A.**

---

## 3. Recomendação: Option D (= A+E como Phase 1, B Phase 2)

### Phase 1 spec (A+E)

**SQLite local:**
```sql
trust_edges (
  source_npub TEXT,      -- = active identity
  target_npub TEXT,
  weight REAL,           -- derived, [0,1]
  components JSON,       -- {follow, mutual_spread, my_spread, my_bury, fof_paths}
  updated_at INTEGER,
  PRIMARY KEY (source_npub, target_npub)
)

trust_walks_cache (
  source_npub TEXT,
  target_npub TEXT,
  ppr_score REAL,
  computed_at INTEGER,
  PRIMARY KEY (source_npub, target_npub)
)

filter_rules (
  rule_id TEXT PRIMARY KEY,
  predicate JSON,        -- e.g. {trust_lt: 0.1, action: 'dim'}
  active INTEGER,
  created_at INTEGER
)
```

**Edge weight:**
```
weight = sigmoid(w₁·follow + w₂·log(1+mutual) + w₃·log(1+my_spreads) − w₄·log(1+my_buries))
```

**PPR Monte Carlo:**
- K=1000 walks, length L=4, damping α=0.15
- Recompute on follow change, every N=50 SPREAD/BURYs, or 24h
- Cost: ~50ms / 500-follow graph em mid-range phone

**Local score (view-boundary apenas):**
```
s_local = s_global × clip(α + β·ppr_score(autor) + γ·mutual_spread_post, 0.1, 3.0)
```

**`scoring.ts:calculateScore` permanece intocado.** Multiplicador aplicado SÓ no render — nunca persiste em `posts.score`.

### UX (Lily território)

- Settings → **"Lente de Confiança"** card
- Toggle: Off / Suave / Forte (presets de β, γ)
- Inspector long-press: "Por que vejo este post?" → path "você → @alice → @bob"
- Trigger onboarding: 10 follows + 7 dias ativo
- **Trust score nunca exposto publicamente** — lens é pessoal

### Cold start

- Sem follows → lens Off por default → cai no global feed
- Após 10 follows → prompt pra Suave preset

### Sybil resistance

- Fake accounts que TE seguem ganham PPR=0 (walk começa DE você; in-edges não importam)
- Sybil precisa: você seguir OU followee seu seguir + você reciprocar SPREAD
- Path diversity check: target trusted via 1 intermediário dim vs ≥2 disjoint paths

### Cost

- Bundle: ~6 KB gz
- Compute: ~50ms recompute debounced; ~0.1ms/post no render
- Storage: ~50 KB / 500 follows

### Manifesto check

| § | Verdict |
|---|---|
| §17 sem chave mestra | ✅ lens local, sem poder pra ninguém |
| §22 sem reputação subjetiva | ✅ canônico intocado |
| §24 sem afinidade no feed canônico | ✅ carve-out explícito |
| §25 sem chave mestra disfarçada | ✅ sem oracle único, toggle 1-click off |
| §27 auto-classificação | ✅ extensão natural |
| §28-30 compat ecossistema | ✅ zero novos kinds |

---

## 4. Riscos abertos (handoffs)

### Barney (threat)
- **Coordinated SPREAD rings** — clique pequeno com densidade interna alta amplifica via PPR
- **Followee compromise** — nsec leak de high-PPR follow amplifica
- **Trust leak via timing** — recompute leaks o quê?
- **Lens-flip attack** Phase 2 — labeler maligno

### Marshall (schema)
- JSON vs colunas em `trust_edges.components`
- Migration additive nullable
- Conformance test forbidding writes em `posts.score` fora de `scoring.ts`

### Lily (UX)
- Naming "Lente de Confiança" (PT-BR per CLAUDE.md)
- Inspector design discoverability
- Onboarding timing
- Magic vs transparência

### Robin (research)
- NIP-32 implementations em damus/snort/coracle pra learn from
- Mislove Ostra (NSDI 2008) + Viswanath SybilLimit revisit (IMC 2010)
- FoF benchmark em Nostr real-world graph

---

## 5. Decisão

**Phase 1 = Option A+E.** ~1000 LoC, +6 KB gz, ~1 semana focused work. Defer Phase 2 (NIP-32 labelers) até labeler market materializar — não shippar plumbing vazio.

**Próximo:** handoff aos 4 outros HIMYM pra deliberação cruzada antes de escrever plano de implementação.
