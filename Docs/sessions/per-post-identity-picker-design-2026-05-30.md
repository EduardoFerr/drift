# Design — Per-post identity picker (compartimentalização §4)

Deliberação Satoshi 2026-05-30. Privacidade = escolha do user, nunca imposição
(§17/§25). Duas alavancas no create: (a) granularidade de location (JÁ per-post,
GpsScopeButton), (b) **QUAL id publica** — ESTE é o propósito do multi-id (§4) e
hoje FALTA.

## Problema
`ComposeOverlay` publica em silêncio como `active_identity`. Não mostra nem deixa
escolher qual id assina o post. Multi-id (§4) existe mas é inútil no momento crítico
de privacidade. Trocar id ativo exige `location.reload()` (invariante #15) — inviável
por-post.

## Insight-chave: sem reload
Reload (invariante #15) existe pra **resetar estado** (sync subs + feed/stores presos
ao id ativo), NÃO pra validar/carregar chave (instantâneo em memória). Logo: assinar
UM post com um id escolhido **não troca o ativo** → nada pra resetar → **zero reload**.
Só empresta a chave pra 1 assinatura.

## Design
- **`signDriftEvent(input, opts?)`** ganha `opts.signWithNpub?: string`. Quando presente,
  busca `identities.nsec_encrypted` desse npub, decripta em memória (crypto.ts:decrypt),
  assina com essa chave. Ausente → comportamento atual (active id) inalterado.
- **`getIdentitySecretKey(npub)`** (NOVO em `identities.ts`): lê `nsec_encrypted` da
  tabela `identities`, decripta → bytes. Espelha o decrypt de `getOrCreateIdentity` mas
  pra npub arbitrário do user. NUNCA loga, nunca persiste em claro (§8). Zeroizar bytes
  após assinar se viável.
- **`createPost(input, opts?)`** repassa `signWithNpub` → signDriftEvent.
- **ComposeOverlay**: seletor de id no header (perto do GpsScopeButton). Default = id
  ativo; dropdown lista identidades do user (`useIdentitiesStore`/tabela). Estado
  **per-compose** (como gpsScope), não persistido, reseta pro ativo no próximo compose.
- Publicar como id-B com sessão em id-A: post sai nos relays como id-B; `onNostrEvent`
  ingere (author-agnostic, invariante #1 não distingue autor); aparece no global; em
  "Seguindo" só se id-A seguir id-B. Sessão (sync/feed/lens) intocada. Sem reload.

## Segurança (revisão Barney OBRIGATÓRIA antes de implementar)
- nsec decriptado SÓ em memória, no ato de assinar (§8). Sem log, sem persistência clara.
  Mesma superfície de chave que `setActiveIdentity` já usa — não cria exposição nova.
- **Risco de deanon acidental:** postar do id "real" achando que era anônimo. Mitigação:
  default SEMPRE = ativo; trocar exige ação explícita; UI mostra GRANDE/claro qual id vai
  postar; se location anexada + id ≠ ativo, micro-warning. UI é a defesa central aqui.
- §28: location e id são escolhas independentes, ambas no create. Não acoplar.

## Edge cases
- 1 só identidade → seletor oculto/no-op (comportamento atual).
- Anônimo/sem identidades → n/a.
- Optimistic UI: post otimista exibe sob o id escolhido (não o ativo).

## Invariantes
- **#15 intacto:** não troca `active_identity`; sem reload.
- **#1:** post entra via onNostrEvent normal (autor qualquer).
- **#8:** nsec nunca em claro fora do ato de assinar.
- **§4:** compartimentalização = propósito do multi-id, agora utilizável.

## Testes
- unit: `signDriftEvent({signWithNpub})` → evento assinado com pubkey = id escolhido
  (mock identities+crypto). Default sem opts → active id (regressão).
- unit: `getIdentitySecretKey(npub)` decripta correto; npub inexistente → throw claro.
- unit: `createPost` repassa signWithNpub.
- conformance §8: grep — nsec/secret nunca em console.log/persist claro no caminho novo.
- Compose: seletor presente, default ativo, estado per-compose reseta.
- E2E/MCP (regra dura #3): postar como id-B de sessão id-A → event.pubkey = id-B, SEM
  reload, post no global. Vizinhos: feed/sync seguem no id-A (não migram).

## Arquivos
- `src/lib/identities.ts` — `getIdentitySecretKey(npub)`.
- `src/lib/nostr.ts` — `signDriftEvent` opt `signWithNpub`.
- `src/lib/protocol.ts` — `createPost` opt.
- `src/components/Create/ComposeOverlay.tsx` — seletor + estado per-compose.
- `src/components/Create/IdentityPickerButton.tsx` (NOVO, espelha GpsScopeButton) — popover.

## Docs a atualizar (regra dura #2)
CLAUDE.md (invariante #15 — nota: per-post sign não troca ativo, sem reload),
guia-do-usuario (escolher id ao postar), este doc.

## NO-GOs
- trocar active_identity no per-post (forçaria reload + bagunça pipeline #15).
- persistir o id escolhido como novo default (é per-compose; default sempre = ativo, anti-deanon).
- decriptar nsec fora do ato de assinar / logar nsec (§8).

## Barney security review (2026-05-30) — GO-WITH-MITIGATIONS

Veredito: arquitetura sólida, insight "sem reload" confirmado contra o código,
superfície de decrypt aceitável (até MENOR que o cache do ativo) — DESDE QUE sem
cache. Mas a spec sub-especificava exatamente as partes que causam deanon
irreversível. **6 must-haves (blockers se ausentes):**

1. **`getIdentitySecretKey`:** SEM cache (decrypt→sign→drop na mesma scope; cachear
   = N nsecs residentes = blast radius maior). Assertar `getPublicKey(bytes) === npub`
   ANTES de retornar (throw on mismatch — senão assina sob pubkey que o user NÃO viu =
   deanon silencioso; cobre além do "npub inexistente"). Mensagem de erro contém SÓ o
   npub (público) — NUNCA bytes/ciphertext/hex (App.tsx:~1040 mostra `err.message` na UI).
2. **`bytes.fill(0)`** após `finalizeEvent` (JS não garante zeroização de string, mas
   limpar o Uint8Array é honesto e barato).
3. **Id assinante VISÍVEL e persistente no corpo do compose** (identicon + label/npub-curto
   ao lado do `publicar ↑`), NÃO colapsado em ícone estilo GpsScopeButton. GPS errado vaza
   cidade; id errado **funde 2 personas irreversível na rede** — classe de risco diferente.
   Id ≠ ativo → estado visual distinto AMBIENTE (cor/borda no chrome do compose). label pode
   ser null → usar identicon+npub-curto.
4. **Confirm DURO** (não micro-warning) quando `gpsScope !== 'off'` E `signWithNpub !== ativo`:
   "Postar como «X» COM localização precisa?" — GPS preciso em persona pseudônima = deanon
   clássico. Mitigação de maior valor da feature.
5. **`signWithNpub` capturado SÍNCRONO no topo de `handlePublish`** (antes de qualquer
   await), threaded como ARG explícito via onPublish→createPost→signDriftEvent. signDriftEvent
   NUNCA relê store/ref (evita race de picker stale assinar chave errada). Igual `gpsScope` já é.
6. **Disclaimer honesto de correlação na rede** (guia-do-usuário + nota one-time UI):
   "postar ids diferentes da MESMA sessão pode ligá-los pra quem observa (mesmo IP/relays/
   timing/WebSocket). Compartimentalização forte (Tor) = Fase 6." Inerente ao transport WSS,
   NÃO mitigado aqui — mas o picker faz o user ACREDITAR que está compartimentado → §28 exige
   dizer a verdade. **Gate de doc duro.**

Nice-to-have: decidir conscientemente `isMine` (App.tsx:~1385) pra post próprio sob id
não-ativo (hoje renderiza como não-meu — talvez correto pra compartimentalização).

## Sequência (com mitigações Barney)
1. `getIdentitySecretKey(npub)` — SEM cache + assert pubkey===npub + erro npub-only + unit.
2. `signDriftEvent({signWithNpub})` — bytes.fill(0) pós-sign + unit (+ regressão default ativo).
3. `createPost` opt signWithNpub (arg explícito, threaded).
4. ComposeOverlay: seletor persistente no corpo (identicon+label) + estado ambiente quando ≠ativo
   + captura síncrona em handlePublish + IdentityPickerButton (popover).
5. Confirm duro location+id≠ativo.
6. Disclaimer correlação (guia + nota one-time) + §28.
7. Barney re-review (must-haves presentes) + E2E/MCP + docs (CLAUDE.md #15 nota, guia).
