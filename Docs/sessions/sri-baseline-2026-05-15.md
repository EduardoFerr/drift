# SRI Baseline — 2026-05-15

**Persona:** Barney (peer review / security / threat modeling)
**Gap origin:** Round CWV-3 follow-up, 2026-05-09 (deferido pra Round Cleanup)
**Manifesto link:** §17 (sem chave mestra disfarçada)

## Threat model

Vetor: atacante compromete CDN, Vercel deploy hook, GitHub Actions
runner secret, ou conta de manutenção do projeto. Injeta payload em
`assets/index-<hash>.js` mantendo o mesmo filename fingerprint que o
HTML referencia. Browser fetch carrega bytes adulterados; JS executa
no contexto do user (acesso à master key em IndexedDB, nsec
descriptografada em memória, network-attached storage do device).

Vite fingerprint de arquivo dá integridade **build-time** (mesma
entrada → mesmo hash), mas não **transit-time** — depois do build, o
binding entre filename e bytes vive na convenção do servidor.

SRI fecha esse gap: `<script integrity="sha384-...">` força o browser
a verificar o hash dos bytes carregados antes de executar. Mismatch →
recusa execução, console error, sem propagar pro DOM. Defesa funciona
mesmo sem TLS (Vercel já dá TLS; SRI cobre comprometimento pós-TLS).

Não cobre: comprometimento do próprio `index.html` (atacante reescreve
ambos os `integrity=` e os bundles). Mitigação: build reproduzível
+ hashes públicos de release (Fase 7, §17 manifesto roadmap).

## Decisão: Option B (script custom)

`vite-plugin-subresource-integrity` última publicação 2024-04, v0.0.12
(pre-1.0). Vite 5.4 + vite-plugin-pwa 0.20 são deps frescas; risk de
incompat ou abandono é maior que o custo de manter ~120 linhas de Node.

Implementação: `scripts/inject-sri.mjs` roda como step final do `build`
npm script. Lê `dist/index.html`, regex pega `<script type="module">`,
`<link rel="modulepreload">`, `<link rel="stylesheet">` apontando pra
`/assets/`, computa `sha384(file)`, injeta `integrity="sha384-<base64>"`
no atributo final da tag. Idempotente (skip se já tem integrity).

## Cobertura

5 tags injetadas no build atual (V9.28):

| Tag | Hash inicial (sha384, primeiros 16 chars) |
|---|---|
| `index-BlstaBHe.js` (entry) | `jDNmdKQbR4oD0MqD…` |
| `vendor-react-u7NqBe2v.js` | `YA6WiYlFKSsQl+Ni…` |
| `vendor-nostr-46nNcAGH.js` | `l3aCwI6XDE13eI1a…` |
| `vendor-motion-DHbLc7Hb.js` | `zEi1Bf4eauOOT57m…` |
| `index-tjNAIw-T.css` | `09lHrv37eR+wC/cl…` |

`tests/sri-conformance.test.ts` valida estrutural (presença + formato
`sha384-...`) e defesa-em-profundidade (recomputa hash de cada arquivo
e compara com o `integrity=` da tag). +6 tests, total 980.

## Edge cases / out of scope

**Dynamic imports via `__vitePreload`** — Vite injeta `<link
rel="modulepreload">` em runtime quando código chama
`import('./LazyComp')`. Esses não passam por `dist/index.html` (são
construídos client-side a partir do manifest interno). SRI nesses
exigiria patch do helper `__vitePreload` ou hook customizado em
`build.modulePreload.resolveDependencies` que retorne tuplas
`{href, integrity}`. **Status:** TODO Fase 6 (entra junto com build
reproduzível F-Droid). Mitigação parcial hoje: filename fingerprint
Vite + lazy chunks `helia-deps`, `maplibre-gl`, `tesselator`,
`rebroadcast`, `vendor-identity` continuam protegidos por TLS + Vercel
asset cache. Atacante precisaria comprometer Vercel **e** o vendor
delivery — risco residual aceito até Fase 6.

**Service Worker (`sw.js` + `workbox-*.js`)** — SRI HTML attribute não
se aplica a `navigator.serviceWorker.register()` nem a
`importScripts()`. Workbox precache tem revision hash por entrada
(`{url, revision}`), e o browser usa Service Worker update flow
(byte-diff do `sw.js`) pra detectar mudança. Compromise teria que
sobrescrever **tanto** `sw.js` quanto recomputar todas as revisions
sem mismatch — mais alto bar que HTML SRI, mas não equivalente.
**Status:** TODO Fase 6 — investigar `workbox-precaching` integrity
mode (existe `integrity` field em precache manifest entries desde
workbox 7.0; vite-plugin-pwa ainda não expõe). Tracking issue
[upstream](https://github.com/vite-pwa/vite-plugin-pwa/issues).

**CSP `require-sri-for`** — header CSP `Content-Security-Policy:
require-sri-for script style` força browser a recusar qualquer
script/style sem integrity. Defesa adicional mas requer config no
Vercel (não no Vite). **Status:** TODO Round Cleanup follow-up —
adicionar `vercel.json` headers junto com COOP/COEP já presentes em
`serve.json`.

## Follow-up TODO

- [ ] Dynamic chunks SRI via `__vitePreload` patch (Fase 6)
- [ ] CSP `require-sri-for script style` em Vercel response headers
- [ ] Workbox precache integrity mode quando vite-plugin-pwa expor
- [ ] Build reproduzível F-Droid (§17 roadmap) — publica hashes
      independentes do canal Vercel
