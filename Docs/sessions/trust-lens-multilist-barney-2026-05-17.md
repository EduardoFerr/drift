# Multi-list curation + parental control — Barney threat review

**Data:** 2026-05-17
**Persona:** Barney (peer review crítico, threat modeling)
**Trigger:** User proposed Phase 2/3 expansion — multi-list curation with per-list strength sliders + parental control via password lock
**Status:** Veredict registrado. Aguarda decisão política do Arquiteto + Lily UX + Robin research em paralelo.

## Veredict

**REJECT na forma atual.** Aceitável como DUAS features separadas com constraints duros:

- ✅ **Multi-list mixer 0-100%** — PASSA manifesto-wise se Trust Lens permanece sempre na base e source de cada lista é auditável
- ❌ **Password-locked parental control** — Violação direta de §17 derivado ("Drift nunca contra o user") e §25 (chave mestra disfarçada). Empurra pra **fork separado / plugin opt-in / não existe** — não no cliente oficial.

## Manifesto §17/§25 stress test

### Argument map

**Pró-parental (5 argumentos):**
1. §17 protege contra catedral global; pai/filho é relação doméstica local
2. Feature opt-in — adulto nunca encontra
3. Pai compra device → autoridade IRL preexistente
4. Drift não exerce poder, só fornece UI pra autoridade já existente
5. "Sem isso, pais usam Instagram que é pior" (consequentialism)

**Contra-parental (6 argumentos com mais peso):**
1. **§17 derivado**: "Drift NUNCA deve ser usado contra o user". Filho que não pode desligar É user; está sendo usado contra ele.
2. **§25 slippery slope concreto** (não hipotético): "Hoje pai, amanhã boss controla device corp, Estado controla cidadão, marido abusivo controla esposa". Apple Screen Time **é documentadamente abusado em violência doméstica**.
3. **§17 não-discriminação por idade**: manifesto não fala "user adulto". Criança de 10 anos com nsec é user.
4. **§13** cliente NÃO deleta dados moderados — "hide list with password" é moderação destrutiva por proxy, mesma família.
5. **Bypass trivial em PWA** (DevTools/reinstall/clear IndexedDB) torna feature **dishonest by design**. Pai pensa que protege, criança técnica burla em 30s. Drift teria que MENTIR sobre eficácia → viola §29 (transparência).
6. **Slippery design**: aceitar "pai-filho" abre PR de "supervisor-funcionário". Recusar depois é incoerente.

**Argumento PRÓ-2 ("adulto opt-in") falha porque**: quem opt-in NÃO é quem é restringido. O *consentimento informado* exige que quem é restringido escolha. Pai escolhendo PELO filho é exatamente o template que §17 proíbe.

### Posicionamento Barney

Multi-list mixer: passa com constraints. Password lock parental: **não passa no cliente oficial**. Se Arquiteto realmente quer, vive como:
- Fork separado ("Drift Family") com manifesto próprio que assume trade-off
- Plugin opt-in carregado runtime via flag — DOC explícita "violates §17 derivative"
- OU **não existe**. Pai usa controle do OS (Screen Time / Family Link), tier correto pra parental authority

## Password lock — 10 ataques + mitigações

| # | Ataque | Severidade | Mitigação | Residual |
|---|---|---|---|---|
| 1 | DevTools bypass | **Alto** | Honest disclosure + minify | **Alto** — irreduzível PWA |
| 2 | Reinstall PWA → wipe | **Alto** | Nenhuma realista | **Alto** — irreduzível |
| 3 | Clear IndexedDB browser | Alto | Nenhuma | **Alto** — irreduzível |
| 4 | Multi-identity escape (filho cria nsec2) | **Crítico** | Lock per-identity + UI clara | Médio — bypass trivial |
| 5 | Pai esquece senha | Médio | Sem recovery; nuke-only; nsec export obrigatório pré-criação | Baixo — wipe é OK trade-off |
| 6 | Phishing via URL `?action=disable_list&id=X` | **Crítico** | Whitelist URL handler (P0.3 Phase 1 ESTENDER) | Baixo se whitelist mantido |
| 7 | Social eng pai pra ativar lista hostil | Alto | Confirm dialog + preview 5 sample posts escondidos | Médio |
| 8 | Trojan list ("anti-spam" filtra críticos) | **Crítico** | Source obrigatório + audit log mudanças over time | Médio |
| 9 | Coação familiar (pai abusivo) | Alto | Out-of-scope técnico; NÃO logar quem ativou | Médio |
| 10 | "Stealth mode" pai sem indicator | **Crítico** | "X% do feed escondido" SEMPRE visible, não-desligável | Baixo se enforced |

**Conclusão**: ataques 1-3 são irreduzíveis em PWA. Combinados, fazem feature *security theater*. Shipping isso = mentir pra pais sobre proteção inexistente. **Barney call: não vale**.

## Source attack surface (multi-list mixer — assumindo password lock fora)

| Source | Privacy leak | Gaming | Centralização | Mitigação |
|---|---|---|---|---|
| Local-criada pelo user | Zero | N/A | Não | Nenhuma adicional |
| NIP-32 labelers externos | Provider sabe queries | Alto | Alto — top-3 dominam | Honest disclosure + show npub + multi-provider + 1-click off |
| NIP-85 Trusted Assertions / Vertex DVM | Mesmo que NIP-32 | Médio (signed) | **Alto** — Vertex já é monopolio nicho | Warning "Vertex fornecedor único hoje" |
| Pre-fab hardcoded Drift | Zero runtime | Médio (PR malicioso) | **Alto** — vira recomendação Drift Inc | NUNCA pre-popular default; só via Discovery; reproducible build; source git |
| NIP-78 import bundle | Quem assinou sabe | Alto | Baixo | Assinatura + npub source + warning "este bundle vem de @X" |

**Padrão crítico**: nenhuma source pode ser default-ON. Onboarding NUNCA empurra. Aplica invariante #18 (relay moderado opt-in) direto.

**Bandeira vermelha**: se Vertex DVM vira dependência prática (98% users ativam), Drift cai no trap PLC do Bluesky. Instrumentar telemetry local que ALERTA se um único provider domina.

## Per-list mixer — ataques cumulativos

### Conflict resolution
Cenário: Lista A "include @x" 70% vs Lista B "exclude @x" 30%.

**NÃO resolver via média ponderada** — opaque math user não entende. Fazer **explicit conflict surface** no Inspector + toggle. Default: **exclude vence** (privacy-protective fallback estilo Tahoe-LAFS).

### Cumulative censorship
5 listas filtrando 10% cada → 50% do feed desaparece.

**Mitigação obrigatória**: indicator persistente "Suas listas estão escondendo X% do feed" no topo quando X > 15%. Não-desligável quando há password lock ativo.

### Mix complexity DOS
Cap N=10 listas ativas (Bluesky usa 20 pra labelers). Recompute debounce 200ms já estabelecido.

Lista com 100k entries → cap rows por lista = 50k LRU (paralelo a `lens_edges` cap P0.1).

### Strength gaming entre listas
Lista pretende "qualidade" mas silenciosamente desfavorece críticos.

**Mitigação**: audit log local "lista X mudou política em [data]: +N hidden, -M shown". Local-only diff observation. Análogo a Signal Safety Number change alarm.

## Cross-feature interactions

### Pipeline order proposto

```
1. PPR ranking (Trust Lens base) — view-only multiplier
2. Filter rules locais (Phase 1.5 "limpar da lente") — hard hide
3. Listas externas ativas — additive filters por slider
4. Conflict resolver — exclude-wins default
5. Reports + score=-999 — manifesto §26 prevalece sempre
```

### Trust Lens sempre presente

Trust Lens é **lista nativa zero, sempre presente, não removível**, slider 0-100%. Listas externas adicionam camada. Lente desligável a 0% mas com **warning** "Sua Lente está em 0% — apenas listas externas estão ordenando seu feed".

### Filter rules locais ganham sempre

Filter rules locais ("limpar da lente" Phase 1.5) são **always hard exclude**, peso 100% implícito, fora do mixer. Listas externas NUNCA podem "incluir" alguém que filter_rule local excluiu.

## 6 bandeiras vermelhas Phase 2/3 — NÃO cruzar

1. **Password lock parental no cliente oficial** — argumentado acima
2. **Trust score público (mesmo via NIP-85 opt-in)** — Ted survey §3.1 já flagou
3. **Default-ON em qualquer lista externa** — onboarding nunca empurra
4. **Sync de filter_rules entre devices via Nostr** — publica explicitamente o que você esconde = vetor de vigilância. Sneakernet/QR ok Fase 7.
5. **Lista pre-fab "anti-CSAM/extremismo" hardcoded com escopo amplo** — operador do scanner herda chave-mestra (invariante #7). User-opt-in NIP-32/85 ok; pre-fab no client default não.
6. **"Stealth mode" parental** (lista ativa sem indicator visible) — mesmo em plugin, "X% escondido" SEMPRE visible

## Handoff

- **Ted** (arquitetura): revisar pipeline order proposta; definir contrato de plugin se password lock virar plugin; validar "exclude wins" default vs capability-based mental model
- **Marshall** (schema/conformance): schema `curation_lists` + extension `lens_filter_rules` com `list_id`. **Test crítico**: grep que `password_hash` nunca sai do device (raw_event, export bundle, logs). LOCK_VIA_TEST §17.
- **Lily** (UX, rodando paralelo): copy + confirm dialog + "X% escondido" indicator + audit log
- **Robin** (research, rodando paralelo): Apple Family Link, Pixelfed parental, Mastodon mod tools — estado da arte + casos de abuse de Screen Time documentados
- **Arquiteto (você)** — decisão política não-delegável: **filho menor é user §17 ou não?** Registrar explícito em `Docs/manifesto.md` ou ADR — não pode ficar implícito.
