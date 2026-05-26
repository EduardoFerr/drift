# Barney — NSFW npm Research (2026-05-23)

> *"Você sabe o que é legendary? É achar uma lib que não te transforma
> em chave-mestra disfarçada. Sabe o que é trash? Importar `nsfwjs` no
> cliente oficial achando que tá ajudando o usuário. Suit up — vamos
> separar."*  — Barney

**Persona:** Barney Stinson (peer review crítico, threat modeling,
adversarial skepticism)
**Escopo:** research npm ecosystem por packages relacionados a NSFW /
content-warning / moderation / privacy de imagens. **Doc-only**.
**Veredito de cabeçalho:** Sim, existe ALGO usable — mas **nenhum
scanner**. Os GOs são todos primitives de **UI/privacy** que jamais
classificam conteúdo. Veja TL;DR.

---

## 1. TL;DR

**Existe algo usable que não viola manifesto Drift?**
**Sim — mas categoricamente diferente do que se procura quando se
ouve "package NSFW".**

| Pergunta | Resposta |
|---|---|
| Algum **classifier/scanner** cabe no cliente oficial? | **Não.** Todos violam §7/§17/§25 sem exceção. |
| Algum **classifier/scanner** cabe como plugin opt-in? | **Sim, condicionalmente** (escape §25). Mas Drift hoje não tem infra de plugins, então é roadmap Fase 6.5+. |
| Algum **UI/privacy primitive** cabe **agora** no cliente oficial? | **Sim — 3 candidatos GO** (Tailwind CSS nativo, `blurhash`, `piexifjs`). Todos respeitam §27 (self-tagging) e nenhum classifica conteúdo. |
| Vale npm install **agora**? | **Não urgente.** Tailwind já tá no projeto (CSS blur grátis). `blurhash` e `piexifjs` ficam em backlog com gatilho claro. |

**Diagnóstico Barney:** o gap real do Drift não é "falta um scanner".
É "tem self-tagging mas falta polish de UX". Procurar package de
classificação é trocar problema social (autor honesto sobre seu
conteúdo) por problema técnico (operador externo decide pelo autor).
Manifesto §27 é uma escolha; quem reabre essa porta sem entender o
trade-off perde §25.

---

## 2. Tabela master

| Package | O QUE FAZ | §7 violado? | §17 violado? | §25 violado? | Compat §27? | Veredito | Use case Drift |
|---|---|---|---|---|---|---|---|
| **nsfwjs** | ML classifier client-side (TF.js MobileNetV2, 90% acc) | **SIM** — scan automático embutido | **SIM** — modelo treinado por Infinite Red decide | **SIM** — chave-mestra disfarçada óbvia | Não — substitui self-tag por detection | **NO-GO** (cliente oficial); CONDITIONAL (plugin opt-in Fase 6.5+) | Nenhum no cliente oficial |
| **nsfw-filter-nsfwjs** | Wrapper de nsfwjs com presets | SIM | SIM | SIM | Não | **NO-GO** | — |
| **@aws-sdk/client-rekognition** | SDK AWS Rekognition (cloud moderation) | SIM | **SIM hard** — Amazon decide | SIM | Não | **NO-GO absoluto** | — |
| **@azure/cognitiveservices-contentmoderator** | SDK Azure Content Moderator | SIM | **SIM hard** — Microsoft decide | SIM | Não | **NO-GO absoluto** | — |
| **@google-cloud/vision** (SafeSearch) | SDK Google Vision SafeSearch | SIM | **SIM hard** — Google decide | SIM | Não | **NO-GO absoluto** | — |
| **sightengine** | SDK SaaS moderation | SIM | SIM | SIM | Não | **NO-GO** | — |
| **nudity-filter** | Wrapper de cloud nudity APIs | SIM | SIM | SIM | Não | **NO-GO** | — |
| **Tailwind CSS `blur-*` / `backdrop-blur-*`** | Utility classes CSS, zero detection | Não | Não | Não | **Sim** — pinta blur quando autor self-tag | **GO** (já instalado) | Overlay visual em PostViewer/imagem quando `tags content-warning` presente |
| **blurhash** (woltapp) | Decode de string compacta → canvas placeholder; zero classification | Não | Não | Não | Neutro (não interfere) | **GO** | Placeholder pre-load de imagens de upload (anti-CLS); pré-blur durante decode |
| **thumbhash** (evanw) | Alternativa moderna ao blurhash (~25 bytes, encode alpha + aspect) | Não | Não | Não | Neutro | **GO (preferido sobre blurhash)** | Mesma coisa que blurhash, mais compacto |
| **piexifjs** | Read/write/strip EXIF em JPEG, pure JS browser | Não | Não — só edita bytes locais | Não | **Sim — privacy aliada** (§30 anti-rastreio) | **GO** | Strip EXIF pré-upload (GPS, device, timestamp); manifesto §30 PII reduction |
| **exifr** | Read EXIF/XMP/IPTC, write experimental | Não | Não | Não | Neutro | **GO (read-only)** | Mostrar pro user o que vai vazar se ele não strippar |
| **browser-image-compression** | Compressão + flag `preserveExif` (default false = strip) | Não | Não | Não | **Sim** | **GO (alta utilidade)** | Resize + strip EXIF + reduzir bytes pré-upload nostr.build (Fase 3 já trata, mas isso simplifica) |
| **pica** | Resize de alta qualidade client-side | Não | Não | Não | Neutro | **GO (low priority)** | Resize antes de upload, sem metadata stripping built-in |
| **sharp** | Server-side Node image processing | Não no client (Node lib) | Não no client | Não no client | N/A | **N/A — Drift é client-only** | Irrelevante; não rodar server-side |
| **jimp** | Pure JS image processing, roda em browser | Não inerentemente | Não | Não | Neutro | **CONDITIONAL** — bundle pesado (~400KB), 10-30x slower que sharp/pica | Skip — bundle hard ratchet 250KB |
| **react-progressive-blur** | Componente React de gradient blur | Não | Não | Não | Neutro | **GO baixo valor** | Tailwind cobre; só vale se quiser gradient específico |
| **react-blurhash** | Componente React que decoda blurhash em canvas | Não | Não | Não | Neutro | **GO** (companheiro de `blurhash`) | Render do placeholder hash |
| **DINOv3 self-supervised (vladmandic/Human.js)** | ML alternativo ao nsfwjs | SIM | SIM | SIM | Não | **NO-GO** | — |
| **exif-be-gone** | Node stream pra strip EXIF | Não no client (Node lib) | Não | Não | Sim | **N/A** | Irrelevante (server-side) |
| **exif-stripper** (mshibl) | Pure JS browser EXIF stripper | Não | Não | Não | **Sim** | **GO low priority** (piexifjs é mais robusto) | Backup de piexifjs |

**Linha de corte clara:** qualquer package que **decide** (classifica,
detecta, modera) é NO-GO no cliente oficial. Qualquer package que
apenas **renderiza/strippa/comprime** após o autor decidir é GO.

---

## 3. Top 3 GO — packages que cabem no Drift

### 3.1. Tailwind CSS `blur-*` / `backdrop-blur-*` (já instalado)

**O que é:** utility classes nativas do Tailwind 3 que aplicam CSS
`filter: blur()` e `backdrop-filter: blur()`. Sem JavaScript runtime.

**Por que GO:**
- Zero dependência nova (Tailwind já no `package.json`)
- Zero bundle cost (utility classes purgeable)
- Zero classification — só pinta pixel quando *você* manda
- Compat §27 perfeito: `<img class={post.tags.contentWarning ? 'blur-2xl' : ''}>` é literalmente o pattern manifesto

**Use case Drift:** `PostViewer.tsx` já lê `tags.content-warning`. Hoje
provavelmente usa overlay ou condition simples. Tailwind permite:
```jsx
className={cw && !revealed ? 'blur-2xl hover:blur-xl transition' : ''}
```
Custo: zero bytes runtime, semântica certa.

**Risco:** nenhum. É CSS.

### 3.2. `piexifjs` — strip EXIF pre-upload

**O que é:** lib pure-JS de ~30KB (gzip <10KB) que lê/escreve/remove
EXIF de JPEG. `piexif.remove(dataURL)` retorna JPEG sem EXIF.

**Por que GO:**
- Aliada do manifesto §30 (PII reduction) e §17 (não dar metadata
  pro relay/operator analisar). Sem strip, GPS coords vazam pro
  `nostr.build` upload.
- Zero classification — só edita bytes
- Bundle leve, no postinstall scripts, ESM-compat
- Drift hoje (`src/lib/upload.ts`) provavelmente **NÃO** strippa EXIF
  — vetor de privacy leak silencioso

**Use case Drift:** integrar em `upload.ts` antes de `fetch(uploadUrl)`:
1. User seleciona foto
2. `piexif.remove(dataURL)` → bytes limpos
3. Upload pra nostr.build
4. Opcional: `exifr.parse(originalFile)` → mostra ao user "removemos:
   GPS lat/lon, modelo da câmera, timestamp" (transparência §28)

**Risco baixo:** lib velha (last publish ~2020), mas estável e usada
em produção. Edge case: PNG/HEIC não cobertos (PNG geralmente não
carrega EXIF; HEIC requer convert).

### 3.3. `thumbhash` (evanw, MIT) — placeholder de imagem compacto

**O que é:** algoritmo + lib pra codificar imagem em ~25 bytes string
(base64 ~33 chars). Decode → canvas placeholder enquanto a real
carrega. Sucessor moderno do `blurhash` (Wolt), com aspect ratio +
alpha + cores mais fiéis.

**Por que GO:**
- Zero classification — é hash perceptual genérico, neutro
- Substitui blur loading state (hoje provavelmente cinza ou nada)
- Reduz CLS (Core Web Vitals — Drift cuida)
- Sinérgico com §27: pode-se pré-blur a thumb pra content-warning
  posts sem precisar carregar a imagem cheia

**Use case Drift:** autor gera thumbhash no compose (single small JS
operation), inclui no JSON `subposts[].imageHash`. Leitor decoda em
canvas como bg até `<img>` carregar. Pra content-warning, pode-se
manter só o thumbhash visível.

**Risco:** baixo. Lib é tiny (~5KB), MIT, autor é Evan Wallace
(ex-Figma, autor do esbuild). Mas é decisão de schema — mudar
formato dos subposts requer migração / backward compat. **Backlog,
não urgente.**

---

## 4. Top 5 NO-GO — scanners óbvios

### 4.1. `nsfwjs` (infinitered) — **o tentador**

**Por que parece atrativo:** "roda 100% no browser, TensorFlow.js,
nada vai pra servidor!"

**Por que é NO-GO duro:**
- §7: literalmente "scan automático no cliente oficial". Não importa
  que rode local — é a *política do scanner* que viola, não onde
  roda.
- §25: o modelo MobileNetV2 foi treinado por Infinite Red com dataset
  proprietário. **Eles decidem** o que é "Porn/Hentai/Sexy/Neutral/
  Drawing". Se amanhã o dataset for refinado pra incluir
  "political_extremism", todo cliente que embutiu vira braço de
  censura por proxy.
- Bundle: 3.5MB modelo bundled ou 2.6MB hosted. Drift entry chunk
  hard ratchet é **250KB**. Mata o orçamento sozinho.
- TF.js como dep: arrasta WebGL, WASM bindings — incompatível com
  invariante §4 (worker SQLite isolation já é complexo).

**Veredito:** NO-GO no cliente oficial. CONDITIONAL como plugin opt-in
em Fase 6.5+ se Drift adicionar plugin architecture. Mesmo assim,
default OFF, escolha explícita do user, surfacing claro de "isto é
um modelo de terceiro decidindo o que é NSFW pra você".

### 4.2. `@aws-sdk/client-rekognition` + `@google-cloud/vision` + `@azure/cognitiveservices-contentmoderator`

**Por que NO-GO absoluto:**
- Cloud authority literal — Amazon/Google/Microsoft veem cada bytes
  enviado pro endpoint. §17 viola em definição máxima.
- Mesmo opcional, mesmo "plugin", isto envia conteúdo pra
  superpotências de surveillance. Manifesto §15 (anti-censura por
  Estado-nação) é contraditório com mandar tudo pra AWS us-east-1.
- Bundle hediondo: `@aws-sdk/client-rekognition` traz ~700KB minified
  de deps.

**Veredito:** NO-GO. Nem como plugin. Conflito direto com §15.

### 4.3. `sightengine` (SaaS moderation API)

Mesma família dos cloud SDKs. SaaS proprietário com pricing,
TOS, retention policies opacas. Operator herda chave-mestra. NO-GO
mesmo como plugin (cliente alternativo poderia, mas Drift oficial
não distribui).

### 4.4. `nudity-filter`

Wrapper barato sobre APIs de detection. Mesma análise. NO-GO.

### 4.5. PhotoDNA libraries (qualquer wrapper Microsoft)

**Por que NO-GO especificamente duro:**
- §25 caso paradigmático. Microsoft mantém a hash database. Microsoft
  decide o que entra. Microsoft pode incluir hashes não-CSAM (já
  documentado em literatura — function creep).
- Mesmo como plugin: o conteúdo (ou hash perceptual) é enviado pra
  Microsoft. §17.
- **Tentação especial:** "mas é pra CSAM!" — manifesto §17 explícito:
  conteúdo ilegal é endereçado via §26 (reports comunitários) +
  encouragement pra denunciar a NCMEC/SaferNet via UI dedicada (Fase
  4). Não via scanner embutido. Essa é uma escolha consciente, dura,
  e o manifesto se posiciona.

**Veredito:** NO-GO. Não tem flex.

---

## 5. CONDITIONAL plugins — escape §25

Estes podem existir como **plugin externo** ou **cliente alternativo**
(sempre OFF por default, escolha explícita), nunca no cliente oficial:

| Package | Quando consideraria | Pré-requisitos antes de empacotar |
|---|---|---|
| `nsfwjs` | User de jurisdição com obrigação legal de filtrar (corp deploy, kiosk em escola) | (1) Drift precisa ter plugin architecture (Fase 6.5+ não-roadmap atual); (2) UI surfacing claro "este plugin foi treinado por X, decide Y, dados nunca saem do device"; (3) toggle default OFF; (4) audit log local de classifications pra user inspecionar; (5) opt-out 1-click reversível |
| `sightengine` ou cloud SDK | Cliente alternativo enterprise (e.g., empresa hostando Drift internamente com SLA) | Mesmo cenário, + extra: warning gigante "este plugin envia seus posts pra Sightengine antes de publicar. Sightengine vê tudo. Você confia?" |
| `@xenova/transformers` (HF.js ONNX) + modelo NSFW custom | Pesquisador / power user querendo modelo próprio | Plugin architecture + interface pra usuário escolher *seu próprio* modelo (não default fornecido) |

**Princípio Barney:** plugin é **escape**, não **default disfarçado**.
Se um dia Drift empacotar plugins, a interface tem que tornar **mais
fácil** desativar todos do que ativar um. Se for o contrário, virou
chave-mestra com extra steps.

---

## 6. Recomendação final

### Imediato (esta sprint / próxima)
**Nada de npm install.** Drift já tem o suficiente:
- Tailwind CSS pra blur visual (zero deps novas)
- Self-tagging `content-warning` já implementado (15 arquivos
  referenciam)
- §26 reports + threshold dinâmico cobrem moderação reativa

### Backlog priorizado
1. **`piexifjs` — EXIF strip pré-upload** *(alta prioridade, privacy)*
   - **Gatilho:** auditoria mostra que GPS coords / device metadata
     vazam pro `nostr.build` em upload de fotos. Isso é leak silencioso
     hoje (§30 violado de fato? confirmar inspecionando `upload.ts`).
   - **Esforço:** ~50 LOC em `upload.ts`. Adicionar testes em
     `tests/upload-exif-strip.test.ts`.
   - **Risco:** baixo. Lib estável, bundle <10KB gzip.
   - **Bonus:** UI transparente "removemos: lat=X, lon=Y, modelo=Z"
     antes de upload (§28 transparência radical).

2. **`thumbhash` — placeholders de imagem** *(média prioridade, UX)*
   - **Gatilho:** quando alguém reclamar de CLS no feed com imagens,
     ou em audit Lighthouse.
   - **Esforço:** maior — requer mudança de schema subpost (campo
     `imageHash`), encode no compose, decode no viewer. Compat
     backward via fallback (post sem hash = render normal).
   - **Risco:** schema migration, requer test conformance.

3. **Auditar Tailwind blur em PostViewer** *(quick win)*
   - **Gatilho:** já. Verificar se `tags.content-warning` aplica
     `blur-*` consistente (visual + click-to-reveal pattern), com
     a11y (aria-label "imagem com aviso de conteúdo, clique pra
     revelar"). Provável que já esteja decente, mas vale checklist.

### Não-fazer (registrar como descartado)
- **nsfwjs no cliente oficial** — encerrar discussão. Documentar em
  `Docs/known-limitations.md` como decisão consciente, com Reopener
  condition: "se Drift adicionar plugin architecture + Drift Foundation
  governance pra audit de modelos pluggable, reabrir como plugin opt-in".
- **Qualquer cloud moderation SDK** — encerrar permanente. Não tem
  Reopener condition aceitável.

### Pergunta aberta pra deliberação Ted/Satoshi/Robin
- Drift devia ter um **manifesto-conformance test** que bloqueie PR
  que adicione `nsfwjs` / `@aws-sdk/client-rekognition` / `sightengine`
  ao `package.json`? LOCK_VIA_TEST estilo §17. Defesa em profundidade
  contra "boa intenção" de contributor futuro que não leu o manifesto.
  Sugestão Barney: **sim, adicionar `tests/manifesto-conformance.test.ts`
  case que parse `package.json` deps + dev deps e falha se contém
  qualquer da blocklist {nsfwjs, nsfw-filter-nsfwjs, sightengine,
  nudity-filter, @aws-sdk/client-rekognition, @google-cloud/vision,
  @azure/cognitiveservices-contentmoderator, photodna-*}**. Custo: ~20
  LOC. Benefício: §17 enforced em compile time, não review time.

---

## 7. Conclusão Barney

**Resumo em uma frase:** o npm ecosystem tem MUITA coisa pra detectar
NSFW e quase tudo é veneno pro manifesto Drift; o que sobra de valioso
é primitives de **privacy** e **UI** que ajudam a *executar* §27
(self-tagging) melhor — não a substituir por scan.

Se alguém na comunidade pedir "por que Drift não tem filtro NSFW
embutido tipo X", a resposta é §25 com link pra este doc. Não é
omissão — é decisão de design protegida por LOCK_VIA_TEST proposto.

> *"Legen — espera, vou strippar o EXIF dessa screenshot —
> dary."* — Barney

---

## Sources

- [infinitered/nsfwjs (GitHub)](https://github.com/infinitered/nsfwjs)
- [nsfwjs site](https://nsfwjs.com/)
- [nsfw-filter-nsfwjs (npm)](https://www.npmjs.com/package/nsfw-filter-nsfwjs)
- [Socket — NSFW Detection packages](https://socket.dev/npm/category/server/media-processing/nsfw-detection)
- [Client-side NSFW with DINOv3 (Medium)](https://medium.com/@geronimo7/client-side-nsfw-image-detection-with-dinov3-33263142d4bb)
- [piexifjs (GitHub hMatoba)](https://github.com/hMatoba/piexifjs)
- [exifr (npm)](https://www.npmjs.com/package/exifr)
- [exif-be-gone (joshbuddy)](https://github.com/joshbuddy/exif-be-gone)
- [Exif-Stripper (mshibl)](https://github.com/mshibl/Exif-Stripper)
- [blurhash (woltapp)](https://github.com/woltapp/blurhash)
- [blurhash (npm)](https://www.npmjs.com/package/blurhash)
- [thumbhash (evanw)](https://github.com/evanw/thumbhash)
- [thumbhash site](https://evanw.github.io/thumbhash/)
- [react-blurhash (npm)](https://www.npmjs.com/package/react-blurhash)
- [react-progressive-blur (npm)](https://www.npmjs.com/package/react-progressive-blur)
- [react-css-blur (npm)](https://www.npmjs.com/package/react-css-blur)
- [Tailwind backdrop-blur](https://tailwindcss.com/docs/backdrop-blur)
- [Tailwind filter blur](https://tailwindcss.com/docs/filter-blur)
- [sightengine npm](https://www.npmjs.com/package/sightengine)
- [Sightengine client-nodejs (GitHub)](https://github.com/Sightengine/client-nodejs)
- [nudity-filter (npm)](https://www.npmjs.com/package/nudity-filter)
- [AWS Rekognition content moderation](https://aws.amazon.com/rekognition/content-moderation/)
- [sharp output options (metadata strip)](https://sharp.pixelplumbing.com/api-output/)
- [image-size vs jimp vs pica vs sharp comparison](https://npm-compare.com/image-size,jimp,pica,sharp)
- [Best Image Moderation APIs 2026 (Eden AI)](https://www.edenai.co/post/best-image-moderation-apis)
- [Hiding Images with Content Warnings in React (DEV)](https://dev.to/heyitsstacey/hiding-images-with-content-warnings-in-react-36c9)
- [Mastodon content warnings docs](https://docs.joinmastodon.org/user/posting/)
