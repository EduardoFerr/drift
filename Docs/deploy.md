# Deploy

Caminhos públicos pra rodar Drift:

1. **Vercel** — PWA hospedada com COOP/COEP corretos e preview por PR
2. **GitHub Releases** — bundle `dist.zip` por tag `v*` pra self-host/auditoria
3. **Cloudflare Tunnel** — dev local exposto via HTTPS válido (já no `dev:tunnel`)
4. **F-Droid / Google Play** — APK via TWA (Fase 7.1 ✅ antecipada / Fase 7.2 F-Droid pendente)

## 1. Vercel (recomendado pra PWA)

`vercel.json` já está commitado — **fonte de verdade dos headers e config Vercel**. Pra detalhes exatos (CSP restritiva, COOP/COEP, X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, cache rules), ler [`../vercel.json`](../vercel.json) direto. Resumo:

- Build: `framework: vite`, `outputDirectory: dist`
- COOP/COEP em todas as rotas (obrigatórios pra OPFS + `crossOriginIsolated`)
- CSP restritiva alinhada com `tauri.conf.json` (paridade testada em `tests/manifesto-conformance.test.ts`)
- Cache imutável em `/assets/*`; `sw.js` e `manifest.webmanifest` `must-revalidate`

### Setup (uma vez)

```
1. https://vercel.com/new
2. Import Git Repository → EduardoFerr/drift
3. Build settings: deixa default (Vercel detecta Vite e lê vercel.json)
4. Deploy
```

Depois disso, push em `main` faz redeploy. PRs ganham URL de preview automática (`*.vercel.app`).

### Variáveis de ambiente (opcional)

No painel da Vercel → Project → Settings → Environment Variables:

- `VITE_APP_VERSION` — sincroniza com `package.json` (não obrigatório, default `0.5.0`)

### Smoke test pós-deploy

No console do navegador, em `https://<seu-deploy>.vercel.app`:

```js
crossOriginIsolated  // true — caso contrário, OPFS quebra
```

Se `false`, COOP/COEP não estão chegando. Verifique se o `vercel.json` está na raiz e se o deploy é da branch correta.

## 2. GitHub Releases (auditoria + self-host)

Workflow `.github/workflows/release.yml` dispara em tag `v*`:

1. Roda CI completo (tsc + tests + build)
2. Empacota `dist/` em `dist-v<version>.zip`
3. Gera `SHA256SUMS` do zip + `package.json` + lockfile
4. Cria GitHub Release anexando os artefatos

Pra release nova:

```bash
# bump versão em package.json + CHANGELOG.md
git tag -a v0.6.0 -m "v0.6.0 — Phase 5.x"
git push origin v0.6.0
```

A action cuida do resto.

### Self-host a partir do release

```bash
curl -L -O https://github.com/EduardoFerr/drift/releases/download/v0.5.0/dist-v0.5.0.zip
curl -L -O https://github.com/EduardoFerr/drift/releases/download/v0.5.0/SHA256SUMS
sha256sum -c SHA256SUMS
unzip dist-v0.5.0.zip -d /var/www/drift
```

Servir com qualquer servidor estático **com COOP/COEP**.

**Atalho zero-config** (tem `npx`): o `dist.zip` já inclui `serve.json`
com os 2 patterns (`**` + `**/*.*`) que cobrem tanto `/` quanto
subresources tipo `/assets/db.worker-*.js`:

```bash
cd /var/www/drift
npx serve .
# COOP/COEP funciona out-of-box; abrir http://localhost:3000
# Verificar no console: crossOriginIsolated === true
```

**nginx/caddy** (produção):

```nginx
add_header Cross-Origin-Opener-Policy same-origin;
add_header Cross-Origin-Embedder-Policy require-corp;
```

> ⚠ Glob `**/*` sozinho em `serve.json` **não basta** — header chega
> em `/` mas não em `/assets/db.worker-*.js`, e o browser bloqueia o
> worker. Usar `**` + `**/*.*` (incluído).

## 3. Cloudflare Tunnel (dev distante / PWA install em mobile)

Sem instalar nada permanente, só pra teste:

```bash
npm run dev:tunnel        # Vite HTTP plain (porta 5173)
cloudflared tunnel --url http://localhost:5173
```

URL `*.trycloudflare.com` tem cert válido — PWA instala em desktop e mobile sem ajustar trust store. Útil pra testar entre PC e celular antes de fazer deploy real.

## 4. APK Android via TWA (Fase 7 antecipada)

✅ Configurado. Detalhes em [`twa.md`](twa.md). Resumo:

- `app/twa/twa-manifest.json` — config Bubblewrap (host, ícones, shortcuts, signing)
- `public/.well-known/assetlinks.json` — Digital Asset Links (servido pela Vercel)
- `.github/workflows/twa.yml` — build APK + AAB no CI em tag `v*`
- Distribuição: GitHub Releases (sideload direto), F-Droid ([`fdroid.md`](fdroid.md), Fase 7.2), Play Store opcional

Setup pendente (uma vez): gerar keystore, capturar SHA256, popular `assetlinks.json` + secrets no GitHub. Ver `twa.md`.

## Hardening adicional

- **CSP** — ✅ shipado em `vercel.json` (commit `4402acc`, 2026-05-02). Restritiva, `'wasm-unsafe-eval'` permitido pra SQLite WASM, `unsafe-eval` cru proibido. Paridade com `tauri.conf.json` validada em `tests/manifesto-conformance.test.ts`.
- **HSTS** — Vercel adiciona automaticamente em domínios verificados
- **Subresource Integrity (SRI)** — Vite não gera SRI por padrão; trabalho de Fase 7
- **Build reproduzível** — ✅ shipado pra Linux (`Dockerfile.reproducible`, manifesto §17). macOS/Windows ainda pendentes (Fase 7 follow-up).

## Troubleshooting

### `crossOriginIsolated === false` em produção

Headers COOP/COEP não estão chegando. Causas comuns:

1. `vercel.json` não foi deployado (verifique no painel → Source)
2. CDN externo intermediando (Cloudflare Free pode strip-ar headers — desabilitar "Auto Minify" e "Rocket Loader")
3. Iframe parent não cooperando (Drift não roda em iframes por design — X-Frame-Options DENY)

### PWA não instala no celular

1. Cert auto-assinado: usar tunnel (`dev:tunnel`) ou deploy real
2. `start_url` no manifest com path errado
3. Falta ícone PNG 192/512 (verificado — temos)
4. Browser sem suporte (testar Chrome/Edge primeiro)

### Build falha com `EBADENGINE`

Você está em Node < 22. SQLite WASM 3.51.x exige Node ≥22. Atualize com nvm/fnm/volta.
