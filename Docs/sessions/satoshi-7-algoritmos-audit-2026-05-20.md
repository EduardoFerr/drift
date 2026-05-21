# Satoshi — Auditoria adversarial dos 7 algoritmos documentados

**Dispatched:** 2026-05-20 (sessão late-shift)
**Persona:** Satoshi Nakamoto (adversarial deep + game theory +
invariantes de descentralização)
**Tipo:** Dispatch / Audit
**Trigger:** "peça ao satoshi para ir verificar os 7 documentos do
algoritmos.md"
**Material auditado:** `Docs/algoritmos.md` + source files
(`scoring.ts`, `weight.ts`, `moderation.ts`, `trust/edges.ts`,
`trust/ppr.ts`, `trust/constants.ts`)

---

## Veredito por algoritmo

| # | Algoritmo | Code-doc match | Game theory | Manifesto |
|---|---|:---:|:---:|:---:|
| 1 | Score canônico | ✅ bit-exact | ⚠️ race transiente cross-relay (aceito) | §7/§22/§24 OK |
| 2 | Weight de identidade | ✅ bit-exact | 🟡 NOP event reset (LOW) | §22/§32 OK |
| 3 | Threshold dinâmico mod | ✅ bit-exact | 🟡 insider brigada (MEDIUM) | §26 incomplete; §17 OK |
| 4 | Edge influence (sigmoid) | ✅ bit-exact | ✅ sock-puppet flood mitigado (cap 20) | §24/§28 OK |
| 5 | PPR Monte Carlo | ✅ bit-exact + RNG seeded 24h window confirma cross-device | ✅ cold-start guard OK | §24/§28 OK |
| 6 | View multiplier | ✅ bit-exact (1.0 IEEE-754 exato) | ✅ strength=0 → 1.0 garantido | §24 OK |
| 7 | Temporal decay (GAP-1) | ✅ bit-exact | 🔴 Sybil edge-refresh (MEDIUM, conhecido) | §7 OK |

**Resumo:** 6/7 ✅ consistentes. 1 vetor adversarial real (#7 GAP-1) já
documentado em `known-limitations.md`. Score honestidade da doc: **9.2/10**.

---

## Game theory findings (novos vetores)

### 🟡 LOW — Event NOP reseta `last_active` (algoritmo #2)

**Vector:** Sybil publica evento vazio (kind 0 sem payload útil) a cada
58 dias → `users.last_active` updated → `inactivityDays = 0` →
engagement não decresce pela inatividade.

**Path:** `src/lib/events.ts` intake (qualquer kind assinado conta) →
`users.last_active` update → `weight.ts:calculateEngagement` lê.

**Por que não é HIGH:** Sybil novo (weight=0) contribui ~0 no score
mesmo sem decay de inatividade. Gap é cosmético (honra algorítmica)
mais que explorable.

**Fix correto:** Filtrar NOP events no intake (`last_active` só
atualiza com texto não-vazio OU spread/bury/report).

**Action:** Documentado em `known-limitations.md` §5b.

### 🟡 MEDIUM — Brigada de moderadores insider (algoritmo #3)

**Vector:** Em comunidade ~10k users (threshold 10 pts), 5 veteranos
(weight≥75, 2.0 pts cada) coordenados atingem threshold sem precisar
Sybil farming. Derrubam post legítimo.

**Path:** `src/lib/moderation.ts:getReportThreshold` não defende
contra collusion entre identidades estabelecidas.

**Por que não é HIGH:** (a) requer collusion real, não Sybil simples;
(b) reports são públicos kind 9081 — auditoria post-hoc identifica
brigada; (c) manifesto §17 garante que post **NUNCA é apagado** dos
relays — cliente alternativo exibe mesmo após score=-999.

**Fix difícil:** defesa contra collusion organizada esbarra em §22
(sem reputação subjetiva). Possibilidades futuras:
- Time-window decay nos reports
- Diversity bonus (cluster detection via Trust Lens GAP-CLUSTER)

**Action:** Documentado em `known-limitations.md` §5c.

### 🔴 MEDIUM — Sybil edge-refresh bypassa decay (algoritmo #7, JÁ CONHECIDO)

Documentado em `known-limitations.md` §1 + `BACKLOG.md` item "Lens
edges: column created_at imutável". Satoshi confirmou audit anterior
— sem novidade, mas reforça severity.

---

## Manifesto compliance

| § | Princípio | Preservado? | Evidência |
|---|---|:---:|---|
| §7 | Determinismo global | ✅ | Funções puras, `now` param explícito, RNG seeded 24h-window |
| §17 | Sem chave mestra | ✅ | Threshold dinâmico (não fundador override), score formula pública |
| §22 | Score não-subjetivo | ✅ | Weight = função pura, sem ML/reputação |
| §24 | Sem afinidade canônica | ✅ | s_local NUNCA escrito em posts.score |
| §26 | Moderação comunitária | ⚠️ | Reativo OK, mas insider-threat não documentado (agora sim, §5c) |
| §28 | Privacy mínima | ✅ | PPR local-only, graph não shared |
| §32 | Anti-Sybil sem KYC | ✅ | Weight + score ambos baseados em histórico verificável |

**Violações sutis:** Nenhuma. §26 era incomplete na documentação — fix
shipado em `known-limitations.md` §5c.

---

## Determinismo cross-device — validação especial PPR

Satoshi questionou: `createPprRng(sourceNpub, nowMs)` — `now` no seed
quebra determinismo se 2 clientes recomputam em momentos diferentes?

**Verificação:** `src/lib/trust/rng.ts` linhas 83-86. RNG seed usa
**janela 24h**: `seed = hashStringSeed("${npub}|${floor(nowMs/24h)}")`.

**Conclusão:** Mesmo source + mesmo dia → mesma seed → walks
determinísticos bit-exact entre clientes. ✅ Cross-device convergence
preservado (manifesto §7).

---

## Documentation honesty

`Docs/algoritmos.md` score: **9.2/10**. Esconde edge cases:
- Race transiente cross-relay em "última ação vale" (Score #1)
- NOP event reset (Weight #2)
- Insider brigada (Moderation #3)

`Docs/known-limitations.md` score (antes): **9.5/10**. Cobria
Sybil edge-refresh (#7). **Após este audit:** atualizado com #5b
(NOP) + #5c (insider brigada). Score agora: **9.8/10**.

---

## Veredito final Satoshi

**🟢 SHIP-AS-IS COM OBSERVAÇÕES**

| Item | Status |
|---|---|
| Code-doc consistency | ✅ EXCELENTE (7/7 fórmulas batem) |
| Game theory robustness | ⚠️ ACEITÁVEL (3 gaps LOW/MEDIUM, mitigados por design/feature-gate/doc) |
| Manifesto compliance | ✅ PRESERVADO (§7,§17,§22,§24,§28,§32 OK; §26 incomplete mas documentado) |
| Cross-device determinismo | ✅ VALIDADO (RNG 24h-window seed) |
| Doc honesty | ✅ BOM após updates (gaps listados, não ocultados) |

**Condições ship (todas satisfeitas pós-audit):**
1. ✅ Gaps NOP, insider-mod, edge-refresh documentados em
   `known-limitations.md`
2. ✅ Manifesto §X refs validados sem leakage
3. ✅ Determinismo cross-device confirmado via leitura `rng.ts`

**Reabertura condicional:**
- 🔔 Se telemetria mostrar decay adoption > 20% → reabrir GAP-1
  (schema `created_at` imutável)
- 🔔 Se Sybil ring massivo usar NOP pattern → fix em intake
  `events.ts`
- 🔔 Se caso documentado de brigada coordenada → defer pra
  GAP-CLUSTER detection (Phase 2)

**Prognóstico Satoshi:** Trust Lens + Score robustos vs Sybil simples.
Threshold mod é ponto fraco vs insider organizado — aceitável pra MVP
(weakness natural de moderação comunitária; vide Nostr relays em
geral).

---

*Registrado por Satoshi persona dispatch 2026-05-20. Updates em
`known-limitations.md` §5b + §5c shipados neste commit.*
