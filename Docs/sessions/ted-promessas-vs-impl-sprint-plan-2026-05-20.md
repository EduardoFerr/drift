# Ted — Audit "promessa vs impl" + Lentes pluggable + Sprint plan zero-débito

**Dispatched:** 2026-05-20 (sessão late-shift, pós-Satoshi devsec fixes)
**Persona:** Ted (arquitetura, padrões, planejamento)
**Tipo:** Dispatch / Planning
**Trigger:** "Peça para Ted analisar o que é só promessa não
implementada ainda... as lentes ainda não são plugáveis e nem
compartilháveis... planeje a próxima sprint, não vamos deixar
débitos técnicos."

---

## PARTE 1 — Audit "Promessa vs Implementação"

| Gap | Severity | Promessa | Status real | Próximo passo |
|---|:---:|---|---|---|
| **§15 Anti-censura por país** | 🔴 CORE | Manifesto §15 + Fase 6: Tor + WebRTC + IPFS pra resistência Estado-nação | PWA (70% users) **sem Tor** físico. Tauri shipped em code mas distribuição binária manual em GitHub Releases. F-Droid manifest ⏳. User final não-técnico não descobre. | Doc pública "instalar em país censurado" (Fase 5 prepara, Fase 6 implementa) |
| **§16 Disponibilidade distribuída** | 🔴 CORE | "Posts com score alto são fixados em IPFS pelo cliente oficial" — replicação social orgânica | Eviction respeita spreads ✅, re-broadcast ✅, WebRTC seeding ✅, Helia init ✅. **Mas nenhum trigger automático** "score > X → pin". Hook em `recalculateScore` pendente. | Hook em `events.ts:recalculateScore` → `maybePin(postId, score)` quando `score > VIRAL_THRESHOLD` |
| **Lentes pluggable + shareable** | 🟡 SECONDARY | §24 view-layer LOCAL permite customização. Multi-list (Lily session) sugere lentes como "receita compartilhável" | **1 lente hard-coded** (PPR Monte Carlo). Sem interface pra plugar alternativa nem exportar/importar config. Single source = single verdade visible. | PARTE 2 abaixo |
| **§25 Sem scan automático** | 🟡 SECONDARY | "Cliente oficial não embute scan automático" — decisão permanente v2.2 | `lib/csam.ts` não existe ✅. Upload sem inspeção ✅. **MAS** nenhuma conformance test ativa. Futuro dev mal-informado pode adicionar. | LOCK_VIA_TEST `tests/no-scan-automatico.test.ts` valida ausência de imports |
| **§13 Sneakernet/QR export** | 🟡 SECONDARY | "Eventos exportáveis como blob assinado e reimportáveis" — sneakernet em país censurado | Eventos Nostr puros ✅, transport interface ✅. **Mas `lib/bundle-export.ts` não existe** ainda. QR+JSON bundle ⏳ Fase 7 | Fase 7 task. Lower priority. |
| **§20 Random walk pós-CONNECTED** | 🟡 MEDIUM | Defesa em camadas anti-eclipse: random walk contínuo runtime | Probe ✅, peerScore ✅, path diversity ✅. **Walk ativo periódico não shipped** — só descoberta passiva via seeder. TODO 6.2-D no roadmap. | Spec técnica + spike (não impl) nesta sprint |
| **§29 DMs NIP-44 UI** | 🟢 NICE-TO-HAVE | "DMs opcionais, NIP-44, feature aditiva futuro" | `lib/nostr-dm.ts` + `tests/nip44-facade.test.ts` ✅ (usado em WebRTC signaling). **UI pra user final não shipped**. Manifesto coloca como "roadmap, sem data" | Defer — fase 8+ |

**Resumo:** 2 gaps 🔴 core (§15 distribuição, §16 pin automático), 4 gaps 🟡 secondary,
1 gap 🟢 nice-to-have. **Zero ⛔ não-entregue.**

---

## PARTE 2 — Lentes pluggable + shareable: arquitetura

### Status atual

`src/lib/trust-lens.ts` + `trust/ppr.ts` são **monolítico hard-coded**:
- 1 algoritmo (PPR Monte Carlo)
- 1 fórmula (`viewMultiplier(s_global, ppr_normalized, strength, mutual)`)
- 1 toggle de strength

Sem interface pra:
- (A) plugar lente alternativa (cronológica pura, image-first, etc.)
- (B) export/import config (apenas a *receita*, não o resultado computado)

### Arquitetura proposta

**1. Strategy Registry**

```typescript
// src/lib/lens/types.ts
export interface LensStrategy {
  id: string                                          // 'ppr-trust' | 'chronological' | 'image-first'
  name: string                                        // UI-friendly
  version: number                                     // semver pra evolução
  reorder(posts: Post[], ctx: LensContext): Post[]    // pura, determinística
  config?: LensConfig                                 // parâmetros tuneáveis
}

// src/lib/lens/registry.ts
export class LensRegistry {
  register(strategy: LensStrategy): void
  getActive(): LensStrategy | null
  setActive(id: string): void
  list(): LensStrategy[]
}
export const lensRegistry = new LensRegistry()

// Built-in lentes ao boot
lensRegistry.register(new PprTrustLens())     // atual (default)
lensRegistry.register(new ChronologicalLens()) // feed puro (sem boost)
lensRegistry.register(new ImageFirstLens())   // posts c/ imagem boostam
```

**2. Shareable config — receita, não compute**

```typescript
export interface LensConfig {
  readonly type: string                              // plugin ID
  readonly version: number
  readonly params: Record<string, number | string>   // strength, decay, etc.
  readonly hash?: string                             // sha256(canonical JSON)
}
```

Sharing mediums:
- JSON dump (settings export)
- URL fragment: `drift://lens?type=ppr-trust&strength=0.75&decay=1`
- NIP-XX event candidato (kind 9095 LensConfig) — user publica, outros subscribe + recomputam

Manifesto §24 preserved: cada user recomputa LOCAL com a *receita*. Compute nunca shared.

**3. Threat model — Lente maliciosa**

Risco: plugin malicioso escreve em `posts.score` (shared state corrupted).

Defesa 3-camadas:
1. **API isolation:** `reorder()` é pure function, recebe cópias deep (read-only). Não retorna pra write na DB.
2. **Conformance test:** `tests/lens-plugin-isolation.test.ts` — registra `MaliciousLens`, chama `reorder()`, assert SQLite inalterado.
3. **Manifest validation:** `LensStrategy` ao registrar tem `Object.freeze()` + check `__proto__ === null` (impede prototype pollution).

### Roadmap — 3 milestones

| Milestone | Duração | Output |
|---|---|---|
| **SPIKE** | 2-3 dias | Doc design (`Docs/lens-pluggable-design.md`) + interface esboço + threat model + 3 lens alt-skeleton |
| **POC** | 4-5 dias | `LensRegistry` + `PprTrustLens` refatorada (bit-exact) + 1 lens alt (Chronological) + UI dropdown + 8-10 conformance tests |
| **SHIP** | 2-3 dias | `exportLensConfig()` / `importLensConfig()` + URL fragment + QR (opt) + doc user-facing |

---

## PARTE 3 — Sprint plan zero-débito

### Sprint N+1 — Target 5-10 dias

**P0 — Must-ship (fecha promessas quebradas):**

| # | Item | Estimativa | Aceite | LOCK_VIA_TEST |
|:---:|---|:---:|---|---|
| 1 | **§16 IPFS pin automático** | 2d | `recalculateScore` dispara `maybePin()` quando score > 30; Helia adiciona CID; conformance test trava | `tests/viral-ipfs-pin.test.ts` |
| 2 | **§15 Doc "instalar em país censurado"** | 1.5d | `Docs/install-censored-country.md` com tabela canais (PWA/Tor/F-Droid/WebRTC) | — (doc) |
| 3 | **Lentes pluggable SPIKE** | 2d | `Docs/lens-pluggable-design.md` + `src/lib/lens/registry.ts` interface + `PprTrustLens` refatorada bit-exact + 3 conformance tests (purity, isolation, determinism) | `tests/lens-plugin-conformance.test.ts` |
| 4 | **§25 Conformance "zero scan automático"** | 0.5d | Test valida ausência de imports PhotoDNA/Cloudflare/ML | `tests/no-scan-automatico.test.ts` |
| 5 | **§20 Random walk spec** | 0.5d | `Docs/fase-6-roadmap.md` atualizado com definição "random walk contínuo pós-CONNECTED" | — (planning) |

**Total P0:** ~6.5d

**P1 — Deveria caber (reforça abstração):**

| # | Item | Estimativa |
|:---:|---|:---:|
| 6 | CI grep automation "PhotoDNA NUNCA imported" | 0.5d |
| 7 | `Docs/architecture-phases.md` — mapeia Fase 6/7 promessas → épicos | 1d |

**Total P1:** ~1.5d

**P2 — Se tiver folga:**

| # | Item | Estimativa |
|:---:|---|:---:|
| 8 | Predicate.ts safe-eval guard (anti-XSS futuro) | 1d |

**Spikes (não-shippable, mas precisam começar):**

- **SPIKE-1** Lentes pluggable design (já em P0 #3)
- **SPIKE-2** Random walk pós-CONNECTED (já em P0 #5)
- **SPIKE-3** (opcional) i18n Phase 1A kickoff se user GO

### Pós-sprint: Matriz coverage esperada

| § | Status atual | Status esperado | Evidência |
|---|:---:|:---:|---|
| §15 | 🟡 | 🟡→✅(parcial) | install-censored-country.md publicado |
| §16 | 🟡 | 🟡→✅(maioria) | IPFS pin automático shipped + test |
| §20 | 🟡 | 🟡(spec) | Random walk spec written |
| §24 lentes pluggable | ⏳ | 🟡(spike) | LensRegistry + PprTrustLens refatorada |
| §25 | ✅ | ✅(locked) | Conformance test #10 trava ausência |

**Total esperado:** 1 🟡→✅ migração (§16), 1 🟡→✅parcial (§15), 1 ⏳→🟡 (lentes pluggable). Sem novos débitos.

---

## Critérios de "zero novo débito"

1. Cada P0/P1 fecha promessa OU constrói abstração que previne nova promessa quebrada
2. Cada item shipado tem aceite explícito + LOCK_VIA_TEST onde aplicável
3. Spikes NÃO shipam — produzem doc + skeleton; conclusão real fica pra próxima sprint
4. Toda nova feature passa pelos 3 testes: pure, isolation, determinism

---

*Registrado por Ted persona dispatch 2026-05-20. Sprint começa quando
user der GO. Itens P0+P1 ~8d full-focus; P2 + SPIKE-3 + buffer = 10d.*
