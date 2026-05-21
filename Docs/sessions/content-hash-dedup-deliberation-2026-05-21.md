# Content-hash dedup — deliberação Satoshi + Ted → NO-GO (atual)

**Dispatched:** 2026-05-21 (sessão zero-débito autônoma)
**Personas:** Satoshi (adversarial deep) + Ted (arquitetura) em paralelo
**Tipo:** Deliberação / Research
**Trigger:** "uma forma de evitar spam, é a mensagem ser um 'hash
content'? mesmo conceito da imagem unica, mas para post unico"
**Decisão final:** **NO-GO atual** (option A escolhida pelo user)

---

## A proposta

SHA-256 do `content` do POST (kind 9078) como identificador de
unicidade. Mesmo content = mesmo hash = penalize no score (NÃO delete,
manifesto §17). Inspiração: NIP-94 já faz isso pra imagens.

---

## Satoshi — NO-GO (defesa teatro)

### Threat model: 5 ataques triviais

1. **1 espaço extra** → hash totalmente diferente. Atacante muda 1
   char, evasão instantânea, custo zero.
2. **Homoglyph** ("оi" cirílico vs "oi" latin) → visualmente idênticos,
   hashes diferentes. Normalização lossy quebra português.
3. **Subposts shuffle** → reordenar ou adicionar subpost vazio muda
   hash.
4. **Image-as-text bypass** → meme com texto em pixels não hasha texto.
5. **Burst coordenado com colisão acidental:** "Grêmio 3x2 Corinthians"
   por 32 pessoas em breaking news → 31 penalizadas. Falsos positivos
   inevitáveis.

### Game theory

- **Cost atacante:** novo Sybil = free; mudar 1 char = 0s. Defesa não
  eleva tax.
- **Redundante com weight=0:** Sybils novos já têm `spreadWeight = 0`
  → spread vale 0 → posts invisíveis no feed canônico. Defesa atual
  já paga o custo.
- **Comparar com barreiras reais existentes:**
  - `weight=0` pra Sybil novo → invisibilidade automática
  - max 1 subpost pra `weight<20` → tax em volume real
  - Threshold dinâmico de moderação → tax em coordenação

### Riscos manifesto

- **§17 sem chave mestra:** se UI agrupar clones ("32 pessoas postaram
  isso, clique pra expandir"), esconde post legítimo de quem postou
  depois — **quase-censura**.
- **§13/§14 compat Nostr:** se virar tag obrigatória, inventa protocolo
  paralelo.
- **Slope perigosa:** hash → fingerprinting → similarity matching →
  filtro centralizado. Cada passo parece "more accurate", mas é
  caminho contrário ao manifesto.

### Mitigation se forçado a implementar

- **Client-side view-only.** NUNCA protocolo obrigatório.
- **Whitespace collapse + NFC Unicode apenas.** Nada mais agressivo.
- **NEVER hide own user's content.** Mesmo se duplicado, user vê o
  próprio post normalmente.
- **Threshold alto:** aplicar só se >5 clones em 1h (barra coordenação,
  não acidente).
- **Publicizar a regra.** Manifesto §25 transparência — user lê
  "content-hash duplicate detected" e entende.

**Veredito Satoshi:** *defesa teatro*. Parece anti-spam mecânico,
realmente premia evasão trivial e penaliza usuário acidental. **Melhor
não fazer.**

---

## Ted — GO com Opção B (arquitetura se decidir implementar)

### Estado atual do NIP-94 no Drift

Já existe em `src/lib/nip94.ts`:
- `BlobMeta` type com `hash` field (SHA-256 hex)
- `buildImetaTag` / `parseImetaTag` (order fixa, determinístico)
- `sha256Hex` helper
- `blobs.ts:fetchBlob` faz verify hash obrigatório

Pattern já consolidado pra imagens — extender pra texto seria
proporcional.

### 3 opções avaliadas

| Opção | Onde | Compat Nostr | Verdict |
|---|---|---|---|
| **A** Tag NIP padrão `["content-hash", "sha256:..."]` | Protocol | Quebra (inventa NIP) | ❌ viola §13/§14 |
| **B** View-layer puro (`posts.content_hash` SQLite local) | View-layer | 100% preservada | ✅ recomendada |
| **C** Híbrido (tag opcional + view recompute) | Ambos | Parcial | ⚠️ complexidade extra |

### Opção B — design proposto (se reabrir)

**Schema:**
```sql
ALTER TABLE posts ADD COLUMN content_hash TEXT;
CREATE INDEX idx_posts_content_hash ON posts(content_hash);
```

**Função pura:**
```typescript
export function hashPostContent(subposts: Subpost[]): Promise<string>
```

**Normalização canonical (order importa):**
1. Para cada subpost, normaliza texto: NFC + trim + whitespace collapse
   (**não lowercase** — preserva "FBI" ≠ "fbi" semântica)
2. Sort subposts por `order`
3. JSON.stringify com keys em ordem fixa
   (`['type','text','imageUrl','layout','order']`)
4. SHA-256 hex lowercase

**Decisões:**
- `imageUrl` entra no hash? **SIM** (mesmo texto + imagem diferente =
  hash diferente; preserva intent autoral)
- Imagem hash em si entra? **NÃO MVP** (defer; URL string já
  diferencia)
- `layout` entra? **SIM** (portrait vs landscape é apresentação
  diferente)

**Wire em scoring:**
```typescript
calculateScore(input, duplicates = 0):
  if (duplicates > 0) netEngagement *= 0.5  // ou via prefs
```

**Opt-in:**
- `UserPrefs.dedup_enabled: boolean` (default `false`)
- `UserPrefs.dedup_penalty_factor: number` (default 0.5)

**LOCK_VIA_TEST candidates:**
- Hash determinístico (mesmo input → mesmo output)
- Normalization correta (whitespace + NFC)
- Dedup detection (insert 2× mesmo content → `duplicates=1`)

**Manifesto compliance:**
- §7 determinismo OK (função pura + recompute local)
- §17 OK se NUNCA hide próprio post do user (Satoshi mitigation)
- §22 OK (hash = função pura)
- §24 OK (view-layer carve-out — `posts.score` canônico intacto)
- §13/§14 OK (zero impacto outros clients Nostr)

---

## Decisão final — Opção A (NO-GO atual)

**Justificativa user:**

1. **Não fecha gap real** — Satoshi mostrou evasão custo zero
2. **Defesa de tax já existe** — `weight=0` + max subposts + threshold
3. **Falsos positivos têm custo UX real** — cenário breaking news
4. **Implementar = sinal "spam resolvido"** → risco de desativar
   defesas reais por achar que o problema sumiu

**Documentado em:**
- `BACKLOG.md` — item pesquisado/NO-GO com plano Ted Opção B se reabrir
- `Docs/known-limitations.md` §6 — gap aberto documentado
- Este doc — full deliberação pra reference futura

**Condições de reabertura:**

- Evidência concreta de spam **que não foi resolvido** por `weight=0`
  (ex: comunidade pequena com bots usando identidades veteranas
  farmadas postando flood coordenado de promoções)
- OR ataque de "copy-paste viral malicioso" reportado e mensurável
- OR designs futuros de moderação comunitária precisarem do hash como
  primitivo (ex: report agrupado por content-hash em vez de post-id)

Se reabrir → seguir Opção B (Ted) com mitigations Satoshi (never hide
own, threshold alto, view-only, transparência).

---

*Registrado por Satoshi + Ted dual dispatch 2026-05-21. Decisão user
confirmada: option A (NO-GO atual + documentação completa). Refazer
deliberação requer evidência nova, não suspicion geral.*
