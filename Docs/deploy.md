# Deploy

Caminhos públicos pra rodar Drift:

1. **Vercel** — PWA hospedada com COOP/COEP corretos e preview por PR
2. **GitHub Releases** — bundle `dist.zip` por tag `v*` pra self-host/auditoria
3. **Cloudflare Tunnel** — dev local exposto via HTTPS válido (já no `dev:tunnel`)
4. **F-Droid / Google Play** — APK via TWA (Fase 5.x.4, futuro)

## 1. Vercel (recomendado pra PWA)

`vercel.json` já está commitado com:

- `framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`
- COOP/COEP headers em todas as rotas (obrigatórios pra OPFS + crossOriginIsolated)
- Cache imutável em `/assets/*` (Vite já hasheia nomes)
- `sw.js` e `manifest.webmanifest` com `must-revalidate` (atualizações de SW funcionam)
- Hardening: X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy no-referrer, Permissions-Policy restritiva (só geolocation=self pra tag de location opt-in)

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

- `VITE_MAPBOX_TOKEN` — pra mapa de espalhamento (Mapbox dá 50k carregamentos/mês free)
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

Servir com nginx/caddy/qualquer servidor estático **com COOP/COEP**:

```nginx
add_header Cross-Origin-Opener-Policy same-origin;
add_header Cross-Origin-Embedder-Policy require-corp;
```

## 3. Cloudflare Tunnel (dev distante / PWA install em mobile)

Sem instalar nada permanente, só pra teste:

```bash
npm run dev:tunnel        # Vite HTTP plain (porta 5173)
cloudflared tunnel --url http://localhost:5173
```

URL `*.trycloudflare.com` tem cert válido — PWA instala em desktop e mobile sem ajustar trust store. Útil pra testar entre PC e celular antes de fazer deploy real.

## 4. F-Droid / Play Store (Fase 5.x.4, futuro)

Plano: TWA (Trusted Web Activity) via [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) embrulhando o PWA já hospedado. Manifest assinado submetido ao F-Droid (build reproduzível) e Play Internal Testing.

Documentação detalhada virá quando o trabalho for executado.

## Hardening adicional (quando virar produção)

- **CSP** — não habilitado por padrão porque WASM precisa `'wasm-unsafe-eval'` e isso requer testes cuidadosos. Adicionar em uma sessão dedicada
- **HSTS** — Vercel adiciona automaticamente em domínios verificados
- **Subresource Integrity (SRI)** — Vite não gera SRI por padrão; trabalho de Fase 5.x ou 6
- **Build reproduzível** — compromisso de manifesto §17, foco da Fase 6.8

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
