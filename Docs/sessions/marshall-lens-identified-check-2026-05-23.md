# Marshall — Lens "só identificados" check de conformance

**Data:** 2026-05-23
**Persona:** Marshall Eriksen (schema/types/conformance/regras formais)
**Pergunta do user:** *"Em lens, vamos criar um filtro pra mostrar apenas
quem decidiu se identificar — isso viola alguma regra nossa ou o manifesto?"*
**Refs:** Manifesto v2.2 §17 / §22 / §24 / §28 + `lens-pluggable-design.md`
+ `trust-lens-conformance.test.ts` (LOCK_VIA_TEST #2 / #9 já vigentes)

---

## 1. TL;DR

**Veredito: GO-COM-CONDIÇÕES.**

Filtro "só identificados" é *legal* sob manifesto **se e somente se**:

1. Signal é **self-declared** (`kind 0` com `name` não-vazio) OU
   **relacional** (follows recíprocos NIP-02). NUNCA `NIP-05 + whitelist
   de domínios curada` (= chave mestra disfarçada §17 — veto duro).
2. É lens **opt-in OFF-by-default**, plugada no Strategy Registry
   (`lens-pluggable-design.md` §1) como **mais uma** lens — não substitui
   nem altera default global.
3. Copy de warning explícita o trade-off — esconde pseudonyms legítimos
   (whistleblowers, contas multi-id por anti-perseguição §4).
4. Resultado vive *exclusivamente* no view boundary (`s_local`
   nunca persisted/shared — LOCK_VIA_TEST #2 estendido a esta lens).

Tecnicamente é "filtro de visualização" (mesma família que mute/block
de §24), não algoritmo de ranking. Análoga ao `ImageFirstLens` já
planejado no design doc — só que o predicado é "tem identidade
declarada" em vez de "tem imagem".

---

## 2. Tabela "qual signal usar"

À luz do princípio §17 + §22 + game theory Sybil, avaliação dos signals
candidatos:

| Signal | §17 (chave mestra) | §22 (reputação) | Sybil cost | Veredito |
|---|---|---|---|---|
| `kind 0` com `name` não-vazio | ✅ self-declared, zero authority externa | 🟡 atributo público, não score subjetivo | ~zero ($0, gera 1k em segundos) | **GO** — feature theatre fraco mas legal |
| `kind 0` com `name` + `picture` + `about` | ✅ idem | 🟡 idem | ~baixo (LLM gera bios; 1h script) | **GO** — marginalmente melhor |
| **NIP-05 verificado** (qualquer domain) | 🟡 DNS é authority centralizada externa | 🟡 atributo binário | ~$10/mês domínio + script | **GO-COM-CONDIÇÕES** — aceitável se UI nomeia o domínio |
| **NIP-05 + whitelist domínios** (`@drift.app`, `@iris.to`...) | ⛔ **alguém decide whitelist** | ⛔ tier explícito | alto | **VETO §17** — chave mestra disfarçada |
| Follows recíprocos NIP-02 com viewer | ✅ viewer é authority do próprio ranking | ✅ relacional, não global | dependente do viewer | **GO** — semanticamente o mais robusto |
| `posted ≥ N times` | ✅ contagem pública | 🟡 barrier-to-entry, não identidade | tempo+volume | **GO** — mas não é "identidade", é "atividade" |

**Recomendação Marshall:** lens com **2 modos selecionáveis** pelo user:

- **Modo "declarou perfil"** — predicate: `author tem kind 0 com tag
  ['name', X] onde X.trim() !== ''`. Cheapest, alinha com NIP-01
  padrão, zero authority externa. Bom para a maioria.
- **Modo "conhecemos mutuamente"** — predicate: `author ∈ recíprocos
  via NIP-02`. Semanticamente "se identificaram PRA VOCÊ", não global.

NIP-05 fica **fora do MVP**. Razão: introduz dependência DNS/HTTPS
externa pra avaliar uma lens local — viola espírito §11 (rede como
meio, não fonte de verdade) e introduz latência/falha (resolver DNS
síncrono no render boundary).

---

## 3. Mapeamento por princípio

### §17 Resistência ao Fundador (Sem chave mestra)

- **Self-declared `kind 0.name`**: 🟢 **VERDE**. Author declara
  publicamente; cliente não decide quem é "verdadeiro". Idêntico em
  espírito a §27 (auto-classificação voluntária via `content-warning`).
- **NIP-05 + whitelist editorial**: 🔴 **VERMELHO**. Alguém mantém
  whitelist → é a chave mestra disfarçada que §17 v2.2 baniu
  explicitamente. Quem decide quais domínios entram herda autoridade
  do fundador. **Veto duro.**
- **NIP-05 livre (qualquer domínio)**: 🟡 **AMARELO**. DNS é
  autoridade externa centralizada (ICANN + registrars). Não viola
  §17 stricto-sensu porque cliente Drift não opera a whitelist, mas
  delega trust pra infraestrutura DNS. Aceitável só se UI mostra
  domínio inteiro pro user julgar (evita "✓ verified" opaco).

### §22 Score Determinístico, Não Reputação Subjetiva

- Filtro não atribui **score** nem **peso** a identificados. Apenas
  **filtra** (booleano in/out) na visualização. 🟢 **VERDE**.
- Risco semântico: copy não pode sugerir "identificados são mais
  confiáveis". Copy deve ser *factual* ("autor declarou perfil"),
  **não normativa** ("autor verificado / confiável").
- Adendo §22 v2.2 sobre Trust Lens local: lens "identified" entra
  na mesma família — view-layer, `s_local` nunca persisted nem
  shared. LOCK_VIA_TEST #2 estende.

### §24 Sem Algoritmo Personalizado de Feed (canônico)

- Filtro reordena/filtra **localmente no render boundary**, idêntico
  a mute/block já permitidos. 🟢 **VERDE**.
- **Crítico:** lens NÃO altera `posts.score` no SQLite, NÃO publica
  kind event "uso filtro X", NÃO escapa do device. Mesmo invariante
  do PprTrustLens — conformance test #2 reciclável.
- Hierarquia: filtro de visualização ≠ ranking canônico. §24 protege
  o ranking canônico (compartilhado entre clientes Drift via fórmula
  pura). Lens é layer acima e local.

### §28 Privacidade Pelo Mínimo

- Default OFF (igual `lens_strength = 0` hoje). 🟢 **VERDE**.
- Nenhuma info nova vaza pra rede — escolha do user fica em
  `user_prefs` local. 🟢 **VERDE**.
- Não cria signal observável externamente (não publica "estou
  filtrando anônimos"). 🟢 **VERDE**.

### §4 Anonimato por Design (adjacente, importante)

- 🟡 **AMARELO** semântico. §4 protege o direito do user de ser
  anônimo. Lens "só identificados" não viola §4 (é o **viewer** que
  filtra, não a rede que exclui), mas existe pressão social
  emergente: se virar default cultural, autores anônimos perdem
  alcance.
- Mitigação: copy de warning + default OFF + posicionamento como
  "uma lens entre outras" no registry, não promoção destacada.

---

## 4. Game theory — qual Sybil farm o filtro barra

| Atacante | Custo pra burlar | Filtro barra? |
|---|---|---|
| Bot Sybil farm trivial (script gera 1k npubs sem kind 0) | $0 | ✅ Sim — não publicaram kind 0 com `name` |
| Sybil farm com 1 linha extra (publica kind 0 `{"name":"João N"}` por npub) | ~$0 + 5min | ❌ **Não** — predicate satisfeito trivialmente |
| Sybil farm "premium" (LLM gera bio + picture realista) | ~$10/mês LLM API | ❌ Não |
| Sybil farm com NIP-05 em domínio próprio | ~$10/mês domínio | ❌ Não (passa lens NIP-05) |
| Adversário com whitelist comprada (se Drift fizer whitelist editorial) | depende do operator | varia — **vetor de captura, daí o veto** |

**Conclusão honesta:** o filtro barra Sybils preguiçosos. Sybils
determinados (que é o threat realista pós-launch) passam trivialmente.

**Honestidade radical (MEMORY user):** essa lens **não é defesa
anti-Sybil**. É **affordance de curadoria pro user** que prefere ler
de quem se apresentou. Vender como "filtra bots" é fraude — daí a
importância da copy.

---

## 5. Recomendação final

### Implementação proposta

- **Lens ID:** `identified-only` (não "verified" — palavra carregada).
- **Registrar:** `src/lib/lens/strategies/identified-only.ts`
  implementando `LensStrategy` do design doc.
- **Default state:** OFF (não-default; user ativa via Settings).
- **Modos via `LensConfig.params`:**
  - `mode: 'profile-declared'` — predicate: `kind 0 com name não-vazio`
  - `mode: 'mutual-follow'` — predicate: `author ∈ recíprocos NIP-02`
  - `mode: 'either'` — OR dos dois
- **Versão schema:** 1.
- **Composability (Sprint N+4):** combina com `ppr-trust ∩
  identified-only(mutual-follow)` = "meu PPR só com quem eu sigo de
  volta". Útil.

### Copy de warning (obrigatória na UI)

> **Filtro: só autores identificados**
>
> Mostra apenas posts de autores que publicaram perfil (nome) ou que
> você segue mutuamente.
>
> **Cuidado:** esse filtro pode esconder vozes legítimas que escolhem
> pseudonimato — denunciantes, ativistas, contas alternativas de
> identidades existentes. Drift respeita identidade anônima
> (Manifesto §4) e este filtro é só preferência de visualização sua.
>
> Não filtra bots determinados — qualquer Sybil pode publicar um
> nome. Use junto com outras lens (PPR Trust, follows mútuos) pra
> sinal real.

### Posicionamento no Lens Registry

Ordenação sugerida no dropdown (`registry.list()`):

1. `chronological` (mais neutro — recomendado §24)
2. `ppr-trust` (atual default — Trust Lens histórica)
3. `image-first` (já planejado)
4. **`identified-only`** ← nova
5. Custom (imported via JSON/URL)

Não destacar visualmente "identified-only" — é mais uma opção, não
recomendação.

---

## 6. Veto items (não-negociáveis)

🛑 **VETO** se qualquer das condições abaixo aparecer na PR de impl:

1. Whitelist de domínios NIP-05 curada pelo cliente oficial (qualquer
   tamanho — mesmo 1 entry = chave mestra disfarçada).
2. Badge "verified" / "✓" / "official" / "trusted" na UI ao lado de
   identificados. Copy factual ("perfil declarado") apenas.
3. Boost de score canônico pra identificados (escreveria em
   `posts.score`, viola §24 + LOCK_VIA_TEST #2).
4. Publicação de evento Nostr sinalizando "este user filtra
   anônimos" (viola §28 — info nova vazada).
5. Default-on em primeiro launch (viola §28 default-off + cria
   pressão cultural anti-§4).
6. Wording que iguala "anônimo" a "spam" / "fake" / "untrustworthy"
   na UI ou onboarding.

---

## 7. Próximos passos (se GO confirmado)

1. **Sprint N+3 (atual)** ou **N+4** — ship após `Lens Pluggable POC`
   estar com `LensRegistry` concreto.
2. Dispatch Lily pra implementação (`identified-only.ts` strategy +
   3 conformance tests: purity, determinism, isolation).
3. Dispatch Robin pra revisão de copy (warning copy é load-bearing).
4. Dispatch Barney pra threat-model review antes do merge —
   especialmente Sybil farm cost-of-attack e UX pressure on §4.
5. Estender `tests/trust-lens-conformance.test.ts` ou criar
   `tests/lens-identified-only.test.ts` com:
   - `s_local nunca persisted` (#2 reciclado)
   - `s_local nunca shared via Nostr event` (#9 reciclado)
   - `predicate puro e determinístico` (mesma kind 0 fixture → mesmo
     resultado)
   - `default OFF` (registry boot sem `identified-only` ativa)

---

**Sumário Marshall (legal-style):** À luz dos princípios §17, §22,
§24 e §28, *e considerando a doutrina view-layer-LOCAL já consolidada
pelo Trust Lens (adendo CLAUDE.md 2026-05-17)*, o filtro "só
identificados" **não viola** o manifesto desde que (a) o signal seja
self-declared ou relacional, **nunca** editorial; (b) opere
exclusivamente no view boundary; (c) seja opt-in com copy explicitando
o trade-off contra §4. A proposta entra como **mais uma** strategy no
registry pluggable já desenhado — não requer novo carve-out
arquitetural. **GO-COM-CONDIÇÕES.**

*— Marshall, 2026-05-23*
