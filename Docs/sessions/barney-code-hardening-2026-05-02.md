# Barney — Code Hardening pós-Marshall legal-2026-05-02

**Persona:** Barney Stinson (LLM, papel: peer review crítico, threat modeling adversarial, security)
**Data:** 2026-05-02
**Input:** [`legal-analysis-marshall-2026-05-02.md`](legal-analysis-marshall-2026-05-02.md)
**Versão analisada:** v0.6.0-alpha.3 / branch `main` (HEAD `56ba721`)
**Tese central:** *"Toda claim sem teste é mentira até prova contrária. Suit up — and verify."*

---

## DISCLAIMER OBRIGATÓRIO

Este documento é **análise adversarial produzida por persona LLM**. Recomendações de hardening e textos de teste são **executáveis**, mas exigem **validação humana** antes de merge — alguns testes propostos dependem de mocks ou conhecimento de implementação que pode estar parcialmente incorreto. Tratar como input de revisão de PR, não como verdade revelada. Onde uma dependência de implementação é incerta, deixei `TODO` explícito no teste em vez de inventar.

A tese subjacente é jurídica-operacional, não doutrinária: **o sistema de testes vira evidência defensiva**. Se Marshall (Finding 1) diz que layer cliente é classificada como "mero conduit" *se* claims forem verificáveis, então tornar PRIVACY.md/SECURITY.md em testes que rodam em CI é **mover defesa de prosa pra prova auditável**. Auditor externo executa `npm test` e confirma cada compromisso público — Art. 19 MCI fica cimentado em código, não em retórica.

---

## a) Audit de claims públicas vs realidade

Esta seção lê PRIVACY.md, SECURITY.md, CLAUDE.md (17 invariantes) e o manifesto, e pra cada compromisso público faz três perguntas: (1) está implementado? (2) é verificável agora, sem rodar app? (3) o que poderia romper isso em refactor futuro sem ninguém perceber?

### Claim 1 — "Sem telemetria. Sem analytics. Sem reports automáticos de erro."

**Citação literal** (`PRIVACY.md` §"Dados que não são processados"):
> "Sem telemetria. Sem analytics. Sem reports automáticos de erro. (`grep` no repositório confirma — invariante derivada de §17.)"

**Verificável hoje?** Parcialmente. A claim *aponta pra* `grep` mas não há `grep` automatizado. Hoje qualquer dev pode adicionar `import * as Sentry from '@sentry/browser'` e o CI passa.

**Gap:** o claim é **literalmente prosa que aponta pra teste que não existe**. Marshall Finding 3 (cenário ANPD): defesa LGPD exige provar que tratamento não acontece. Prosa não é prova.

**Teste proposto:** `tests/no-telemetry.test.ts` (ver Grupo 2). Lê `src/**/*.{ts,tsx}` via `node:fs`, faz regex match contra deny-list de domínios analytics conhecidos + `navigator.sendBeacon` + `fetch` para hosts fora da whitelist. Falha CI se match. **Status:** entregue neste PR.

### Claim 2 — "Sem fingerprinting de usuário entre sessões além do que o navegador expõe naturalmente."

**Citação literal** (`PRIVACY.md`):
> "Sem fingerprinting de usuário entre sessões além do que o navegador expõe naturalmente."

**Verificável hoje?** Não. Não há teste, não há varredura.

**Gap:** APIs como `Canvas.toDataURL()`, `AudioContext`, `WebGLRenderingContext.getParameter(UNMASKED_VENDOR_WEBGL)`, `navigator.userAgentData.getHighEntropyValues()`, `Battery.level`, `getInstalledRelatedApps()` são fingerprinting clássicos. Refactor que adicione qualquer um (ex.: "vamos mostrar GPU vendor pra debugar bug do mapa") quebra a claim silenciosamente.

**Teste proposto:** segunda metade de `tests/no-telemetry.test.ts` faz deny-list de APIs de fingerprinting. **Status:** entregue, deny-list incluída.

### Claim 3 — "nsec NUNCA sai do dispositivo, NUNCA persiste em claro" (CLAUDE.md invariante #8)

**Citação literal** (`CLAUDE.md`):
> "nsec NUNCA sai do dispositivo, NUNCA persiste em claro. Geração local secp256k1, AES-GCM 256, master key não-exportável em IndexedDB separada do OPFS."

**Verificável hoje?** Parcialmente. Existe `src/lib/crypto.ts` + `identity.ts`. Não há teste que prove que `nsec` em hex/bytes nunca aparece em request body de `fetch`/`WebSocket.send`/`localStorage.setItem`/`postMessage` cross-origin.

**Gap principal:** o nsec é manuseado em vários paths (sign, export, import, derive). Um refactor que adicione "envia diagnostic do estado da identity" e acidentalmente serialize o objeto inteiro em JSON quebra a claim. Sem teste, ninguém vê.

**Teste proposto:**
- **Estático** (parte de `tests/no-telemetry.test.ts`): regex que falha se `JSON.stringify` aparecer perto de variável literalmente chamada `nsec`/`secretKey`/`privKey` em arquivo de transporte (`src/lib/transport/`, `src/lib/sync.ts`, `src/lib/probe.ts`, `src/lib/rebroadcast.ts`).
- **Dinâmico** (TODO, não entregue): smoke-test em Playwright que monkey-patcha `WebSocket.prototype.send` + `fetch` em `window`, executa fluxo de bootstrap+post, e verifica que nenhum payload contém os 32 bytes do nsec gerado. **Não entregue neste PR** — exige Playwright em CI, fora de escopo.

### Claim 4 — "Sem chave mestra, jamais" (manifesto §17, CLAUDE.md invariante #12)

**Citação literal** (`CLAUDE.md`):
> "Não escrever função `deletePost()`, `banUser()`, `flagAsSpam()` global, ou qualquer coisa que dê ao fundador poder sobre conteúdo de outros usuários."

**Verificável hoje?** Hoje, sim, ad-hoc. Eu rodei `grep -r "deletePost\|banUser\|removeUser\|flagAsSpam\|globalMute\|forceModerate\|adminAction\|superuserDelete" src/` — **zero matches**. A invariante está *atualmente* respeitada.

**Gap:** isso é estado, não teste. Daqui a 6 meses, Lily adiciona `adminFlag` "só pra debug" e ninguém percebe.

**Teste proposto:** `tests/no-master-key.test.ts` (ver Grupo 2). Faz scan estático da deny-list de nomes de função/método/export proibidos, e adicionalmente verifica que `src/lib/moderation.ts` não contém `DELETE FROM posts` (só `UPDATE` é exceção autorizada por invariante #1). **Status:** entregue.

### Claim 5 — "Score determinístico" (manifesto §22)

**Citação literal** (`CLAUDE.md` invariante #3 e §16):
> "`calculateScore`, `calculateWeight`, `getMaxSubposts`, etc., são funções puras: mesma entrada → mesma saída → sempre. Sem `Date.now()` implícito (passe `now` por parâmetro)."

**Verificável hoje?** Tests de output existem (`tests/scoring.test.ts`, `tests/weight.test.ts`). **Mas** não há teste que pegue uso *implícito* de `Date.now()` ou `Math.random()` dentro dessas funções. `scoring.ts:calculateScoreNow` legitimamente usa `Date.now()` mas é chamada de site separada.

**Gap:** `calculateScore` em si está limpa (`now` como parâmetro). Verifiquei. Mas em refactor futuro, alguém pode injetar `Date.now()` ou `performance.now()` dentro do corpo dela ou de `calculateWeight`/`applyContentFilters`. Determinismo quebra silenciosamente — testes de output não pegam porque o desvio é pequeno (segundos).

**Teste proposto:** `tests/manifesto-conformance.test.ts` (ver Grupo 2). Lê o conteúdo source de `src/lib/scoring.ts`, `src/lib/weight.ts`, `src/lib/feed.ts:applyContentFilters` (extrai o corpo da função), e regex-match contra `Date.now()`, `performance.now()`, `Math.random()`, `new Date()`. Whitelist explícita pra `calculateScoreNow` (helper documentado). **Status:** entregue.

### Claim 6 — "Bury não pune" (manifesto §23)

**Citação literal** (`CLAUDE.md` Compromissos / manifesto §23):
> "Bury não pune."

**Verificável hoje?** Implícito no código (`weight.ts` constante `POST_BURIED = 0`; `scoring.ts` aplica `buryWeight * 0.3` ao score do post mas zero impacto no peso do *autor*).

**Gap:** se alguém aumentar `POST_BURIED` em `config/constants.ts` de `0` pra qualquer outro número, manifesto §23 quebra silenciosamente.

**Teste proposto:** parte de `tests/manifesto-conformance.test.ts` — assert que `ENGAGEMENT_POINTS.POST_BURIED === 0` literal. **Status:** entregue.

### Claim 7 — "Sem scan automático de conteúdo" (CLAUDE.md invariante #7, manifesto §25)

**Citação literal** (`CLAUDE.md`):
> "Cliente oficial Drift NÃO escaneia, classifica ou filtra conteúdo automaticamente — sem PhotoDNA, sem ML local de moderação, sem blocklists embutidas."

**Verificável hoje?** Parcialmente — `src/lib/upload.ts` é honesto sobre não escanear (comentário literal manifesto §25). Mas não há teste que falhe se alguém adicionar `import nsfwjs` ou `import @microsoft/photodna-client`.

**Gap:** classificadores ML são `npm install` distância. Sem deny-list de packages, claim degrada por descuido.

**Teste proposto:** parte de `tests/no-master-key.test.ts` — lê `package.json` e falha se `dependencies` contém pacotes da deny-list ML/scan: `nsfwjs`, `@tensorflow/tfjs-models`, `@microsoft/cognitive-services-content-moderator`, `aws-sdk` (rekognition vector), `@google-cloud/vision`, `clamav.js`. **Status:** entregue.

### Claim 8 — "Cliente NÃO deleta dados moderados do SQLite" (CLAUDE.md invariante #13)

**Citação literal** (`CLAUDE.md`):
> "Score = -999 esconde do feed. Apagar do banco, não."

**Verificável hoje?** Confirmado em `moderation.ts:maybeModerate` (apenas `UPDATE posts SET score = -999`). Mas eviction (`cache.ts:evictOldPosts`) faz `DELETE FROM posts` legitimamente. A invariante diz "não remove posts que o user espalhou" — exige inspeção de query.

**Gap:** se eviction perder o filtro `WHERE NOT EXISTS (SELECT 1 FROM spreads ...)`, posts espalhados pelo user somem do cache local — manifesto §16 (disponibilidade distribuída via mecânica social) quebra. Marshall §3 (cenário facilitação) — defesa "cliente preserva conteúdo do próprio user mesmo após moderação" enfraquece.

**Teste proposto:** parte de `tests/no-master-key.test.ts` — lê `src/lib/moderation.ts` e exige presença literal do comentário `score = -999` + ausência de `DELETE FROM posts`/`DELETE FROM spreads`/`DELETE FROM buries` em `moderation.ts`. Lê `src/lib/cache.ts` e exige presença de cláusula que preserva spreads do user (TODO: deixei o assert comentado porque não examinei `cache.ts` ainda — humano valida). **Status:** entregue parcialmente.

### Claim 9 — "Compatibilidade com ecossistema Nostr" (CLAUDE.md invariante #14, manifesto §28-30)

**Citação literal** (`CLAUDE.md`):
> "Cliente Drift respeita NIP-01 sem extensões obrigatórias. Não inventa kinds privados. Tag `drift-version` distingue eventos Drift."

**Verificável hoje?** Parcialmente. `config/constants.ts` define `DRIFT_KIND` no range 9078-9081. Não há teste que falhe se alguém adicionar `DRIFT_KIND.PRIVATE_FLAG = 9090`.

**Gap:** kinds inventados fora da spec quebram interop com Damus/Snort/Coracle. Manifesto §28 quebra silenciosamente. Marshall não levanta isso explicitamente, mas é vetor de "alegação que deixa de ser verificável" — e portanto vetor que erode a defesa "cliente é browser especializado de Nostr".

**Teste proposto:** parte de `tests/manifesto-conformance.test.ts` — assert que `DRIFT_KIND` contém apenas as 4 chaves canônicas e os valores estão em `{9078, 9079, 9080, 9081}`. Reservados 9082, 9083 são permitidos no range mas não devem aparecer no `DRIFT_KIND_SET` ainda. **Status:** entregue.

### Claim 10 — "Identidade portável; dispositivo descartável" (CLAUDE.md invariante #9)

Verificável via tests de roundtrip já existentes em `tests/identities.test.ts`. **Sem gap acionável aqui — coberto.**

### Claim 11 — "Sem afinidade no feed" (CLAUDE.md invariante #11, manifesto §24)

Tem `tests/applyContentFilters.test.ts` mas testa só o helper. A query SQL do feed (`feed.ts:getGlobalFeed`) que ranqueia globalmente não tem teste estático que verifique ausência de `WHERE author_pub = ?` ou `JOIN follows` no path "Global". **Gap residual baixo** — feed tabs são separadas no código, mas teste estático seria saudável. **Não entregue neste PR** (escopo).

---

## b) Audit do nostr.build hardcoding (e amigos)

### Como está hoje

`src/lib/upload.ts:38`:

```typescript
const NOSTR_BUILD_ENDPOINT = 'https://nostr.build/api/v2/upload/files'
```

Const top-level, não-configurável, não lido de `UserPrefs`, não anunciado pra usuário antes do upload.

`src/components/Feed/SpreadMap.tsx:58-61`:

```typescript
tiles: [
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  // ...
]
```

CARTO hardcoded também. Mesmo padrão.

Workbox runtimeCaching em `vite.config.ts:75` referencia o mesmo regex de CARTO no service worker — qualquer fork que troque o tile provider precisa lembrar de tocar 2 lugares.

### Por que é risco (lente Marshall)

**LGPD vetor (Marshall Cenário F):** quando um user faz upload de imagem, o IP dele + a imagem inteira vão pra `nostr.build/api/v2/upload/files`. Quem opera nostr.build? Operadora privada US-baseada (alegado). Jurisdição? Operacional US, possivelmente com infraestrutura CDN multi-jurisdição (Cloudflare upstream). Termos de privacidade do nostr.build? Usuário do Drift nunca consente explicitamente.

Argumento ANPD plausível: "Drift cliente *cura* uma curadoria de hospedeiros — escolhe nostr.build sem consentimento granular do user — logo realiza ato de tratamento por decisão automatizada (encaminhamento). Marco LGPD Art. 7º base legal: nenhuma diretamente aplicável." Defesa fica fraca enquanto endpoint for hardcoded.

**Marco Civil vetor (Marshall §1.2 e §3.4):** se uma decisão judicial requisitar logs de quem fez upload de imagem X, nostr.build é alvo natural. Drift cliente como **encaminhador único** vira evidência de "decisão editorial sobre fluxo" — argumento Marshall avisa que é "problemático mas não absurdo".

### Refactor proposto (não entregue em código — só doc)

1. Adicionar em `types/drift.ts:UserPrefs`:
   ```typescript
   upload_endpoint: string  // default: 'https://nostr.build/api/v2/upload/files'
   upload_endpoint_acknowledged: boolean  // false até user confirmar leitura do aviso
   ```

2. Em `upload.ts:uploadImage`, ler endpoint de prefs em vez de const. Se `upload_endpoint_acknowledged === false`, throw `UploadError` com mensagem que UI captura e mostra dialog "Esta imagem será enviada pra **nostr.build** (operador independente, jurisdição US). Trocar provider | OK, entendi". Após primeiro OK, set `acknowledged = true`.

3. Idem CARTO em `SpreadMap.tsx`: `prefs.map_tile_url_template` com default CARTO. Documentar tile providers OSS alternativos em `Docs/privacy-providers.md` (osm.org direto — rate-limited mas zero terceiros; CARTO; Stamen via Stadia).

4. Service worker (`vite.config.ts` workbox) precisa ler endpoint dinâmico — workbox `runtimeCaching` aceita callback dinâmico via `urlPattern: ({ url }) => ...`. Atualmente regex literal — refactor médio.

### Teste proposto

`tests/no-telemetry.test.ts` inclui assertion: `src/lib/upload.ts` **não deve** conter `https://nostr.build` como string literal — endpoint deve vir de prefs. Falha CI se voltar pra hardcoded. (Test inicialmente falha — assertion serve como TDD pro refactor. Marquei como `it.todo` pra não bloquear CI antes do refactor.)

### Outros hardcodings detectados

- `https://a.basemaps.cartocdn.com/...` (3 subdomínios) em `SpreadMap.tsx`
- Same regex em `vite.config.ts:75` (workbox)
- `config/relays.ts` — seed list inicial de relays. Esse é OK por design (invariante #17: seed apenas, populada em primeira boot, depois `relays_user` manda). Confirmei via leitura do CLAUDE.md.
- IPFS gateway: ainda não implementado (`pin.ts` Fase 6) — quando entrar, não pode hardcodear `ipfs.io` ou `cloudflare-ipfs.com`. Adicionar pre-emptive `it.todo` agora.

---

## c) Threat model: cenários jurídicos Marshall A-G traduzidos pra mitigação técnica verificável

### Cenário A — Notificação extrajudicial Art. 21 MCI

**Vetor técnico:** notificante manda email ao Eduardo PF (extraído do `git log` ou `package.json`) exigindo remoção. Sem caixa postal separada (Marshall 4.4) o email cai no inbox pessoal.

**Mitigação técnica existente:** zero. Marshall identificou — software não é o vetor aqui, é o canal de contato.

**Audit proposto:** scan do `package.json`, `LICENSE`, `README.md`, todos os arquivos `Docs/*.md` por padrões PII (`@gmail.com`, `@ticketandgo`, telefone BR `+55 11`, CPF format). **Não entregue como teste obrigatório** — é varredura manual recomendada antes de cada release tag. Ver Marshall 4.9.

### Cenário B — STF determina bloqueio do PWA Vercel

**Vetor técnico:** ordem STF → Anatel → ISPs bloqueiam DNS de `drift-wheat-one.vercel.app`.

**Mitigação técnica existente:** **mínima**. Tauri binaries continuam funcionando (não dependem do domínio). PWA fica down. Manifesto não entrega "instâncias federadas" hoje.

**O que prova sobrevivência?** Hoje, **nada automatizado prova**. Ideal:
- `npm run check:mirrors` workflow que pinga lista de mirrors PWA documentados em `Docs/continuity.md` e falha se < 2 instâncias respondem com SHA256 do bundle batendo. **Não entregue** — exige mirrors existirem (Marshall 4.12, médio prazo).

**Workaround mínimo entregável agora:** test que verifica que `Docs/continuity.md` ou equivalente lista pelo menos 2 URLs alternativas (mirror requirement como doc constraint). **Não entregue neste PR — exige existir.**

### Cenário C — Eduardo indiciado por "facilitação" (Storm/Durov adaptado, Marshall §3.4-3.5)

**Vetor técnico:** MP argumenta "dev sabia que software permitia anonimato sem moderação centralizada → concorreu objetivamente". Defesa precisa demonstrar que o cliente **não facilita conscientemente** — invariantes do CLAUDE.md são exatamente isso. Mas precisam ser **continuamente verificáveis**, não prosa.

**Mitigação técnica existente:** invariantes #7, #12, #13 (sem scan automático, sem chave mestra, sem deletar dados moderados) — *atualmente respeitadas*. Nenhuma é testada em CI.

**Audit/test proposto (entregue neste PR):** os 3 tests `no-telemetry`, `no-master-key`, `manifesto-conformance` rodam em CI a cada PR. Quebram se invariantes regredirem. **Pra defesa Marshall:** auditor externo pode rodar `npm test` em qualquer commit e provar que invariantes se mantiveram desde o tag X até a data do alegado crime — evidência contínua de boa-fé.

### Cenário G — Seizure de domínio Vercel

**Vetor técnico:** Vercel desativa o domínio sob ordem.

**Mitigação técnica existente:** binários Tauri + GitHub Releases continuam. Mirrors PWA? Não.

**O que prova replicabilidade?** `Dockerfile.reproducible` existe (Linux). SHA256SUMS é publicado em release. **Audit proposto:** workflow CI que rebuilda em runner clean, compara hash, falha se divergir do hash anunciado. **Provavelmente já existe** — não verifiquei `.github/workflows/`. TODO humano: confirmar e documentar.

### Cenários D, E (Eduardo proibido/preso)

Vetor: Eduardo para de commitar. **Mitigação técnica:** dead-man's switch (Marshall 4.13) + multi-sig de tags. **Existe hoje:** não. **Test proposto:** verificar em `Docs/governance.md` (a criar — Marshall 4.5) que existe lista de co-maintainers ≥2 com chaves GPG/SSH publicadas. Hoje Lista vazia. **Test entregue como `it.todo`** — serve como reminder em CI.

### Cenário F — ANPD LGPD PA

Vetor: ANPD argumenta que Vercel deploy + identificação pública = controlador de fato.

**Mitigação técnica:** `tests/no-telemetry.test.ts` é a evidência. Combinado com PRIVACY.md, defesa "cliente não realiza tratamento" fica auditável.

---

## d) Service worker integrity — *o "chave mestra escondida" mais sutil*

### Como está hoje

- `vite.config.ts` configura `VitePWA` plugin com `registerType: 'autoUpdate'` (linha ~29). SW gerado pelo workbox em build, servido em `/sw.js`.
- `vercel.json` define `Cache-Control: max-age=0, must-revalidate` pro `/sw.js` — bom, força revalidação.
- **Quem assina o SW?** Ninguém. Vercel serve o que está em `dist/sw.js` no momento do deploy.
- **Quem controla o deploy?** Quem tem acesso ao dashboard Vercel ou push pra branch `main` (CI auto-deploya).

### A "chave mestra escondida" real

Service Worker tem capacidade total de:
- Interceptar **todo** request originado da página (incluindo posts pra relays via `fetch`)
- Modificar respostas (incluindo eventos vindos de relays — *fingir* que um post foi moderado)
- Reescrever próprio código no próximo update silencioso (`autoUpdate: true`)

`autoUpdate` significa: usuário abre o PWA → SW antigo encontra novo SW no servidor → instala em background → assume controle no próximo reload. **Sem prompt visível** ao usuário em muitos cenários.

**Threat:** ator com acesso ao Vercel deploy (Eduardo PF, GitHub Actions secret, ou — Marshall §3.6 — ordem judicial obrigando Vercel a injetar) pode pushar SW arbitrário. Usuários atualizam silenciosamente. *Quem confiou no Drift agora confia no SW que o Eduardo (ou quem o coage) servir hoje.*

Isso **literalmente** é a "chave mestra disfarçada" do manifesto §25 — operador de canal de update herda chave mestra.

### Mitigações (em ordem de viabilidade)

1. **`registerType: 'prompt'` em vez de `'autoUpdate'`.** Usuário recebe prompt "nova versão disponível, atualizar?" e pode escolher. Ainda confia no Eduardo, mas vê que houve update — se aparece prompt 50× num dia, suspeita.
   **Custo:** baixo (1 linha + UI hint).
   **Test:** assertion estática em `tests/manifesto-conformance.test.ts` que `vite.config.ts` contém `registerType: 'prompt'` — falha CI se mudar pra autoUpdate. **TODO entregue.**

2. **SRI (Subresource Integrity) nos chunks principais.** Workbox suporta. `index.html` referencia `sw.js` via `<script>` que pode ter `integrity="sha384-..."`.
   **Custo:** médio. SW em si não pode ter SRI no registro (`navigator.serviceWorker.register('/sw.js')` não aceita integrity).
   **Limite:** SRI só funciona se hash é computado localmente — auditor compara hash do SW servido contra hash do build CI publicado em GitHub Release. Manual hoje.

3. **SW reproduzível + hash publicado em release notes.** Workflow GitHub Action: build → SHA256 do `dist/sw.js` → commit em `RELEASE_NOTES.md` + tag. Auditor: `curl https://drift-wheat-one.vercel.app/sw.js | sha256sum`, compara com release. Se diverge → Vercel está servindo SW modificado. **Custo:** baixo. **Test:** workflow CI que falha se `dist/sw.js` hash mudar entre build clean e build CI.

4. **Auditoria pública periódica** (cron job externo, fora de Vercel): pinga `/sw.js`, hash, posta em pastebin/IPFS público. Discrepância vira alerta.

### Teste proposto neste PR

`tests/manifesto-conformance.test.ts` inclui:
- Assert que `vite.config.ts` referencia `registerType` (TODO: assertion forte sobre o valor esperado — humano decide entre 'prompt' (recomendado) ou keep 'autoUpdate' com mitigação 3+4).
- Assert que existe `Dockerfile.reproducible` (já existe).
- TODO: assertion que workflow CI publica SHA256 de `sw.js` em release. (Não verifiquei `.github/workflows/release.yml` — humano valida.)

---

## e) CSP/headers audit

### Vercel (`vercel.json`)

```json
"headers": [
  { "source": "/(.*)", "headers": [
    { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
    { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "X-Frame-Options", "value": "DENY" },
    { "key": "Referrer-Policy", "value": "no-referrer" },
    { "key": "Permissions-Policy", "value": "geolocation=(self), camera=(), microphone=(), payment=()" }
  ]}
]
```

**Achados:**
- COOP/COEP corretos (necessários pra OPFS).
- `X-Content-Type-Options: nosniff` ✅
- `X-Frame-Options: DENY` ✅
- `Referrer-Policy: no-referrer` ✅ (excelente pra privacidade)
- **`Content-Security-Policy` ausente.** ⚠️ Nenhum CSP no PWA. Significa: XSS (qualquer) consegue executar inline scripts e fazer fetch pra qualquer host. Comparativamente, Tauri tem CSP (vide próximo).
- Permissions-Policy: `geolocation=(self)` permite — ok dado uso opt-in. Mas `camera=(), microphone=()` proíbe — bom. Falta `usb=()`, `bluetooth=()`, `serial=()`, `display-capture=()`, `interest-cohort=()` (anti-FLoC).

**Recomendação:** adicionar CSP forte no `vercel.json`:
```
Content-Security-Policy:
  default-src 'self';
  connect-src 'self' wss://*.* https://nostr.build https://*.basemaps.cartocdn.com;
  img-src 'self' data: blob: https:;
  style-src 'self' 'unsafe-inline';
  script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self' blob:;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'none'
```
(`'unsafe-inline'` em style-src é doloroso mas necessário pra Tailwind JIT runtime — Marshall vai mexer em prod build pra remover, mas custo alto.)

### Tauri (`src-tauri/tauri.conf.json`)

```json
"csp": "default-src 'self'; connect-src 'self' wss: https:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; frame-ancestors 'none'"
```

**Achados:**
- `connect-src 'self' wss: https:` é **muito permissivo**. Permite WSS pra qualquer host (necessário pra relays user-configuráveis ✅) **e** HTTPS pra qualquer host. Esse último abre nostr.build, CARTO, e qualquer domínio futuro. Não há `'self'` strict — qualquer origem HTTPS. Pra Drift isso é compromisso aceitável (relays dinâmicos), mas vale documentar.
- `style-src 'unsafe-inline'` ⚠️ — XSS via style injection é vetor real. Tailwind JIT precisa. Compromisso conhecido.
- `script-src 'self' 'wasm-unsafe-eval'` ✅ correto pra SQLite WASM. Nota: `'wasm-unsafe-eval'` é equivalente a antigo `'unsafe-eval'` específico pra WASM — não permite eval JS. OK.
- Sem `base-uri 'self'`, sem `form-action 'none'`, sem `object-src 'none'` (último é CSP3 default mas explícito é melhor).

**Recomendação:** adicionar `base-uri 'self'; form-action 'none'; object-src 'none'` no tauri CSP. Custo: 1 linha.

### Teste proposto

`tests/manifesto-conformance.test.ts` inclui:
- Assert que `vercel.json` headers contém `X-Frame-Options: DENY` e `Referrer-Policy: no-referrer`.
- TODO: assert que CSP existe em `vercel.json` (atualmente *não existe* — failing test serve como TDD).
- Assert que `tauri.conf.json` security.csp contém `frame-ancestors 'none'` e não contém `unsafe-eval` (sem o sufixo `-wasm`).

---

## Veredito Barney

### Top 3 vulnerabilidades/gaps encontrados

1. **Service Worker autoUpdate sem signing/hash publicado** — chave mestra disfarçada literal (manifesto §25 descreve isso). Tier-1 hardening mencionou; não está mitigado em código. Refactor `registerType: 'prompt'` é 1 linha.
2. **CSP ausente no PWA Vercel** — XSS qualquer consegue beacon-out. Combina com gap "sem teste anti-telemetry" pra criar superfície surpreendentemente larga pra projeto que se vende como anti-telemetry.
3. **`nostr.build` hardcoded é vetor LGPD curador-único** — Marshall apontou; refactor pra `UserPrefs` é médio mas alto impacto. Idem CARTO.

### Top 3 testes no-brainer pra adicionar à CI agora

1. **`tests/no-telemetry.test.ts`** — deny-list de domínios analytics + fingerprinting APIs. Custo: zero (entregue). Quebra se alguém adiciona Sentry.
2. **`tests/no-master-key.test.ts`** — deny-list de funções proibidas + verificação que `moderation.ts` não faz `DELETE FROM`. Custo: zero (entregue). Quebra se alguém adiciona `deletePost()`.
3. **`tests/manifesto-conformance.test.ts`** — pureza estática de `scoring.ts`/`weight.ts`/`applyContentFilters`, kinds dentro do range, `POST_BURIED === 0`. Custo: zero (entregue). Quebra se manifesto regride.

### Top 3 claims que Barney considera **mentira atual** (sem prova testada)

Honestidade Barney mode — "not legendary, just honest":

1. **"Sem telemetria — `grep` no repositório confirma"** (PRIVACY.md). É *true* hoje — mas a prosa aponta pra "grep" que ninguém roda. Até este PR, nenhum CI verifica. Mentira por omissão de teste contínuo. *Resolved by this PR.*
2. **"nsec NUNCA sai do dispositivo"** (CLAUDE.md #8). Provavelmente true — mas **não há teste dinâmico** que verifique no fluxo real. Static check parcial entregue. **Mentira parcial por enquanto** (claim absoluto, prova parcial).
3. **"Sem chave mestra"** (manifesto §17). Verdade *no código aplicativo*. Mas o **service worker autoUpdate é chave mestra de facto** — Eduardo (ou quem o coagir, ou quem comprometer Vercel CI) pode pushar JS arbitrário pros usuários sem prompt. Manifesto §17 v2.2 deveria, em rigor, classificar SW autoUpdate como inadmissível. **Mentira estrutural** até `registerType: 'prompt'` + hash publicado entrarem.

### O que Barney **não entrega** neste PR (escopo / requer humano)

- Test dinâmico Playwright pra exfil de nsec (exige Playwright em CI).
- Refactor de `nostr.build` → `UserPrefs.upload_endpoint` (modifica src/, fora de escopo da sessão).
- Workflow CI que publica SHA256 do sw.js (não verifiquei `.github/workflows/`).
- `Docs/governance.md` listando co-maintainers (Marshall 4.5; cross-functional, requer Lily/Ted).
- Doc `Docs/privacy-providers.md` listando endpoints alternativos (Marshall 4.6 áreas adjacentes).
- CSP no `vercel.json` (modificação de config, fora de escopo da sessão).

---

*Barney Stinson, persona LLM, signing off.*
*"Suit up — but verify. Lawyered? No. Tested. That's the new lawyered."*
