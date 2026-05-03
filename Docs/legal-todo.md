# Drift — Legal TODO (incremental)

> last-updated: 2026-05-02 · curador: Lorenzo Von Matterhorn · status: ativo
>
> Checklist incremental derivado de
> [`sessions/legal-analysis-marshall-2026-05-02.md`](sessions/legal-analysis-marshall-2026-05-02.md).
> Cada item tem `[ ]` pra marcar quando fechado. Reordenar é OK; remover
> sem motivo, não — Marshall identificou isso como necessário.
>
> **Constraint vinculante:** *"Lorenzo Von Matterhorn ser penalizado, não deve
> impedir o Drift de existir, persistir e expandir."*

---

## Como usar este documento

- Marque `[x]` quando fechar.
- Se decidir não fazer um item, mantenha o checkbox e adicione `→ [DEFERIDO: motivo]` na linha. Auditoria honesta.
- Custos `R$` e tempos são estimativas Marshall; ajuste com realidade.
- Gatilhos `🟢/🟡/🔴/⚪` indicam quando fazer (não esforço relativo).

---

## 🟢 IMEDIATO — semanas, defensivo, reduz exposure pessoal AGORA

### 4.1 — Mirrors automatizados em ≥2 hosts
- [ ] Criar conta Codeberg
- [ ] Criar conta GitLab (ou usar existente)
- [ ] Configurar mirror automático via GitHub Actions push (Robin entregou design em `sessions/robin-code-followup-2026-05-02.md`)
- [ ] Verificar push funciona em ambos após cada commit

**Custo:** 4-8h dev + 5min criação contas. R$ 0.
**Risco reduzido:** takedown unilateral GitHub não derruba projeto.
**Quem:** solo.

### 4.2 — Pin IPFS de cada release
- [ ] Conta web3.storage (ou Pinata free tier)
- [ ] Workflow GitHub Action que pina `dist.zip` + binários Tauri após cada tag `v*`
- [ ] CID publicado em release notes automaticamente
- [ ] Update `Docs/continuity.md` com instruções de fetch via IPFS gateway

**Custo:** 4h dev. R$ 0–50/mês.
**Risco reduzido:** continuidade de distribuição mesmo se GitHub Releases for derrubado.
**Quem:** solo.

### 4.3 — Separar identidade pública do projeto
- [ ] Criar org GitHub `drift-protocol` (gratuito)
- [ ] Transferir repo `EduardoFerr/drift` → `drift-protocol/drift` (mantém histórico, redireciona URL antiga)
- [ ] Re-bind Vercel project ao novo repo path
- [ ] Atualizar workflows + docs com novo path
- [ ] Renomear deploy Vercel `drift-wheat-one` → algo neutro (ex.: `drift-pwa`)
- [ ] Verificar `package.json` continua sem `author` field
- [ ] Verificar `Cargo.toml` continua `authors = ["Drift contributors"]`
- [ ] Sanity check: `git log --format='%an <%ae>'` ainda mostra histórico (não force-push pra reescrever)

**Custo:** 2-4h. R$ 0.
**Risco reduzido:** reduz coupling automático "Drift = Lorenzo Von Matterhorn PF" em buscas casuais. **Não elimina rastreabilidade** (git log persiste).
**Quem:** solo.
**Caveat:** breaking change em URLs externos — coordene com qualquer link já compartilhado.

### 4.4 — Caixa postal jurídica separada
- [ ] Email dedicado em provedor pró-privacidade (Proton, Tutanota, ou domínio próprio)
  - Sugestão: `legal@drift-protocol.org` (se registrar domain) ou `drift-legal@proton.me`
- [ ] Adicionar em `SECURITY.md` como canal único pra notificações jurídicas
- [ ] Configurar forward pra advogado(a) **quando** 4.6 estiver feito; antes disso, só receber + arquivar
- [ ] **Nunca usar email pessoal pra resposta a notificação jurídica**

**Custo:** 2h. R$ 0–100/ano (depende se registrar domain).
**Risco reduzido:** cria audit trail; evita surpresas em inbox pessoal; sinaliza profissionalismo (reduz hostilidade do notificante).
**Quem:** solo.

### 4.5 — `Docs/governance.md`
- [ ] Doc novo declarando explicitamente: Drift é projeto FOSS sem entidade jurídica
- [ ] Listar contributors atuais (com handles públicos, não nomes civis quando possível)
- [ ] Declarar limites de papel do maintainer principal:
  - revisão de PRs e release tagging
  - **não** opera infraestrutura de produção
  - **não** tem capacidade técnica de moderar conteúdo (manifesto §17)
  - **não** detém custódia de dados de usuários
- [ ] Cross-link com `CONTRIBUTING.md`, `SECURITY.md`, `PRIVACY.md`

**Custo:** 2h. R$ 0.
**Risco reduzido:** evidência documental contemporânea pra defesa futura ("provedor é quem opera; eu mantenho código").
**Quem:** solo.

---

## 🟡 CURTO PRAZO — meses, estrutural, viável solo

### 4.6 — Consulta preventiva com advogado(a) digital ⭐ **prioridade alta**
- [ ] Triagem inicial gratuita: contatar **um** dos seguintes
  - [ ] ITS-Rio ([itsrio.org](https://itsrio.org))
  - [ ] InternetLab ([internetlab.org.br](https://internetlab.org.br))
  - [ ] Coding Rights ([codingrights.org](https://codingrights.org))
- [ ] Sessão única (2-3h) com advogado(a) sênior em direito digital
  - Foco: revisão de SECURITY/PRIVACY/CONTRIBUTING + mapeamento de exposição
  - **Não** representação contínua — diagnóstico
- [ ] Documentar achados privadamente (não comitar)
- [ ] Atualizar este TODO conforme orientações OAB-vinculantes

**Custo:** R$ 1.500-3.500.
**Risco reduzido:** substitui análise LLM por análise OAB-vinculante. **Melhor ROI defensivo do roteiro inteiro.**
**Quem:** solo, mas com triagem ITS-Rio/InternetLab antes (gratuita).
**Gatilho:** assim que houver orçamento. **Antes de qualquer ação 🔴.**

### 4.7 — Build reproduzível Windows/macOS
- [ ] Estender `Dockerfile.reproducible` ou GitHub Actions matrix
- [ ] Pin total de toolchain (Rust version, MSVC version, Xcode CLT version)
- [ ] Verificar bit-identical em rebuild de mesma tag
- [ ] Documentar em `Docs/build-reproducible.md`

**Custo:** 20-40h dev.
**Risco reduzido:** assinatura do mantenedor deixa de ser prova única — qualquer fork reproduz.
**Quem:** solo (técnico).
**Gatilho:** após 🟢 completos.

### 4.8 — `Docs/legal-policy.md` (política de não-resposta)
- [ ] Doc declarando publicamente:
  - (a) maintainer responde **apenas** a ordens judiciais brasileiras válidas
  - (b) notificações extrajudiciais (Art. 21 MCI fora de escopo, takedown não-fundamentado) são publicadas em `Docs/legal/` (transparência)
  - (c) compromisso público com [Lumen Database](https://lumendatabase.org) ou similar
- [ ] Criar diretório `Docs/legal/` com README explicando convenção
- [ ] Cross-link com SECURITY.md

**Custo:** 4h.
**Risco reduzido:** cria expectativa pública; aumenta custo reputacional pra notificante abusivo; gera precedente de transparência.
**Quem:** solo.
**Gatilho:** após 🟢 4.5.

### 4.9 — Auditoria de exposure de PII no repo
- [x] Scan inicial 2026-05-02 — categorias e contagens em 4.9.1 abaixo
- [x] Pseudônimo escolhido: **Lorenzo Von Matterhorn** (HIMYM canon, full name sempre — não abreviar)
- [x] Postura confirmada: **refator incremental case-by-case**, não mass replace. Cada substituição valida não-quebra antes de aplicar (CI cache, integração externa, scripts, comment-anchors).

#### 4.9.1 — Catálogo de PII pra refator incremental

**Comando reprodutível pra re-scan (rodar antes de cada lote):**

```bash
# Eduardo standalone (excluindo EduardoFerr handle e full name)
grep -rn '\bEduardo\b' Docs/ CHANGELOG.md README.md | grep -v 'EduardoFerr'

# Full civil name
grep -rn 'Eduardo de Moraes Ferreira' Docs/ CHANGELOG.md README.md

# Personal Windows paths (catalog, não substitui agora)
grep -rn 'C:\\Users\\Eduardo' Docs/

# GitHub handle (Item 4.3 trata via repo migration, não cosmética)
grep -rn 'EduardoFerr' Docs/ CHANGELOG.md README.md

# Emails (catalog em separado quando aparecerem)
grep -rn 'eduardo\.ferreira\|ferr\.tutorial' .
```

**Status do scan inicial 2026-05-02:**

| Categoria | Count | Files | Action |
|---|---|---|---|
| `\bEduardo\b` standalone (prosa) | 69 | 9 docs | replace caso-a-caso |
| `Eduardo de Moraes Ferreira` (full civil name) | 2 | 2 docs | replace caso-a-caso |
| `C:\Users\Eduardo\...` (Windows paths) | ~5 | 3 docs | catalog → genericizar quando seguro |
| `EduardoFerr` (GitHub handle, técnico) | 33 | 10 docs | NÃO mexer agora (Item 4.3) |
| Emails (`eduardo.ferreira@*`, `ferr.tutorial@*`) | 0 | 0 | scan limpo no repo committado |

#### 4.9.2 — Refator incremental por arquivo (Eduardo standalone + full name)

Cada item: ler arquivo, validar contexto não-técnico, replace `\bEduardo\b` → `Lorenzo Von Matterhorn`, marcar `[x]`. Em caso de dúvida (ex.: dentro de comando shell, JSON, YAML): **catalogar separadamente em 4.9.4**, não substituir.

- [ ] `Docs/fase-6-roadmap.md` (1 hit)
- [ ] `Docs/INDEX.md` (1)
- [ ] `Docs/sprint7-manual.md` (2 — incluindo 1 dentro de path; só prose)
- [ ] `Docs/sessions/conversa-29-04-analise.md` (1)
- [ ] `Docs/sessions/sprint7-smoke-2026-05-01.md` (2 — ambos dentro de paths; ficam pra 4.9.3)
- [ ] `Docs/sessions/barney-code-hardening-2026-05-02.md` (7)
- [ ] `Docs/sessions/robin-code-followup-2026-05-02.md` (10 + 1 full name)
- [ ] `Docs/sessions/legal-analysis-marshall-2026-05-02.md` (43 + 1 full name)

#### 4.9.3 — Personal Windows paths (genericizar)

`C:\Users\Eduardo\...` revela home directory de Windows. Genericizar pra placeholder portável (ex.: `<DRIFT_ROOT>`, `~/drift`, `%USERPROFILE%\Drift`). Validar comando substituído ainda funciona como instrução pro leitor.

- [ ] `Docs/sprint7-manual.md` linha ~84 — `cd C:\Users\Eduardo\Workspace-vscode\Drift`
- [ ] `Docs/sessions/sprint7-smoke-2026-05-01.md` ~137-138 — pcapng filenames
- [ ] `Docs/legal-todo.md` linha 133 — referência interna ao próprio padrão (mantém literal — é a string sendo procurada)

#### 4.9.4 — Casos ambíguos (refator pode quebrar)

Vazio hoje. Adicionar aqui durante 4.9.2 se aparecer Eduardo dentro de:
- HEREDOC, multiline string, JSON value
- Comando shell que executa em CI
- Script Python/Node consumido por integração
- Anchor de comentário referenciado por outro arquivo

Pra cada: descrever local + porquê é ambíguo + decisão (manter / migrar com refactor maior).

#### 4.9.5 — Hardening processual (após 4.9.2 completo)

- [ ] Pre-commit hook que rejeita commits com `\bEduardo\b` em arquivos não-binários (`.git/hooks/pre-commit` ou via [pre-commit framework](https://pre-commit.com))
- [ ] CI check no `tests/no-pii.test.ts` (Barney style — falha CI se PII reaparecer)
- [ ] Documentar pseudônimo + postura em `CONTRIBUTING.md` (já existe, validar cross-link explícito)

**Custo total:** ~4-8h distribuídas (case-by-case 4.9.2) + 1h hook (4.9.5).
**Risco reduzido:** reduz "easy targeting" via grep público; protege contra PII regressar em PRs futuros.
**Quem:** solo.
**Gatilho:** imediato pra 4.9.2 prose; paths e EduardoFerr aguardam dependências.

---

## 🔴 MÉDIO PRAZO — ano+, exige co-maintainers ou entidade

### 4.10 — Recrutar 2+ co-maintainers ativos ⭐⭐ **prioridade máxima de continuidade**
- [ ] Publicar `Docs/maintainership.md` (Robin entregou esboço em `sessions/robin-code-followup-*`)
- [ ] Critérios objetivos: ≥10 PRs merged, ≥6 meses, ≥3 reviews substantivos, pubkey estável
- [ ] Schema `.maintainers.yaml` v1
- [ ] Marcar issues "good first issue" e "help wanted"
- [ ] Responder PRs em ≤7 dias pra construir trust
- [ ] Quando ≥1 candidato: trial period 3 meses com merge rights limitados
- [ ] Quando 2+ ativos: ativar 2-de-3 multi-sig de tags

**Custo:** tempo (6-18 meses realistas pra construir trust). R$ 0 direto.
**Risco reduzido:** **maior redutor de risco do roteiro inteiro.** Mantenedor deixa de ser SPOF.
**Quem:** requer terceiros — **trust não acelera por vontade**.
**Gatilho:** ativo desde já.

### 4.11 — Entidade jurídica
- [ ] Avaliar opções:
  - [ ] Associação civil sem fins lucrativos brasileira ("Associação Drift Protocol") — R$ 5-15k setup
  - [ ] Stichting holandesa (foundation NL) — ~R$ 30-50k setup, R$ 5-15k/ano
  - [ ] Verein suíço — ~R$ 40-100k setup
  - [ ] Wyoming LLC (US) — ~R$ 3-10k setup, mas dev BR continua responsável no BR
- [ ] Decisão informada por 4.6 (consulta advogado)
- [ ] Setup formal (precisa contador + advogado)
- [ ] Transferir trademark/domain pra entidade (se houver)

**Custo:** R$ 5-100k dependendo opção.
**Risco reduzido:** separa PF do projeto formalmente; cria interlocutor jurídico que não é Lorenzo Von Matterhorn.
**Quem:** exige advogado contábil + maintainers múltiplos (4.10 primeiro).
**Gatilho:** **só se** primeiro de:
- 10k MAU
- primeira notificação extrajudicial Art. 21
- doação recebida >R$ 5k
- 2+ co-maintainers ativos
- PL 2630 (ou sucessor com KYC) em regime de urgência

**Caveat:** entidade brasileira tem dever de cooperação maior que PF; pode aumentar exposição se mal estruturada. Stichting NL tem precedente de uso pra projetos FOSS sensíveis.

### 4.12 — Distribuição PWA federada em ≥2 jurisdições
- [ ] Vercel (US) — atual ✓
- [ ] Cloudflare Pages (US/global) ou Fastly Compute@Edge
- [ ] Hosting EU/CH com posturas pró-FOSS:
  - [ ] Hetzner (DE)
  - [ ] Infomaniak (CH)
  - [ ] Codeberg Pages (DE) — bom alinhamento mas limites de banda
- [ ] Documentar em `Docs/continuity.md` como mirrors equivalentes
- [ ] CI: deploy automático pros 3 hosts em cada release

**Custo:** 8-16h setup + custos de hosting variáveis.
**Risco reduzido:** ordem judicial brasileira pra "bloquear o Drift" não tem alvo único.
**Quem:** solo viável tecnicamente.
**Gatilho:** após 🟢 + 🟡.

### 4.13 — Dead-man's switch técnico (engenharia, não teatro)
Robin entregou design completo em `sessions/robin-code-followup-2026-05-02.md`. Implementação:
- [ ] tlock release credentials via drand mainnet (chain hash quicknet)
  - chaves de assinatura armazenadas com time-lock 6 meses
  - cada release tagging renova o lock
  - se Lorenzo Von Matterhorn não renovar por 6 meses → chaves descriptografáveis pelos co-maintainers
- [ ] OpenTimestamps de cada tag git (Bitcoin chain) — `ots stamp`
- [ ] Mirrors auto-atualizados em conta neutra (não vinculada a Lorenzo Von Matterhorn)
- [ ] Workflow de sanity check: failed → email pros co-maintainers + abre issue
- [ ] DNS de fallback em registrar pró-privacidade (Njalla)
- [ ] Script `scripts/dms-refresh.sh` (Robin já entregou) — rodar a cada release
- [ ] Doc operacional `Docs/dms-runbook.md` pros co-maintainers

**Custo:** 30-60h dev. R$ 200-500/ano (DNS + tlock fees).
**Risco reduzido:** projeto tem autonomia operacional independente de qualquer indivíduo.
**Quem:** **requer 4.10 primeiro** — sem co-maintainer recipiente, DMS é teatro.
**Gatilho:** simultâneo a 4.10.

---

## ⚪ REACTIVE — só com gatilho concreto

### 4.14 — Resposta a notificação extrajudicial
- [ ] **Não responder direto.** Encaminhar pra triagem ITS-Rio/InternetLab gratuita
- [ ] Publicar a notificação em `Docs/legal/<data>-notif.md` (com PII de terceiros redigida) — transparência
- [ ] Atualizar `Docs/legal/README.md` com case status

### 4.15 — Resposta a ordem judicial
- [ ] **Imediatamente:** contratar representação específica. **Não** responder cru.
- [ ] Avaliar cumprimento parcial possível (ex.: tirar PWA da Vercel sob domínio principal mantém spec + binários + mirrors)
- [ ] Documentar publicamente o cumprimento e seus limites

### 4.16 — Resposta a notitia criminis ou indiciamento
- [ ] **Pausar pessoalmente toda comunicação pública sobre o caso**
- [ ] Co-maintainers ativos continuam operando — daí urgência de 4.10
- [ ] Considerar §6 (saída temporária) — vide Marshall §recomendação fora de software

---

## TOP 3 holy grail — reduz risco SEM aumentar responsabilidade

1. **Mirrors automáticos** (4.1, 4.2). Custo trivial; derruba o argumento "Lorenzo Von Matterhorn controla a distribuição" automaticamente.
2. **Caixa postal jurídica + política de não-resposta** (4.4 + 4.8). Profissionaliza interface jurídica sem aumentar dever.
3. **Consulta preventiva advogado(a)** (4.6). R$ 1.5-3.5k é o melhor ROI defensivo do roteiro.

## TOP 3 continuidade — Drift sobrevive a Lorenzo Von Matterhorn

1. **2+ co-maintainers + 2-de-3 multi-sig** (4.10). Maior redutor de SPOF.
2. **Build reproduzível em todas as plataformas** (4.7). Combinado com mirrors, qualquer fork produz release legítima.
3. **Dead-man's switch técnico real** (4.13). tlock + OpenTimestamps + mirrors automáticos + DNS fallback.

## TOP 3 gatilhos — early warning signs

1. **PL 2630 (ou sucessor com KYC) em regime de urgência ou plenário** → ativar 4.11 (entidade jurídica em jurisdição amigável)
2. **STF firma tese ampliativa em RE 1.037.396 (tema 987)** → barreira Art. 19 desce; acelerar 4.10
3. **Caso público de uso por agente politicamente saliente + noticiamento midiático** → acelerar 🟢/🟡 pra ontem; pausa pública de comunicação pessoal sobre o projeto

---

## Recomendação fora de software/processo

Se penalidade chegar — Marshall em modo *"This is going to hurt, buddy"*:

- **Notificação extrajudicial:** silêncio público; resposta exclusivamente via advogado(a); transparência institucional via `Docs/legal/`. Não argumentar pessoalmente nem em redes sociais.
- **Indiciamento:** representação imediata por advogado(a) criminal especializado(a) em direito digital, idealmente com experiência em STF. Custo R$ 30-100k inquérito; R$ 100-400k ação penal completa. Não dar entrevista, não postar nada técnico, não tentar "explicar" o projeto.
- **Prisão preventiva ou ameaça crível:** considerar saída temporária do país (Mercosul + Schengen + países amigáveis: NL, PT, DE, EE, CH). Não é fuga — é proteção legítima até due process. Honesto: destrói vida pessoal por anos.
- **Penalidade efetiva:** continuar lutando via recursos. Drift sob 4.10 + 4.13 continua sem Lorenzo Von Matterhorn. **A vitória estratégica é o projeto sobreviver, não o indivíduo sobreviver pessoalmente integralmente** — esse é o constraint vinculante.

Detalhes em `Docs/sessions/legal-analysis-marshall-2026-05-02.md` §6.

---

*Próxima revisão recomendada: trimestral, ou quando qualquer item 🔴 fechar, ou quando qualquer gatilho ⚪ disparar.*
