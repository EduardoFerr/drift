# Sourcemaps Policy — Drift PWA

**Data:** 2026-05-15
**Autor:** Ted v4 (hardening pós-Lighthouse Best Practices)
**Escopo:** prod (build → Vercel deploy)
**Status:** ativo
**Pareia com:** [`csp-policy-2026-05-15.md`](./csp-policy-2026-05-15.md)

---

## TL;DR

Drift NÃO publica sourcemaps em produção. `.map` files são gerados
pelo Vite (modo `'hidden'`) pra debug local opcional mas **deletados
pós-build** por `scripts/strip-sourcemaps.mjs` antes do deploy chegar
no Vercel.

Justificativa: manifesto §4 (anti-telemetria) → Drift não roda Sentry
nem error-tracking remoto, então sourcemap público só vaza
fingerprint do build, paths de dev machine e comentários originais
sem benefício de symbolication. Lighthouse "Best Practices" também
penaliza sourcemap acessível em prod.

---

## Configuração

### 1. Vite build.sourcemap = `'hidden'`

Em `vite.config.ts`:

```typescript
build: {
  // .map files são gerados mas o bundle NÃO inclui
  // `//# sourceMappingURL=` no final. Sem strip, ainda acessíveis
  // por adivinhar `<chunk>.js.map`; com strip (passo 2) somem.
  sourcemap: 'hidden',
}
```

Trade-off vs. `false`:
- `false` → nenhum .map gerado; debug local impossível
- `'hidden'` → .map disponível pré-strip pra debug pontual de um
  build CI (`npm run build && node --inspect ...`); deletado antes
  do deploy
- `true` → .map gerado E referenciado no bundle; rejeitado (S2 Barney)
- `'inline'` → .map embutido no .js; **pior** caso, bundle 10x maior

Mantemos `'hidden'` pra preservar surface area de debug se um bug
prod aparecer só no build minificado — pode rodar `npm run build`,
inspecionar `.map` localmente antes do strip script rodar (ou
comentar o strip pra um build pontual).

### 2. Strip pós-build

`scripts/strip-sourcemaps.mjs` roda automaticamente em
`npm run build`:

```jsonc
// package.json
"build": "tsc -b && vite build && node scripts/strip-sourcemaps.mjs && node scripts/inject-sri.mjs && node scripts/inline-css.mjs && node scripts/preload-fonts.mjs"
```

O script:
- Lê `dist/assets/` e `dist/` raiz
- Deleta TODO arquivo `*.map` (bundle chunks, `sw.js.map`,
  `workbox-*.js.map`)
- Loga total removido (bytes + count) — ~14 MB num build típico

### 3. Defesa em profundidade — conformance test

`tests/sourcemap-stripped.test.ts` valida:
1. `dist/assets/*.map` é zero pós-build
2. `dist/*.map` (sw + workbox) é zero pós-build
3. Nenhum bundle `.js` referencia `//# sourceMappingURL=`
4. `package.json` ainda invoca `strip-sourcemaps.mjs` na chain

Skip se `dist/` ausente (test roda sem `npm run build`). Hard fail
se build rodou mas algum `.map` sobreviveu.

Pareia com `cwv-conformance.test.ts` (mesma estratégia
SKIP_IF_DIST_MISSING).

---

## Como debugar em prod sem sourcemap

### Opção A — Repro local com mesmo build

`npm run build && npm run preview` em local. Mesmo bundle minificado;
sem strip se você comentar a linha temporariamente:

```jsonc
"build": "tsc -b && vite build && /* node scripts/strip-sourcemaps.mjs && */ ..."
```

DevTools carrega `.map` automaticamente quando o `.js` está servido
ao lado. Não comitar essa alteração.

### Opção B — Build CI artifact

`npm run build` em CI gera dist/ completo (com .map antes do strip
do mesmo step). Pra um bug específico, pode-se ressuscitar um
artifact do GitHub Actions release workflow — dist.zip é publicado
mas SEM sourcemaps. Pra acesso a sourcemap, rodar build local do
mesmo SHA.

### Opção C — Logging estruturado client-side

Próxima fase (post-CWV-3): expor um modo dev/staging com
`?debug=1` URL param que liga console verbose em pontos críticos
(`onNostrEvent`, `invalidateFeed`, `publishToRelays`). Não emite
pra serviço remoto — só console local. Manifesto §4 preservado.

---

## Decisões registradas

| # | Decisão | Razão |
|---|---|---|
| 1 | `build.sourcemap: 'hidden'`, não `false` | Mantém debug surface area pré-strip |
| 2 | Strip pós-build via script Node, não plugin Vite | Plugin Vite pra esse seria deps extra; script 80-linhas é mais simples e auditável |
| 3 | Strip também limpa `dist/sw.js.map` + `workbox-*.js.map` | VitePWA gera esses fora do `dist/assets/`; strip cobre os 2 dirs |
| 4 | Sem upload pra Sentry/error tracker | Manifesto §4 anti-telemetria — toda integração remota é "chave mestra disfarçada" §25 |
| 5 | Conformance test guard package.json | Sem ele, alguém poderia remover strip da build chain "limpando scripts" e .map voltariam |

---

## Threat model rejeitado

**"Sourcemap em prod ajuda usuários a reportar bugs com stack
traces"** — Não:
1. Usuário copia stack do DevTools, não importa se simbolizado.
2. Drift não tem canal de bug report (não há Sentry, Discord
   oficial, etc.); manifesto §4 dificulta isso por design.
3. Symbolication serve a desenvolvedor com acesso ao source —
   se você é dev Drift, tem o source local. Se você é
   usuário/atacante, expor minified chunks já é mais do que
   precisa.

**"Sem sourcemap em prod dificulta auditoria externa"** —
Auditoria de código fonte deve usar o repositório Git
(`github.com/eduardo-mf/drift`), não engenharia reversa do .map.
Build reproduzível (Fase 6.7) garante que o dist Vercel casa com
o commit publicado.

---

## Migração

Esta política já está aplicada. Nenhuma ação necessária. Se um
contributor adicionar uma dep que emita .map fora do strip (e.g.,
workers com bundler próprio), atualizar `strip-sourcemaps.mjs`
pra cobrir o novo dir e estender o test.

---

*Última atualização: 2026-05-15 · Ted v4 · CWV-3 sourcemap hardening*
