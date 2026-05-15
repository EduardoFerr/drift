# ADR — Sourcemaps strippados em produção

**Date:** 2026-05-15
**Status:** Accepted (shipped `f34ec0c`, locked-via-test em `06efbce`)
**Manifesto refs:** §4 (anti-telemetria), §17 (sem chave mestra)

## Context

Vite gera `.map` files por default em produção. Esses arquivos:

- Expõem o source TypeScript completo (símbolos não-mangled, paths
  internos, comentários, nomes de variáveis).
- Facilitam reverse engineering do pipeline de identidade e crypto
  (`src/lib/identity.ts`, `src/lib/crypto.ts`, `src/lib/identities.ts`)
  — exatamente os módulos onde adversário ganha mais com clareza.
- Inflam o tamanho do `dist/` em ~14MB (42 arquivos `.map`), prejudicando
  GitHub Release size e tempo de download em redes lentas.

Auditoria Barney (round 5, gap CWV-3) flaggou exposure direta de
sourcemaps em produção como achado de segurança.

## Problem

Três tensões:

1. **Debug em produção.** Devs querem sourcemaps pra investigar crashes
   reais reportados por user. Sem sourcemap, stack trace é
   `chunk-abc123.js:1:54321` — inútil.

2. **Segurança / postura "software-not-service" (§17).** Drift não
   coleta crashes do user (sem Sentry, sem analytics). Sourcemaps
   em prod só servem adversário, não dev — porque dev nunca olha
   pra prod sem reprodução local.

3. **Audit-ability.** Build reproduzível (§17, Fase 6.7) e SRI hashes
   exigem `dist/` determinístico. `.map` files extras introduzem
   variação se não strippados consistentemente.

## Decision

`build.sourcemap = 'hidden'` em `vite.config.ts` (gera mapas mas sem
`//# sourceMappingURL=` no bundle) + `scripts/strip-sourcemaps.mjs`
deleta todo `.map` do `dist/` no post-build.

Pipeline `npm run build` invoca o script automaticamente. Conformance
em `tests/sourcemap-stripped.test.ts` (4 invariantes):

1. `dist/assets/` tem zero `.map`.
2. Nenhum bundle JS contém `sourceMappingURL=`.
3. `package.json build` chama strip script.
4. `vite.config.ts` mantém `sourcemap: 'hidden'` (não `true`).

Devs que precisam debugar reprodução local: rodam `npm run dev` ou
`npm run build:dev` (preserva mapas). Crashes reais em prod são
reproduzidos localmente pelo próprio user (manifesto §4 — user não
manda telemetria; dev não a recebe).

## Consequences

**Positivas:**

- Adversário não tem `lib/crypto.ts` simbolizado em silver platter —
  ataques de reverse-engineering precisam fazer o trabalho.
- `dist.zip` em GitHub Release fica ~14MB menor; download em rede
  lenta / sneakernet ganha.
- Build reproduzível ganha determinismo (sem variação de sourcemap
  entre runs).
- Anti-telemetria virou enforcement: mesmo que alguém adicione Sentry
  acidentalmente, sem sourcemap o stack trace é opaco — telemetria
  fica explicitamente quebrada por design.

**Negativas:**

- Debugging de crash reportado por user é objetivamente mais difícil.
  Compensação: postura honesta em §4 (não coletamos crash report;
  user reproduz localmente se quiser ajudar) + UI de error boundary
  com mensagem clara + caminhos de reset.
- Devs precisam build dev local pra qualquer investigação de prod
  bundle — sem atalho "abre devtools e segue stack". Aceito.

## Alternatives considered

1. **`sourcemap: false`.** Nem gera mapa. Diferença vs `'hidden'`:
   `'hidden'` ainda gera mapa local pra dev poder inspecionar a build
   manualmente. Escolhido `'hidden' + strip` por flexibilidade
   marginal de dev.

2. **Mapas hospedados em URL privada** (S3 separado, acesso só pra
   maintainers). Rejeitado: contradiz "software-not-service" — dev
   teria que manter infra própria; usuário-builder não tem essa
   infra; introduz dependência operacional que viola §17.

3. **Mapas embutidos só em chunks não-críticos** (lib/crypto e
   lib/identity strippados, resto permanece). Rejeitado por
   complexidade — Vite não tem flag granular, e arbitragem caso a
   caso vira buraco. Tudo ou nada.

## References

- `vite.config.ts` — `build.sourcemap = 'hidden'`.
- `scripts/strip-sourcemaps.mjs` — delete pós-build.
- `tests/sourcemap-stripped.test.ts` — 4 invariantes (commit `06efbce`).
- Commits: `f34ec0c` (strip imediato pós-audit Barney), `05ca8ba`
  (hidden sourcemap original), `06efbce` (conformance test).
- Manifesto §4 (anti-telemetria), §17 (sem chave mestra).
