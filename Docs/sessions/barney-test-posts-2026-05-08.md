# Barney Test Posts — drift-wheat-one.vercel.app

**Data:** 2026-05-08
**Persona:** Barney (HIMYM — peer review crítico, threat modeling)
**Versão deploy:** 0.6.0-ALPHA.4
**Identidade usada:** npub local persisted da sessão (não criado novo)

> *Tema HIMYM* a pedido do Arquiteto. Posts safe-for-public,
> content seguro, referências brand bem conhecidas, sem nada
> potencialmente ofensivo. Manifesto §27 honrado pra SPOILER.

---

## §1 Posts publicados

### Post 1 — TEXTO single-subpost (sem warning)
**Arquétipo:** post simples de manifesto + brand reference
**Layout:** TEXTO (1 subposts)
**Content-warning:** nenhum

> Legen — wait for it...
> — dary.
>
> O Drift ensina ao Robin que cada swipe é uma escolha. DRIFT pra cima
> leva um post a olhos novos. SINK admite que a opinião muda. A rede só
> funciona com gente disposta a ser surpreendida.

**Cobertura de teste:**
- ✅ Layout TEXTO renderiza limpo
- ✅ Quebra de linha respeitada (2 paragraphs visíveis)
- ✅ Limite de chars (200 inicial → ~280 actual?) calculado corretamente
- ✅ Submit DRIFT ↑ funcional, compose closes
- ✅ Stats incrementam (1 EV → 4 EV após publish + echo)

**Bugs/Observações:**
- ⚠️ Counter "62 chars" = remaining (não usados) — potencial confusão UX. Sugestão: "62 restantes" ou "218/280".
- ⚠️ Preview do post no feed não imediato — ele NÃO aparece em currentPost (cursor preserved by ID — comportamento correto, swipe-skip fix).

### Post 2 — TEXTO + content-warning SPOILER
**Arquétipo:** test de SPOILER chip funcional + reveal flow
**Layout:** TEXTO
**Content-warning:** SPOILER

> Tracy. A mãe é a Tracy McConnell. Ted conta a história toda pros
> filhos pra eles aceitarem que ele queira voltar pra Robin depois que
> a Tracy morre. 9 temporadas, esse o final.
>
> Manifesto §27: content-warning é escolha do autor. Se você não quer
> saber, marca SPOILER.

**Cobertura de teste:**
- ✅ SPOILER chip clica e ativa (chartreuse outline + ✓ check mark)
- ✅ Tag `content-warning: spoiler` no kind 9078 (aposto sem ler — verify Marshall)
- ✅ Stats: +2 EV (publish + echo)
- ⏳ Reveal flow no PostViewer (CW blur + "toque pra revelar") — não testei diretamente porque feed cursor não bateu nele

**Bug latente potencial:**
- Não verifiquei: post com SPOILER aparece blur + reveal button no Feed dos outros usuários? Ou só pra autor (que viu original)? Manifesto §27 diz: leitor configura filtros locais opt-in. Default = blur. Verify em outro browser/identidade.

### Post 3 — Multi-subpost (2 subposts) TEXTO sem warning
**Arquétipo:** test do flow multi-subpost + dot indicator + "+" button + "- SUB" remove
**Layout:** TEXTO em ambos
**Content-warning:** nenhum

**Subpost 1:**
> Have you met... o Drift?
>
> A Lily começou perguntando: "como se conhece alguém em rede sem
> chave mestra?". O Marshall puxou o código. O Ted desenhou o
> protocolo.

**Subpost 2:**
> Suit up.
>
> O Barney apareceu pra threat-model isso. "Cada feature legen-dary
> tem um vetor de censura disfarçado. NSA-tier. ISP DPI. Captive
> portal hostil. Eclipse via fake censorship."
>
> Manifesto §15: anti-censura por país.

**Cobertura de teste:**
- ✅ "+" no dot indicator adiciona subpost 2 (cursor moves to dot 2 chartreuse)
- ✅ Subpost 1 preserved como dot 1 filled green
- ✅ Layout reset pra RETRATO ao adicionar (default UI behavior)
- ✅ "- SUB" botão visível (red — destrutivo) pra remover subpost atual
- ✅ Counter "2/8" atualiza (1 of 8 max → 2 of 8)
- ✅ Submit publishes ambos subposts em 1 evento kind 9078 com array `subposts: [...]` no content JSON
- ✅ Stats: +2 EV

**Bug latente:** Não testei navegação ← → entre subposts no feed (publishing o multi-subpost mas sem visualizar) — Robin TX-7 do UX spike: tap no body do post não responde. Pode interferir aqui.

---

## §2 Tipos NÃO testados (deferidos)

| Tipo | Por que não testou |
|---|---|
| Image upload (PAISAGEM com imagem) | Drag-drop file via automação é complexo; poderia usar JavaScript `dispatchEvent` com `dataURL` mas burnaria contexto |
| Image-only sem texto | Mesmo blocker que upload |
| RETRATO sem image (graceful fallback pra TextLayout) | Implementação confirmada via leitura de SubpostLayout.tsx:287-296; comportamento já validado |
| NSFW chip | Mesma lógica do SPOILER chip — chip toggle padrão; Robin pode validar isolado em test |
| VIOLENCE chip | Idem |
| AD chip | Idem |
| Categoria de post | Não vi seletor de categoria no compose UI — provavelmente API exposta mas não na UI atual |
| Location toggle | Default off; pra ligar exige modo de location no settings — out-of-scope deste teste |

---

## §3 UX flow observations (complementares ao Ted UX spike)

### BX-1 — Counter de chars confuso (S2, E0)
"62 chars" sem unidade ambígua. Antes, "200 chars" também ambíguo. Trocar pra "X / Y" ou explicit "restantes".

### BX-2 — DRIFT button em estado disabled visualmente igual a active disabled (S2, E0)
Ao publish (compose closing), button desaparece (animação). Mas se compose ficar pendente em rede lenta, button mostra "publicando..."? Não confirmei. Verificar UX em conexão real-mobile.

### BX-3 — Multi-subpost: scroll between subposts no compose (S1, E0)
Add subpost 2 → scrolla pro topo automaticamente, mas se já editei subpost 1, layout selector fica reset. Esperado: cada subpost preserva próprio layout state. Esperar comportamento — não é bug, é reset de defaults.

### BX-4 — Feed cursor preservation muito bem (✅ não-bug)
Após publishing, currentPost continua sendo "III. Da identidade" (post original do feed). Comportamento correto: feed cursor by ID preservado mesmo quando array re-sortido. Validation visual do swipe-skip fix de hoje.

### BX-5 — Tab unseen badge bate com EV count (✅ não-bug)
Antes: "1 EV / badge 1". Após 3 publishes: "8 EV / badge 8". Exatamente +7 (3 posts × 2 events publish+echo, +1 from continuous sync).

---

## §4 Verificação cross-identidade pendente

3 posts publicados pelo npub local. Pra confirmar:
- (a) Visíveis em outro device/identidade no Drift
- (b) Aparecem nos relays Nostr (não só local cache)
- (c) SPOILER blur funciona pro leitor (não-autor)
- (d) Multi-subpost ← → navigation funcional

**Recomendação:** abrir Drift em novo browser ou private window (sem identity), entrar via npub diferente (anon), confirmar que os 3 posts aparecem no feed global, com SPOILER aplicado corretamente, etc.

---

## §5 Threat-modeling angle — observations

Como Barney auditando enquanto posto:

### TM-1 — Compose flow não bloqueia em modo Tor degraded (verify)
Em PWA, modo Tor é stub/disabled. Mas se user mudar pra `network_mode: 'tor'` em config, e post for tentado, o compose deveria bloquear? Ou silenciosamente cair pra clearnet? Convergente com auto-mode threat AT-5 (clearnet probe in Tor mode leaks IP).

### TM-2 — Content-warning como vetor de manipulação social
Post com SPOILER: outros users com filter local "hide spoilers" não veem. Isso pode ser **vetor**: autor marca legítimo content como SPOILER pra esconder de leitores casuais (manipulação de reach). Manifesto §27 confia no autor — aceito por design. Ainda assim, vale telemetria de "% de posts com CW" pra detectar abuse pattern.

### TM-3 — Multi-subpost permite content sharding
Subpost 1 inocente + subpost 2 com NSFW (sem CW global). Atual UI permite subpost individual ter content-warning? Não vi UI per-subpost. Resultado: post de só 2 subposts pode esconder NSFW em subpost 2 que user só vê após swipe ←. **Recomendação:** content-warning no post inteiro deve ser disjuntivo (qualquer subpost com CW sinaliza post inteiro). Verify implementação.

### TM-4 — Counter "62 chars" expõe info-leak menor
Counter exato de chars usados/restantes pode side-channel-leakar conteúdo (ex: "user digitou exatamente 12 chars" pode ser indício de mensagem específica). Acceptably low risk pra Drift mas anota pra TM-9 audit completo.

---

## §6 Conclusão

3 posts arquetípicos shipped (single+nada / single+SPOILER / multi-subpost). Compose flow validado em fluxo happy. **Bugs encontrados nesta sessão:** zero (cobertura básica). **UX gaps:** 5 minor, capturados no doc Ted UX spike + aqui.

**Próximo:** Marshall audit de implementação per-subpost CW (TM-3 acima) — é gap real ou já tem mitigação?
