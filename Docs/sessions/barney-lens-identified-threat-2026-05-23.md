# Barney — Lens "só identificados" threat-model review

**Data:** 2026-05-23
**Persona:** Barney Stinson (peer review crítico / threat modeling / ceticismo)
**Pedido:** Marshall (`marshall-lens-identified-check-2026-05-23.md`) deu
GO-COM-CONDIÇÕES e solicitou revisão Barney antes do merge focando em
(a) UX pressure cultural sobre §4 e (b) cost-of-attack Sybil pós-launch.
**Refs:** Manifesto v2.2 §4 / §17 / §22 / §24 / §28 +
`lens-pluggable-design.md` + `trust-lens-conformance.test.ts` + adendo
CLAUDE.md 2026-05-17 (Trust Lens view-boundary).

---

## 1. TL;DR

**Veredito: GO-COM-CONDIÇÕES-EXTRA (3 condições além do Marshall).**

A proposta do Marshall é sólida no plano legal/conformance. O que ela
**não cobre** é o **terreno cultural pós-launch** — onde features
"inofensivas" viram default de facto via creep cosmético, copy bem-
intencionado e network effect. Barney não veta a feature; veta a **rota
ingênua** de "ship e confia que default-OFF sobrevive 6 meses".

Três condições extras (detalhe na §6 veto items):

1. **LOCK_VIA_TEST de copy** — vocabulário proibido (`verified`,
   `trusted`, `official`, `genuine`, `real user`, `✓`) hardcoded em
   conformance test contra strings JSX + manifest of lens strategies.
   Sem isso, copy creep em 3 sprints destrói §4.
2. **LOCK_VIA_TEST de posicionamento** — `identified-only` nunca pode
   ser `default: true` no `LensRegistry`, nunca pode ter campo
   `recommended: true`, nunca pode aparecer em onboarding wizard.
   Test enforça via grep em `src/components/Onboarding/**` +
   schema de registry.
3. **Telemetria-zero adicional** — proibir log/metric local que conte
   "% de users com identified-only ativo" (mesmo agregado, mesmo
   local-only). Razão: métrica vira KPI, KPI vira pressão pra subir,
   pressão vira nudge. Mata o vetor na raiz.

Em outras palavras: **a feature é fine, o ambiente em volta dela é
hostil**. Marshall blindou o código; falta blindar o produto.

> "Suit up, but lock the door first." — Barney

---

## 2. Matriz de cenários adversariais §4 (UX pressure cultural)

Escala: probabilidade (1=raro, 5=esperado) × severidade (1=cosmético,
5=erosão §4 permanente). Risco ≥12 = mitigation obrigatória pre-ship.

| # | Cenário | Prob | Sev | Risco | Mitigation obrigatória? |
|---|---|---|---|---|---|
| C1 | **Feature creep para default-on** via "user feedback" em 6 meses (PR interno argumenta "melhora retenção / reduz spam reportado") | 4 | 5 | **20** | **SIM** — LOCK_VIA_TEST §6.C2 (veto schema + grep) |
| C2 | **Visual emphasis creep**: designer adiciona badge `✓` ou pin diferente pra autores `kind 0.name !== ''` em PR cosmético separado, sem tocar a lens | 5 | 4 | **20** | **SIM** — LOCK_VIA_TEST de vocabulário proibido em strings JSX (§6.C1) |
| C3 | **Social pressure emergente** ("todo mundo deveria ativar") — power users em comments/threads pressionam casuais a ligar a lens; anônimos viram outgroup | 4 | 4 | **16** | **SIM** — copy explícita §4 + warning não-dismissable na primeira ativação |
| C4 | **Network effect negativo**: se 25-30% dos viewers ativam, anônimos veem queda de ~25-30% engagement → incentivo material pra "só publicar com nome" → whistleblower silenciado | 3 | 5 | **15** | **SIM** — telemetria-zero (§6.C3) + arquitetura impede saber a % real (sem métrica = sem KPI = sem nudge) |
| C5 | **"Padrão recomendado" via copy**: dropdown ordena `identified-only` com label "Recomendado pra começar" em PR de UX polish | 4 | 4 | **16** | **SIM** — schema LensConfig sem campo `recommended` + LOCK_VIA_TEST que falha se label `recomendad`/`recommended`/`sugerido` aparecer perto de lens id |
| C6 | **Onboarding push**: wizard novo-user (Fase 6+) sugere "ative pra evitar spam" — maioria silenciosa aceita sem entender | 4 | 5 | **20** | **SIM** — LOCK_VIA_TEST grep em `src/components/Onboarding/**` veta menção a `identified-only` (§6.C2 estendido) |
| C7 | **Aggregator/3rd-party client cita Drift**: "rede social com filtro anti-anônimo built-in" — Drift vira *case* de produto anti-§4 mesmo sendo opt-in | 3 | 3 | 9 | Não bloqueante; mitigar via README + blog post enquadrando lens como curadoria, não filtro |
| C8 | **Self-fulfilling**: copy "esconde pseudonyms legítimos" assusta user → ele ativa "pra ver se some muita coisa" → cria hábito de toggle → normaliza | 2 | 3 | 6 | Não bloqueante; copy do Marshall já é factual o bastante |
| C9 | **Combinação com PPR**: composability `ppr-trust ∩ identified-only` (Marshall sugeriu como "útil") vira recomendação tribal — duplica pressão | 3 | 4 | **12** | **SIM (marginal)** — não banir combo, mas warning extra na UI quando 2+ filtros restritivos ativos simultaneamente |
| C10 | **Adversário interno**: stakeholder/contributor argumenta "default-on em modo onboarding ajuda novos a se sentir seguros" em PR controverso 12 meses depois | 3 | 5 | **15** | **SIM** — LOCK_VIA_TEST §6.C2 é defesa estrutural; força o atacante a *quebrar testes* (visível em CI), não passar despercebido em review |

**Total cenários com risco ≥12: 7 de 10.** Sete vetores onde a feature
erode §4 sem ninguém escrever uma linha "anti-anonimato" — é exatamente
o tipo de superfície que Barney vê e os outros não.

### Padrão geral

Todos os cenários ≥12 compartilham raiz comum: **decisões cosméticas /
copy / posicionamento atravessam o boundary do código da lens**.
Marshall blindou o predicate e o view-boundary. Não blindou **a
moldura cultural em volta**. Daí as 3 condições extras: cada uma
fecha um vetor que não passa por `identified-only.ts` em si.

---

## 3. Cost-of-attack Sybil (aprofundamento)

### Tabela de custo por escala

| Scale | Custo bruto | Tempo | Detectabilidade cluster | Filtro `kind 0.name` barra? | Filtro `mutual-follow` barra? |
|---|---|---|---|---|---|
| 1 npub + kind 0 trivial | $0 | 30s | N/A (n=1) | ❌ Passa | ✅ Barra (sem follow recíproco) |
| 10 npubs + kind 0 trivial | $0 | 5min | Baixa (timestamps próximos detectáveis se relays guardam, mas Drift não) | ❌ Passa | ✅ Barra |
| 100 npubs + nomes únicos via faker.js | $0 | 30min script | Média — timestamps cluster + faker patterns (Faker default names têm distribuição estatística diferente de nomes reais BR) | ❌ Passa | ✅ Barra |
| 1.000 npubs + LLM names + picture stock | ~$2 LLM API + tempo | 2-4h | Média-alta IF alguém procura; **ninguém procura no client Drift (§7 sem scan)** | ❌ Passa | ✅ Barra |
| 10.000 npubs + LLM bio + picture gerada + 1 follow recíproco entre Sybils | ~$20 LLM + 10h | 1-2 dias | Alta em teoria (LPA cluster detection), mas LPA é Fase 6 P2P discovery, não roda contra clientes WSS | ❌ Passa profile-declared; ✅ ainda barra mutual-follow com user real | ✅ Barra (Sybil não tem follow do viewer) |
| 100.000 npubs + LLM full + comprou 1k follows reais via mercado nostr (existe? hipotético) | $200-2000 | 1 semana | Detectabilidade cai drasticamente | ❌ Passa | 🟡 Passa marginalmente se conseguir 1 follow real do viewer |
| Adversário Estado-nação (dedicated team, $$$) | $10k+ | semanas | Nenhuma defesa client-side resolve | ❌ Passa | 🟡 Passa se conseguir engenharia social do viewer |

### Análise honesta

**Lower bound de defesa real:** $0. Atacante motivado passa a lens
profile-declared **trivialmente** com `for i in {1..1000}; do nostr-cli
publish kind=0 content='{"name":"Nome '$i'"}'; done`.

**Upper bound onde lens contribui:** `mutual-follow` mode é
substancialmente mais caro de burlar — requer o viewer ATIVAMENTE
seguir o Sybil. Mas isso não é "lens funcionando"; é "Sybil não tem
relacionamento social com você", que é tautológico (mute/block fariam
o mesmo trabalho).

**Worst case (e mais provável):** spammer farm gera 10k Sybils com
nome — passa o filtro. User pensa "filtrei spam, agora vejo gente
real". Na verdade filtrou **só os anônimos legítimos** (whistleblowers,
contas alt, ativistas) e os spammers determinados continuam visíveis.
**Damage: anônimos silenciados E user enganado sobre o que o filtro
faz.**

### Avaliação custo-benefício pro atacante

| Atacante | Payload (engagement post-filtro) | Custo | Worth it? |
|---|---|---|---|
| Spammer comercial (link farm) | Alto se passar filtro | ~$0 | **SIM**, trivialmente |
| Influencer farm (boost artificial) | Alto | ~$50 | **SIM** |
| Estado-nação (manipulação política) | Alto estratégico | $$$ | **SIM** sempre |
| Bot preguiçoso (default kind 0 vazio) | N/A | $0 | Único caso barrado |

**Conclusão dura:** filtro barra **só o atacante preguiçoso que já
seria barrado por qualquer heurística**. Contra o threat realista
pós-launch (spam farm minimamente competente), é **teatro de segurança**.
Marshall reconhece isso na §4 dele e foi honesto.

### Copy do Marshall resiste?

A copy proposta:

> "Não filtra bots determinados — qualquer Sybil pode publicar um nome.
> Use junto com outras lens (PPR Trust, follows mútuos) pra sinal real."

**Avaliação Barney:**

- ✅ **Factualmente correta**.
- 🟡 **Sobrevive A/B test?** Provavelmente **NÃO** em 12 meses.
  Designer/PM olha pra copy assim e pensa "isso assusta user, melhor
  suavizar". Wording mais "trusty" tipo "Mostra autores que se
  apresentaram com nome" + esconder o disclaimer em tooltip = mesma
  feature, copy diferente, §4 violado.
- 🛑 **Defesa estrutural necessária:** LOCK_VIA_TEST trava
  vocabulário (`verified`, `trusted`, `official`, `genuine`,
  `real user`, `not a bot`, `anti-spam`, `anti-bot`) — bate hard em
  PR cosmético que tentar suavizar a copy pra branding. Sem o test,
  copy do Marshall tem meia-vida de ~6 meses.

---

## 4. Avaliação da copy Marshall — factual o suficiente?

| Aspecto | Marshall propôs | Barney avalia | Ação |
|---|---|---|---|
| Tom | Factual, não normativo | ✅ Correto | Manter |
| Trade-off explícito | "esconde vozes legítimas que escolhem pseudonimato" | ✅ Forte | Manter literal |
| Disclaimer anti-Sybil | "Não filtra bots determinados" | ✅ Honesto | Manter literal |
| Resistência a redesign | Sem proteção estrutural | ⛔ Vulnerável | **Adicionar LOCK_VIA_TEST de vocabulário (§6.C1)** |
| Posicionamento UI | "Não destacar visualmente" | 🟡 Bom mas frágil | **Adicionar LOCK_VIA_TEST §6.C2 (sem `recommended`, sem onboarding mention)** |
| Default state | OFF | ✅ Correto | **Adicionar LOCK_VIA_TEST schema veta `default: true` (§6.C2)** |

Marshall escreveu boa copy. Barney quer copy **com cinto de segurança**.

---

## 5. Mitigations adicionais (não cobertas pelo Marshall)

### M1 — LOCK_VIA_TEST vocabulário proibido (CRÍTICO)

Estender `tests/manifesto-conformance.test.ts` ou criar
`tests/lens-copy-conformance.test.ts`:

```ts
// Pseudocódigo
const PROIBIDO_PERTO_DE_LENS = [
  /verified/i, /trusted/i, /official/i, /genuine/i,
  /real\s+user/i, /not\s+a\s+bot/i, /anti[-\s]?spam/i,
  /anti[-\s]?bot/i, /✓\s*identif/i, /selo/i, /verificad/i,
]
// Grep em src/components/**/*.tsx + src/lib/lens/**/*.ts
// Falha se qualquer regex match em radius de 200 chars de
// 'identified-only' ou 'IdentifiedOnly'
```

Custo: ~50 linhas test. Benefício: cenários C2, C5, C10 mitigados
estruturalmente.

### M2 — Schema LensConfig veta promoção

```ts
// src/lib/lens/types.ts
interface LensConfig {
  id: string
  version: number
  params: Record<string, unknown>
  // PROIBIDO: recommended, featured, default, promoted
  // LOCK_VIA_TEST: type-check + runtime assert no registry
}
```

Test em `tests/lens-registry-conformance.test.ts`:
- nenhuma strategy tem `default: true`
- `identified-only` nunca aparece em `src/components/Onboarding/**`
- ordem no dropdown determinística (Marshall §5) — falha se PR muda
  ordem sem atualizar test

### M3 — Telemetria-zero estrutural

Proibir adicionar `localStorage`/`db.run('INSERT INTO lens_usage...')`
contando ativações. Razão: **se a métrica não existe, ninguém
otimiza ela**. Sem KPI = sem nudge.

LOCK_VIA_TEST: grep em `src/lib/lens/**/*.ts` por `INSERT INTO`,
`localStorage.setItem`, `analytics.track`. Test falha se aparecer
em código relacionado a lens.

### M4 — Warning não-dismissable na primeira ativação

Marshall propôs copy. Barney adiciona: **primeira ativação** abre
modal com warning completo, botão "Ativar mesmo assim" só habilita
após 3s (anti-click-through). Próximas ativações são silenciosas.

Custo: ~30 linhas em `src/components/Settings/LensPicker.tsx`.
Benefício: cenário C3 (social pressure) — user ativa consciente, não
no automático.

### M5 — Composability warning quando 2+ filtros restritivos ativos

Cenário C9: `ppr-trust ∩ identified-only(mutual-follow)` é
"interseção de exclusões". UI mostra banner "Você ativou 2 filtros
restritivos — pode esconder a maior parte do feed". Não bloqueia,
só sinaliza.

### M6 — README / Manifesto coverage matrix entry

Adicionar entrada em `Docs/manifesto-coverage-matrix-*.md`:
- §4 status atual: 🟡 (já está)
- Adicionar nota: "lens `identified-only` introduz superfície de
  pressão cultural sobre §4; defesa estrutural via 3 LOCK_VIA_TESTs
  + telemetria-zero (ver `barney-lens-identified-threat-2026-05-23.md`)"

Mantém rastro pra contributors futuros sobre POR QUE a feature tem
todos os guards (sem isso, alguém remove o test "porque parece
paranoia").

---

## 6. Veto items (estendem Marshall §6)

Marshall listou 6 vetos duros. Barney concorda integralmente com os
6 e adiciona 3:

### Vetos Marshall (mantidos)

1. Whitelist NIP-05 curada
2. Badge "verified" / "✓" / "official"
3. Boost de score canônico
4. Publicação Nostr "filtro user X"
5. Default-on
6. Wording que iguala anônimo a spam/fake

### Vetos Barney (NOVOS)

**B1 (== M1) — Vocabulário proibido sem LOCK_VIA_TEST.**
Se a PR de implementação não inclui o test de vocabulário proibido
(§5 M1), **NO-GO retroativo**. Não é nice-to-have; é a defesa contra
copy creep que destrói §4 em 6 meses.

**B2 (== M2) — Promoção / onboarding / recommended.**
Se `LensConfig` schema permitir campo `recommended`/`featured`/
`default: true`, ou se `identified-only` aparecer em qualquer
arquivo dentro de `src/components/Onboarding/**` (mesmo como exemplo),
**NO-GO retroativo**.

**B3 (== M3) — Telemetria de adoção da lens.**
Qualquer commit subsequente que adicione contador/log/métrica de
"users com identified-only ativo" — local-only ou não — **NO-GO
retroativo**. Métrica vira KPI; KPI mata default-OFF.

---

## 7. Convergência / divergência com Marshall

### Convergências (100% align)

- ✅ Feature é legal sob §17/§22/§24/§28 com as condições.
- ✅ NIP-05 whitelist editorial é veto duro (§17 chave mestra).
- ✅ View boundary `s_local` nunca persisted (LOCK_VIA_TEST #2 estende).
- ✅ 2 modos `profile-declared` + `mutual-follow` são os signals corretos.
- ✅ Copy factual, não normativa.
- ✅ Lens é uma entre muitas no registry, não default.
- ✅ Filtro é **affordance de curadoria**, **não defesa anti-Sybil**
  (honestidade radical — match com MEMORY user).

### Divergências / extensões

- 🟡 **Marshall confia em copy explícita; Barney exige LOCK_VIA_TEST
  do vocabulário.** Copy boa morre em 6 meses sem teste.
- 🟡 **Marshall não cobriu telemetria.** Barney adiciona veto
  estrutural (M3/B3) — sem métrica = sem KPI = sem nudge default-on.
- 🟡 **Marshall não cobriu onboarding wizard.** Barney veta menção
  em `src/components/Onboarding/**` via grep test (B2 estendido).
- 🟡 **Marshall não cobriu composability warning (cenário C9).**
  Barney adiciona M5 (banner quando 2+ filtros restritivos).
- 🟡 **Marshall não cobriu warning não-dismissable na primeira
  ativação.** Barney adiciona M4.

### Em resumo

Marshall fez o trabalho de **conformance** impecavelmente. Barney
adiciona o trabalho de **threat modeling temporal** — o que acontece
nos 6-24 meses após o ship, quando ninguém lembra mais por que a
copy era factual e o default era OFF. As 3 condições extras
transformam intenção em **defesa estrutural verificável em CI**.

> "Code reviews are temporary. LOCK_VIA_TESTs are forever." — Barney

---

## 8. Recomendação final

**GO-COM-CONDIÇÕES-EXTRA.** Implementar conforme Marshall §7,
**adicionando obrigatoriamente** antes do merge:

1. `tests/lens-copy-conformance.test.ts` — vocabulário proibido
   (~50 linhas)
2. `tests/lens-registry-conformance.test.ts` — schema sem
   `recommended`/`default`, grep `src/components/Onboarding/**` (~80
   linhas)
3. Grep guard contra telemetria de lens em `src/lib/lens/**`
   (~20 linhas, pode entrar no test do item 2)
4. Warning não-dismissable + delay 3s na primeira ativação (~30 LoC
   componente)
5. Composability warning quando 2+ filtros restritivos (~20 LoC)
6. Entry em `manifesto-coverage-matrix` linkando este doc

Total estimado: ~200 LoC test/guard + ~50 LoC UX. **Não bloqueante
pro timeline da Sprint N+3**, mas **bloqueante pro merge** —
sem isso, NO-GO retroativo aplicado.

Dispatch sugerido pós-aprovação:

- **Lily** — strategy `identified-only.ts` + 3 conformance tests do
  Marshall §7
- **Robin** — copy final + tradução pt-BR + entry no guia do usuário
- **Marshall** — schema final `LensConfig` (sem `recommended`)
- **Barney (eu)** — 3 LOCK_VIA_TESTs (vocabulário, registry, telemetria)

---

**Sumário Barney (legen-...-dário):** Marshall blindou o predicado e
o view boundary. Eu blindo o produto em volta. As 3 condições extras
são **defesa contra o atacante que mais importa: a deriva organizacional
de boa-fé em 12 meses**. Sem elas, esta feature é uma armadilha bem
desenhada pro §4 morrer de mil polishings cosméticos. Com elas, é
mais uma lens no registry — exatamente o que o design doc previu.

**Suit up. Add the tests. Ship it.**

*— Barney, 2026-05-23*
