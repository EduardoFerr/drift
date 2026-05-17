# Multi-list curation + parental lock — Lily UX deep dive

**Data:** 2026-05-17
**Persona:** Lily (UX, runtime, fluxos, manutenibilidade)
**Trigger:** User proposed Phase 2/3 expansion — multi-list curation with per-list strength sliders + password lock
**Status:** Veredict UX + wireframes texto + copy PT-BR. Aguarda Robin research + decisão política Arquiteto.

## Veredict UX

**Ship Phase 3 — não Phase 2.** Sequência natural:
1. Phase 1: Sua Lente single-lens
2. Phase 1.5: Rede view no SpreadMap
3. Phase 2: Vertex DVM opt-in (PPR turbinada)
4. **Phase 2.5: "Lentes Bloqueáveis"** — apenas password lock sobre Sua Lente única, sem multi-list. Resolve caso pai-filho com 10% do scope
5. Phase 3: Multi-list mix-and-match completo

## Naming + mental model

**Coleção**: "**Lentes**" (plural). Cada item é uma lente individual.

Hierarquia naming:
- "Lente Pessoal" (Phase 1 antes chamada "Sua Lente" — agora item nomeado dentro de Lentes)
- "Lente Comunitária"
- "Lente Familiar"
- "Lente Convidada"

Razões:
- Reusa mental model Phase 1 — user já internaliza "lente"
- Plural natural em PT-BR ("suas lentes")
- "Lente" carrega óptica passiva, não controle ativo
- Evita "curadoria" (peso editorial/museu, queimado por Bluesky Ozone)
- Evita "camadas" (Photoshop jargon), "filtros" (Instagram aesthetic), "listas" (conflito com `LocalListsSettings`)

**Termos a evitar**: filtros parentais, controle parental, lista negra/branca, conteúdo apropriado, modo seguro, whitelist/allowlist.

## Wireframes (texto compacto — versão completa em chat history)

### Settings → Lentes (overview)

Card root com lista de Lentes. Cada linha:
- Toggle ativa/inativa (◉/○)
- Nome + cadeado 🔒 se locked + status pill
- Caret ▼ pra expand (Collapse pattern existente)
- Source linha ("curada por @x")
- Slider 0-100% (visível quando expandido)

Rodapé persistente: "Suas lentes estão escondendo ~X% do feed global" — mitigação Barney cumulative censorship.

### Adicionar lente

Sheet com 3 caminhos:
1. Colar npub/link
2. Escanear QR de outro device
3. Sugestões da rede (via PPR existente — lentes ativas entre top-PPR pessoais)

**Sem marketplace oficial** — discovery peer-to-peer pura.

### Setup password (primeira vez)

Modal com **honest disclosure obrigatório**:
- Drift não recupera senha
- PWA tem bypass via DevTools por design — recomenda app instalado / Tauri Phase 6
- Identidade preservada via export nsec separado
- Argon2id local, sem recovery service

### Recovery flow

Documenta que único caminho é "limpar local + reinstalar + reimportar identidade". User perde lentes/histórico/blocks; mantém identidade/posts/conexões.

## Copy PT-BR proposto

**Helper texts** (slider):
- 0%: "Esta lente não afeta seu feed."
- 1-49%: "Esta lente influencia levemente seu feed."
- 50-79%: "Esta lente reorganiza claramente seu feed."
- 80-100%: "Esta lente domina seu feed — posts fora dela quase não aparecem."

**Cumulative banner**: "Suas lentes estão escondendo ~12% do feed global. [ver detalhes]"

**Empty state**: "Você está usando só sua Lente Pessoal. Adicione lentes de pessoas em quem confia pra ampliar sua visão da rede."

**Setup password** — reframe Ulysses pact:
> "Útil pra proteger configurações de uso compartilhado (família, kiosks) ou pra você mesmo evitar mudanças impulsivas."

Posiciona como **self-binding feature**, não parental control — esquiva da objeção §17 do Barney (ver tensão abaixo).

## A11y

- Slider: `role="slider"`, valor verbal "influência 60 por cento", setas ←→ 5%, Home/End extremos
- Cadeado: `aria-label="lente bloqueada por senha"`, não decorativo
- Toggle ativa: `role="switch"`, `aria-checked`
- Modal senha: focus trap + ESC + `role="dialog"` + initial focus no input
- Input senha: `type="password"`, toggle 👁 com `aria-pressed`
- Cumulative censorship indicator: `role="status"`, `aria-live="polite"`, anuncia quando muda >5%
- Status pills cor + texto (WCAG 1.4.1)
- Slider snap stops verbalizados: ao snapar em 50, screen reader anuncia "moderado"

## Decisões críticas

| Decisão | Pick |
|---|---|
| Naming coleção | **"Lentes"** (plural) |
| Slider sum >100% | **Permitido** (multiplicativo, não aditivo) |
| Conflict A include vs B exclude | **Exclude vence** + UI diff em "ver detalhes" |
| Cumulative censorship | **Sempre visível**, threshold ≥10% destaca, ≥30% warning sutil |
| Password storage | **Argon2id local** + IndexedDB separado (reusa pattern master key) |
| Password framing | **"Bloqueio dissuasivo"** (Tauri Phase 6 = trava criptográfica real via OS keychain) |
| Lock visibilidade pro filho | **Sempre visível com cadeado** — transparência, sem lentes invisíveis |
| 3-strike cooldown | **Soft** (30s → 5min → 30min), sem nuke |
| Trocar senha sem nukear | **Sim** — Settings → "Trocar senha" |
| Pre-fab "Kids-Safe" embutida | **NÃO** — viola §17/§18, Drift escolhendo curadoria = centralização |
| Sugestões orgânicas | **Sim** via PPR — "lentes ativas entre seus top-PPR" |
| Lente source visível | **Sempre** — npub completo + last_updated |
| Update lente sem consent | **Não** — pull manual ou opt-in auto-pull |
| Conflict clear-lens (Phase 1.5) | Long-press cria filter_rule na **Lente Pessoal**, não cria lista nova |
| Filter rules existentes (block/mute) | **Compõem, não substituem** — block sempre vence (hard veto) |
| Slider snap stops | **0/50/100** com labels Nenhuma/Moderada/Forte |
| Adulto sem filhos vendo "password lock" | **Reframe self-binding** — "bloquear de mim mesmo / usos compartilhados" |

## Tensão Lily vs Barney sobre password lock

Barney rejeitou password lock como violação §17 (filho menor é user). Lily reframe semântico:

- Se feature é "self-binding" (user bloqueia ele mesmo), §17 não viola — é user contra impulsividade própria
- Pai usar contra filho passa a ser **misuse spiritoso de feature legítima**, não defeito da feature
- Honest disclosure DevTools bypass é crítico — usuário entende que é dissuasivo, não criptográfico

Lily concede: **a feature existe e cria affordance pro misuse**. Esta é a decisão política não-delegável do Arquiteto — onde traçar linha entre "self-binding legítimo" vs "parental control de facto".

Possível síntese (registro pendente):
- Phase 2.5 ship "Lock" framed como Ulysses pact
- Documentar em manifesto que misuse contra menores viola espírito §17 mas não é prevenível por design
- Tauri Phase 6 oferece OS-level lock real pra quem quer proteção criptográfica

## Riscos UX + mitigações principais

| Risco | Mitigação |
|---|---|
| Feed vazio (5 lentes a 100%) | Cumulative indicator + quick-action "voltar à Lente Pessoal só" |
| Filho descobre DevTools bypass | Honest disclosure + Tauri Phase 6 recomendação |
| Lente vira maliciosa após user assina | Update notification + diff review + auto-pull off default |
| Centralização emergente (3 lentes dominam) | Sem marketplace, sem editorial, só sugestões PPR pessoais |
| Slider intimidante non-tech | Snap stops + labels + helper text dinâmico |
| Password lock pega mal pra adulto sem filhos | Reframe self-binding em copy |
| Curadoria vira vetor manipulação política | §17 holds — cliente não pré-popula, discovery 100% peer-to-peer |

## Handoff

- **Marshall (schema)**: tabelas `lenses` + `lens_subscriptions` (user-state, NÃO em DOMAIN_TABLES); coluna `lens_id` opcional em `lens_filter_rules`. Password Argon2id (params iguais master key existente). NIP-51 kind 30000 reusar pra publicação de lente — zero novos kinds.
- **Barney** (paralelo): novos P0 — (1) lock dissuasivo + honest disclosure; (2) silent extend protection (update notification opt-in); (3) cumulative censorship indicator obrigatório
- **Ted**: Lente Pessoal = instância especial de `lenses` com `lens_id='personal'`. Worker `trust.worker.ts` precisa hook recompute quando subscription strength muda. NIP-51 kind 30000 vs custom kind — Lily recomenda NIP-51 compat ecossistema §28-30
- **Robin (paralelo)**: Bluesky Ozone composition lessons; NIP-51 kind 30000 adoção; Argon2id browser WASM bundle/perf; user research 3-5 pais PT-BR validando honest disclosure copy; anti-centralização pattern (F-Droid vs Play Store)
- **Arquiteto**: decisão política não-delegável registrada em manifesto — "feature self-binding" passa, "parental control affordance" exige redação explícita do que aceitamos
