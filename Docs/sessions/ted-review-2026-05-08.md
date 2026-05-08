# Ted review — 4 entregáveis paralelos 2026-05-08

**Persona:** Ted (arquitetura, padrões, camadas, abstrações, Rust + CI)
**Escopo:** review crítico de Marshall (CI Tauri matrix), Lily (Track C debt scoping), Barney (WebRTC audit), Robin (RFC event handler registry).
**Não-escopo:** mudar código dos outros agentes; commit; ampliar análise pra fora dos 4 docs.

Resultado sumário: **2 GO · 2 GO com ressalvas · 0 NO-GO**.

---

## §1 — Marshall · CI Tauri multi-plataforma

**Veredito: GO com ressalvas.** Lacuna real (PR-time validation cross-OS) bem identificada e o trade `cargo check` ≪ bundle full é o ponto certo no espectro custo/benefício. Workflow está limpo, segue o estilo dos vizinhos.

**Pontos fortes**
- Diagnóstico correto: `tauri-distribution.yml` cobria 3 OS mas só em tag — feedback chega tarde demais. Workflow novo fecha o loop sem duplicar custo.
- Path filter `src-tauri/**` evita onerar PR frontend-only — decisão adulta sobre orçamento de minutos GHA (mac runners 10x).
- `fail-fast: false` + `--locked` + bundled `libsqlite3-sys` + NSIS herdado mostram que o autor leu os outros workflows antes de escrever esse — não é cargo cult.

**Concerns**
- Job `summary` com `if: always()` e `needs.check.result` num matrix não funciona como o autor parece esperar: `needs.<job>.result` em job de matrix devolve `success` só se TODOS passaram, mas `if: always()` mascara isso e o `exit 1` dispara mesmo em cancelamentos legítimos. Sugestão: trocar por `needs.check.result == 'failure'` explícito, ou simplesmente apagar o job summary (o status do `check` já bloqueia merge via branch protection).
- Sem smoke real do workflow (item 2-3 do checklist). Risco médio: no primeiro PR-de-teste, cache cold pode ser >4min em Windows (item 144 estima "4-6min" mas NTFS + arti pode estourar timeout se algum sub-crate compilar serial). Mitigação: rodar `workflow_dispatch` em branch de teste **antes** de mergear esse próprio workflow.
- Falta um ponto explícito sobre `Cargo.lock`: paths filter inclui `src-tauri/**` (pega o lockfile, OK) mas mudança de toolchain (`rust-toolchain.toml` se vier um dia) não dispara. Anotar como follow-up baixo.
- "Atualizar CLAUDE.md depois do primeiro green run" (item 6) é honesto mas vai virar dívida — quem lembra? Sugestão: criar issue/TODO datado ou colocar nota em `Docs/sessions/track-a-followups.md`.
- Concurrency group `tauri-cross-check-${{ github.ref }}` cancela in-progress — bom em PR mas em push pra main pode matar build em curso quando dois merges caem juntos. Aceitável (próximo push roda de novo) mas vale comentar.

**Próximo passo**
Mergear como está + abrir PR-de-teste minúsculo (comment em `src-tauri/src/tor.rs`) pra validar matriz cold. Após primeiro green: atualizar CLAUDE.md "Filosofia (resumo)" linha §17. Owner: Marshall ou Arquiteto direto (15min).

---

## §2 — Lily · Track C debt scoping

**Veredito: GO.** Auditoria honesta, classificação de severidade com critério, e a recomendação de "não execute B-latentes sem repro" mostra disciplina (não é todo agente que segura essa onda).

**Pontos fortes**
- Tabela quantitativa com estimativas por arquivo cria orçamento real, não wish-list. Total ~290min cabe no cap de 5h declarado — números batem.
- Separação P0/P1/P2 com critério explícito ("bug que afeta usuário hoje" vs "polish" vs "cleanup") + bucket "investigar" pra coisas que ela não tem repro confiável. **Esse bucket é a parte mais valiosa do doc** — evita o anti-padrão de "achei algo estranho, vou consertar".
- CC-B2 (overrideHidden ambíguo entre moderation e CW) é achado real e crítico — exposição de conteúdo moderado é regressão de manifesto §26. Boa pegada.

**Concerns**
- CM-B2 ("cap descarta cauda") é classificado P0 mas a investigação está incompleta: o comentário do código admite tradeoff deliberado pra preservar ordering. Antes de mexer, vale ler o git blame e o PR original — mudança de política aqui pode reintroduzir bug que motivou o cap. Recomendo rebaixar CM-B2 a "investigar" no executor real.
- TH-B1 (botão "+N novos" dead) é GO mas o "fix" sugerido (wire `onRefreshNew`) é uma feature, não cleanup — 20min é otimista se exigir reset de `openedAt` + interação com cursor. Realista: 40-60min com testes. Considerar esconder o botão (5min) como fix interim e abrir issue separada pra implementação.
- CC-B1 (selector ausente) é real mas o impacto descrito ("render thrash em ThreadView ativo") precisaria de medição — pode ser invisível na prática. P0 me parece otimista; rebaixar a P1.
- Nenhum dos 32 itens toca `events.ts` / `protocol.ts` / `scoring.ts` — bom (manifesto-safe), mas significa que esse trabalho **não destrava** nada de Fase 6/7. É manutenção pura pós-merge Track C; não confundir com investimento estratégico.
- Estimativa "3-5h" com 3h45 de trabalho identificado + 15-30min buffer deixa margem fina pra o que sempre acontece (descobrir 1 bug colateral durante fix de outro). Realista: planejar 4-5 sessões de 1h em vez de 1 sessão de 5h.

**Próximo passo**
Sessão de execução em **2 partes**: (a) P0 reduzido — CC-B2 + RS-B2 + TH-B1 esconder + CC-B1 — em ~1h, sem CM-B2 até investigar git history; (b) P1 + quick-wins P2 em sessão separada. Owner: Lily.

---

## §3 — Barney · WebRTC architecture audit

**Veredito: GO.** Audit é o melhor dos 4 docs em densidade técnica. Bugs P0 são reais (B1/B2/B3 todos têm caminho de repro mental claro), threat surface T1/T2 são acertos (não é paranoia). Veredito "sane and ship-able" é calibrado — não rewrite, não cosmético, refactor focado.

**Pontos fortes**
- B1 (timer setTimeout 5s sem handle), B2 (reconnect race com peer já open), B3 (ICE timeout não-cancelado em cleanup) são todos repro mental claro com fix de 3-10 linhas. Custo/benefício excelente.
- T1 (cross-proto counter monotônico = atacante paciente vence) é insight não-óbvio — exatamente o tipo de coisa que escapa de revisão funcional e só threat-modeling pega.
- S1 (state machine sem guard) e S5 (peer policy não-unificada) identificam dívida estrutural real, com fix proporcional (`setPeerStatus` + lifecycle hooks, não rewrite).

**Concerns**
- S3 (event bus pra eliminar 3 lazy imports) é proposto P2 com hedge "opcional" — concordo com o hedge mas o doc deveria ser **mais firme**: introduzir EventTarget/mitt num módulo já com 6 fontes de mutação de state piora cognitive load no curto prazo. Recomendo NO-GO em S3 isolado; só GO se feito junto com S5 numa única refatoração.
- T3 (Date.now() unprotected) está corretamente marcado out-of-scope mas merece um **comment in-code** em `rateLimit.ts:46` declarando isso. Caso contrário próximo auditor vai re-descobrir.
- Owner sugerido = Lily com co-revisão Marshall. **Discordo parcialmente:** B1/B2/B3 são timer state machine = Lily, OK. Mas T1/T2 são threat model — quem deveria fechar é Barney (segurança) ou Ted (arquitetura), não delegar pro mesmo dev de manutenção que pode não ter o mindset adversarial. Sugestão: split — Lily faz B1+B2+B3+S1+S5; Barney/Ted fecham T1+T2 separado.
- Estimativa "½ dia P0" é otimista se incluir tests. P0 sem test = manutenção fútil (regression vai voltar). Realista: 1 dia P0 (5 fixes + 5 testes Vitest novos cobrindo race scenarios). Doc não menciona tests pra P0 — gap.
- O audit não toca em **§15 Tor unified policy layer** (mencionado de passagem em §4 owner). Isso é feature do manifesto, não bug — mas dado que Fase 6 vai unificar Tor + WebRTC numa policy layer, vale alinhar timing: fazer P1 (S1/S5) **antes** ou **junto com** essa unificação, senão o refactor é jogado fora.

**Próximo passo**
Abrir 5 issues separadas (B1, B2, B3, T1, T2) cada uma com fix + test; tag P0; assignar Lily (B1-B3) e Barney/Ted (T1-T2). S1+S5 viram um ADR de "peer state machine + lifecycle hooks" com escopo definido antes de Fase 7. Owner global: Lily, mas com governance compartilhada nos threat items.

---

## §4 — Robin · RFC event handler registry

**Veredito: GO com ressalvas (mais hedged que a recomendação original do Robin).** RFC é honesta — a seção §7 já admite "no-go retroativo se kinds congelarem" e §5 Alt A "switch escala fine até 8-10 kinds". O problema é que Robin recomenda "GO condicional" e a condição (kind 9082 confirmado) ainda não está confirmada no roadmap.

**Pontos fortes**
- Diagnóstico do problema real (dois switches paralelos: `passesSchemaCheck` + dispatcher principal) é o insight central e está certo. O risco de drift entre os dois é o que justifica refactor — não a quantidade de kinds.
- Strangler pattern em 7 PRs com branch híbrido é a mecânica certa pra arquivo crítico. Revert pontual + CI verde contínuo é disciplina.
- §3 (invariantes mantidas) é rigoroso: mostra que `setPeerStatus`-style discipline preserva conformance test, ordem do pipeline, debounce. Alt C corretamente rejeitada com argumento de invariante #1.

**Concerns**
- **Recomendação real deveria ser "NO-GO até 9082 ser commitado no roadmap".** O argumento técnico mais forte é eliminar o drift entre os 2 switches — esse problema **existe hoje** com 5 kinds e existirá com 6. Mas o ROI de 6h de strangler com 7 PRs pra resolver drift entre 2 switches é dúbio se não houver kind novo entrando. Existe um fix mais barato: extrair `passesSchemaCheck` e o switch persist pra **um único objeto literal `KIND_DISPATCH = { 9078: { schema, persist }, ... }`** sem registry pattern (sem `register()`, sem Map mutável, sem 30 linhas de tipos genéricos). 1 PR, ~50 linhas, mesmo ganho de "fonte única". Robin não considerou esse middle ground.
- Conformance test trava `src/lib/events.ts` por path literal — Robin trata isso como restrição mas é mais que isso: é **sinal forte** de que o invariante é "tudo num arquivo", não "tudo organizado". Se o problema real é "2 switches paralelos", a solução é colapsar em 1 switch + 1 lookup table, não introduzir indireção genérica.
- Custo do registry: perda do exhaustive switch do TypeScript (Robin admite). O test "todo kind tem handler" é runtime check, mais fraco que compile-time. Pra um dispatcher tão crítico (`onNostrEvent` é a invariante #1), essa troca é desfavorável.
- §7 "Encaixe de fase: Fase 6 ou 7, antes de 9082" é vago — Fase 6 está em curso (6.4 etapas 1-4 shipped). Se Robin acha que cabe em Fase 6, vale `cargo`/`tsc` check de quanto disponibilidade Lily tem pra mais 6h em Fase 6 (resposta pelo audit Barney: ela já vai gastar 1 dia em P0+P1 WebRTC). RFC sem owner com tempo livre vira doc-no-diretório.
- Robin lista personas inputs ("Ted, Marshall, Lily") no header — concorda com convenção do CLAUDE.md de não atribuir nomes a revisões que ainda não aconteceram. Trocar por `[revisão: arquitetura/conformance/runtime]`.

**Próximo passo**
Decidir status do kind 9082 **primeiro** (decisão produto / Fase 6 vs Fase 7). Se 9082 confirmado <3 meses: GO no registry junto com 9082 (Robin tem razão nesse cenário). Se 9082 incerto/longe: **NO-GO no registry, GO num refactor mínimo**: colapsar `passesSchemaCheck` + switch persist em 1 lookup table `KIND_DISPATCH` (1 PR, 50 LOC, sem registry pattern). Owner do refactor mínimo: Marshall (conformance/types).

---

## §5 — Sequenciamento recomendado

Ordem de ataque nas próximas 2-4 semanas, considerando dependências, ROI e risco de "doc no diretório":

**1. Marshall (CI Tauri matrix) — agora.**
   Custo zero pra mergear (workflow novo, sem mudar código), bloqueia regressão Windows/macOS de §15. Se ficar parado, próximo PR Tauri vai quebrar mac/win silenciosamente. Mergear + smoke PR-de-teste em 1-2 dias.

**2. Barney P0 (B1+B2+B3) — em paralelo com #1.**
   Bugs concretos com fix curto. Pré-requisito implícito de qualquer trabalho Fase 7 que escale tráfego WebRTC. Owner: Lily, com 5 testes Vitest. ~1 dia.

**3. Lily P0 reduzido (CC-B2 + RS-B2 + TH-B1-hide + CC-B1) — semana seguinte.**
   Sem CM-B2 até investigar git blame. ~2h. Não bloqueia outras fases mas é manutenção honesta do que foi merged em Track C.

**4. Barney T1+T2 (threat surface) — pré-Fase 7.**
   Owner: Barney/Ted (não Lily). ~½ dia. Antes de qualquer escalada de open peer count.

**5. Lily P1 + quick-wins P2 — sessão de 1h ad-hoc.**
   Não-bloqueante. Quando houver janela.

**6. Robin RFC — diferido até decisão sobre 9082.**
   Se 9082 confirma <3 meses: GO registry junto com 9082 PR. Senão: refactor mínimo `KIND_DISPATCH` (Marshall, ~2h) e arquivar a RFC com nota "no-go retroativo: kinds congelaram em 5".

**7. Barney P1 (S1 setPeerStatus, S5 lifecycle hooks) — pré-Fase 7 unified policy layer.**
   Fazer **junto com** ou **logo antes da** unificação Tor+WebRTC, senão o refactor é jogado fora.

Linha única: **Marshall → Barney P0 → Lily P0-reduzido → Barney T1/T2 → (Robin diferido) → Barney P1 pré-§15-unified**.

---

## §6 — Riscos cross-cutting

Coisas que aparecem ao colocar os 4 docs lado a lado e não foram escopo individual de nenhum:

**R1 — "Manutenção honesta" vs "investimento estratégico" estão competindo pelo mesmo executor.**
Lily aparece como owner em 3 dos 4 trabalhos (Track C debt, WebRTC P0, eventualmente RFC migration). Soma realista: 4-6 dias de Lily em manutenção/refactor antes de qualquer feature nova. Risco: Fase 6 estagna em "estamos consertando débito" enquanto §15/§16/§17 (compromissos de manifesto pendentes) ficam parados. Mitigação: Arquiteto explicitar quanto de Lily-time vai pra cada balde por semana.

**R2 — Conformance test por path literal está virando restrição de design implícita.**
Robin esbarrou nele (Alt C rejeitada por path-lock). Barney indiretamente (M2 menciona Sprint N comments). É bom que ele exista (invariante #1 forte) mas a regra "tudo em events.ts" começa a empurrar arquivos pra 800+ LOC. Vale considerar: o conformance test deveria validar **invariante semântico** ("INSERT em domínio só em arquivos X, Y, Z whitelist explícita") em vez de path único? Ainda forte, mais flexível. Não fazer agora, mas registrar como ADR pendente.

**R3 — Threat surface compartilhada entre WebRTC e futuros transportes.**
Barney T1 (cross-proto counter monotônico) e T2 (ping/pong sem 1:1 binding) são padrões que vão repetir em Tor transport, em qualquer transport peer-to-peer. Se cada transport reimplementa rate limit + health check, será 3x o trabalho e 3x o risco de bug. Sinal de que precisa de uma `transport/policy/` shared layer **antes** de Fase 6.4 etapa 5+ (Tor production). Não está em nenhum dos 4 docs.

**R4 — Tests do tipo "ordering invariant" são gap geral, não só pipeline WebRTC.**
Barney S4 propõe test de ordem das 6 etapas do pipeline WebRTC. Robin §3 propõe test "validateSchema sem await". Ambos são "lock semântico contra regressão futura" — pattern que já existe em `manifesto-conformance.test.ts` mas só pra path literal e regex. Vale generalizar: lib `tests/lib/orderingInvariant.ts` que ambos usam. Não urgente, mas tem cheiro de "vamos criar 3 versões parecidas independentes" se ninguém centralizar.

**R5 — §15 anti-censura por país está sendo entregue por capacidades técnicas dispersas (Tor + WebRTC + Multi-transport orchestration), mas sem owner de "experiência §15 end-to-end".**
Marshall protege §15 build-side (cross-platform check). Barney protege §15 runtime-side (WebRTC sane). Mas ninguém está testando o **fluxo completo** "user em país censurado abre cliente Tauri → Tor handshake → WebRTC fallback se WSS bloqueado → consegue postar?". É integração e2e que precisa setup específico (network namespace, censor simulator). Sem isso, vamos descobrir gap só quando user real tentar — risco político alto pro manifesto. Não cabe nos 4 trabalhos atuais, mas cabe abrir como Track explícito (Barney ou Ted próximo ciclo).

---

*Ted · 2026-05-08 · 2 GO · 2 GO-com-ressalvas · 0 NO-GO · sequência: Marshall → Barney P0 → Lily P0 → Barney T1/T2 → Robin diferido → Barney P1*
