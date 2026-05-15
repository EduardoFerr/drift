# Supply-chain audit — Drift PWA

**Data:** 2026-05-15
**Revisor:** Barney (peer review crítico, threat modeling)
**Escopo:** dependências npm (direct + transitivas) do cliente PWA. Rust /
`src-tauri/Cargo.lock` está fora do escopo desta auditoria (Fase 6 / Ted).

---

## TL;DR

- **`npm audit`**: 16 vulnerabilidades (0 critical, 5 high, 3 moderate,
  8 low). **Todas** vivem em deps de **build/dev/CI** (vite + esbuild,
  workbox-build via @rollup/plugin-terser, lhci/lighthouse). **Nenhuma**
  vuln em dep runtime client-side enviada para o user. Sem exposição
  direta ao runtime do PWA.
- **Lockfile**: comitado, 100% dos `resolved` URLs apontam para
  `registry.npmjs.org` oficial. Sem mirror suspeito, sem git URL.
- **Pinning**: 1 dep crítica pinada exata (`@sqlite.org/sqlite-wasm`,
  documentado em `CLAUDE.md`). Restante usa `^` (caret), aceitável dado
  que o `package-lock.json` materializa versões reais.
- **SBOM**: não publicado. **Recomendado** gerar via `npm sbom` na CI
  do release workflow (script `scripts/gen-sbom.mjs` adicionado nesta
  PR; integração no CI deixada para próxima sprint).
- **Audit gate na CI**: adicionado job `audit` em `.github/workflows/ci.yml`
  com `--audit-level=high` em modo soft-fail (continue-on-error). Subir
  para hard-fail é trabalho separado (precisa primeiro derrubar os 5
  highs atuais, todos resolvíveis com bump major de `vite` /
  `@lhci/cli`).

Manifesto §17 (sem chave mestra + build reproduzível) implica
auditabilidade. Este doc + SBOM publicável + audit gate são prereqs.

---

## 1. npm audit findings

Output completo gerado em 2026-05-15 com `npm audit --json`.

| Severity | Total | Direct? | Runtime? | Notas |
|---|---|---|---|---|
| critical | 0 | — | — | — |
| **high** | 5 | 0 | **0** | Todas em toolchain de build/CI |
| moderate | 3 | 2 (vite, vite-plugin-pwa) | 0 | Dev server / build only |
| low | 8 | 0 | 0 | Cadeia do `@lhci/cli` (lighthouse) |

### Detalhe — High severity (5)

| Pkg | Advisory | Range vuln | Path | Exploit no Drift? |
|---|---|---|---|---|
| `@babel/plugin-transform-modules-systemjs` | GHSA-fv7c-fp4j-7gwp (RCE em compile-time) | <=7.29.3 | transitiva de toolchain | **Não exploitable**: Drift não usa SystemJS; o plugin existe apenas como dep de outro pacote de toolchain. Atacante precisaria injetar input malicioso no pipeline de build. Vetor restrito ao próprio dev. |
| `@rollup/plugin-terser` → `serialize-javascript` | GHSA-5c6j-r48x-rmvq (RCE via RegExp) | <=0.4.4 | via `workbox-build` | **Não exploitable em runtime**: roda em build-time. Atacante teria que controlar input do workbox config, que é fixo no nosso `vite.config.ts`. |
| `fast-uri` | GHSA-q3j6-qgpj-74h6 (path traversal) + GHSA-v39h-62p7-jpjc (host confusion) | <=3.1.1 | transitiva | Não usado pelo runtime do Drift. |
| `serialize-javascript` | (mesmo do acima) | <=7.0.4 | via workbox | Idem. |
| `workbox-build` | rolls up `@rollup/plugin-terser` | 7.1.0 - 7.4.0 | dev | Build-time. Roda no dev/CI, não no browser do user. |

### Detalhe — Moderate (3)

| Pkg | Advisory | Onde |
|---|---|---|
| `vite` (DIRECT) | GHSA-4w7w-66w2-5vf9 (path traversal `.map` no dev server) | Dev server `npm run dev` — não afeta build prod. Atacante precisa de site malicioso aberto na mesma origem do dev server (`localhost:5173`). Mitigado por uso de `https://` em dev (plugin-basic-ssl) e por não rodar dev server expondo internet. |
| `esbuild` | GHSA-67mh-4wv8-2f99 (CORS no dev server) | Mesmo vetor — dev only. |
| `vite-plugin-pwa` (DIRECT) | depende de vite vuln acima | idem |

### Detalhe — Low (8)

Todas na cadeia `@lhci/cli` (Lighthouse): `inquirer`, `tmp`,
`external-editor`, `lighthouse`, `@sentry/node` (interno do lhci),
`cookie`, `@lhci/utils`. Fix exigiria downgrade major para `@lhci/cli@0.1.0`
(quebraria a configuração atual). Aceitar como dívida — roda só em
GitHub Actions runner, sem dado sensível.

### Avaliação consolidada

**Risco efetivo**: baixo.
- Nenhuma vuln entra no bundle servido ao user (dist).
- Vetor exploitable mais próximo é o dev server vite (moderate),
  contido a `localhost` com HTTPS.
- Atacante precisa controlar input de toolchain — vetor é
  compromise de maintainer / typosquat (cobertos na seção 4), não
  estas CVEs.

---

## 2. Direct dependencies — risk assessment

### Runtime (deps)

| Pkg | Versão | Criticidade | Maintainer | Notas |
|---|---|---|---|---|
| `nostr-tools` | ^2.7.0 | **alta** (signs nsec, verify Schnorr) | fiatjaf + nbd-wtf org | Ativo. Auditado por ecossistema Nostr. |
| `@scure/bip32`, `@scure/bip39` | ^2.2.0 | **alta** (BIP39 → nsec, NIP-06) | Paul Miller (paulmillr) | Reputable, auditado, foco em crypto primitive minimal. Indireto: `@noble/curves`, `@noble/hashes`. |
| `@sqlite.org/sqlite-wasm` | `3.51.2-build9` (PINADO) | **alta** (persiste todo o estado local) | sqlite.org oficial | Único pacote pinado exato — documentado em CLAUDE.md. |
| `react`, `react-dom` | ^18.3.0 | alta | Meta | — |
| `framer-motion` | ^11.0.0 | média (DOM manip / gesture) | framer.com | Ativo. |
| `helia`, `@helia/unixfs`, `blockstore-idb`, `datastore-idb` | ^6.1.4 / ^7 / ^3 / ^4 | média (IPFS, Fase 6+) | ipfs / libp2p org | Ativo. **Auditar antes de Fase 6 final**: libp2p tem superfície grande, vale review separado. |
| `maplibre-gl` | ^5.24.0 | média (renderer; Fase 4) | maplibre.org | Ativo. |
| `@deck.gl/*` | ^9.0.0 | média | Uber/vis.gl | Ativo. |
| `@tauri-apps/api` | ^2.0.0 | média (Fase 6) | Tauri | Ativo. |
| `@fontsource-variable/syne`, `@fontsource/dm-mono` | ^5.2.7 | baixa | fontsource | Estático, fonts. |
| `@tanstack/react-virtual` | ^3.13.24 | baixa | TanStack | Ativo. |
| `browser-image-compression` | ^2.0.2 | baixa | — | **Atenção**: pacote menor, manutenção single-maintainer — candidato a substituição ou fork interno se houver lapso de release. Atualmente sem CVE, sem upgrade pendente. Risco aceito. |
| `qrcode` | ^1.5.4 | baixa | — | Renderiza QR de nsec export. Single-maintainer, estável. |
| `workbox-window` | ^7.0.0 | baixa | Google | Ativo. |
| `zustand` | ^4.5.0 | média | pmndrs | Ativo. |

### DevDependencies

Sem destaque crítico além do que aparece em `npm audit`. `vite`,
`@vitejs/*`, `vitest`, `eslint`, `typescript`, `tailwindcss`,
`postcss`, `autoprefixer` — todos maintainers reputable.

---

## 3. Lockfile health

- `package-lock.json` comitado (verificado em git log).
- `resolved` URLs: 100% `registry.npmjs.org/...` — sem mirror,
  sem git URL, sem `tarball` externo. Confirmado via grep.
- `integrity` hashes (sha512) presentes em todas entries.
- `engines.npm >=10` força lockfile v3 (compatível com hashing
  moderno).

**Sem ação adicional necessária** nesta dimensão.

---

## 4. Threat model

### T1 — Maintainer hijack de dep pequena

**Cenário**: atacante compromete maintainer de `qrcode` (single-maint)
ou `browser-image-compression`. Publica patch release `1.5.5` com
payload que serializa `IndexedDB` de origin `drift.vercel.app` e exfil
via `fetch()`.

**Mitigações em vigor**:
- Lockfile pinado por hash — patch novo só entra com `npm update`
  intencional + revisão de diff.
- CSP estrita (`Docs/security/csp-policy-2026-05-15.md`) bloqueia
  `fetch()` para origens não-whitelisted.
- nsec criptografada em IndexedDB (master key não-exportável) limita
  exfil a *ciphertext*, não plaintext — invariante #8 do CLAUDE.md.

**Gaps**:
- Sem alerta automático em release de dep crítica. **Recomendação
  P2**: Dependabot ou Renovate com `groups: { security: critical }`.

### T2 — Typosquatting

**Cenário**: atacante registra `nost-tools`, `react-doom`,
`@scure/bip399`, etc. Espera que dev confunda em `npm install`.

**Mitigações em vigor**:
- Lockfile é fonte da verdade; PRs que adicionam dep nova passam
  por review humano.
- `package.json` source of truth versionada — diff visível.

**Gaps**:
- Sem hook bloqueando `npm install <pkg>` ad-hoc. Aceitar — review de
  PR é suficiente pra projeto desse tamanho.

### T3 — npm cache poisoning / registry compromise

**Cenário**: registry npm comprometido serve tarball alterado para um
pacote existente.

**Mitigações em vigor**:
- `integrity` sha512 no lockfile detecta tarball alterado — `npm ci`
  falha hash mismatch.
- `npm install` no CI usa cache; CI rebuild from-scratch quando
  Node major bumpa.

**Gap**:
- Hash apenas sha512, sem sha384 (SLSA-style). Aceitável — sha512
  está acima de sha384.

### T4 — Compromise de pacote crítico (nostr-tools)

**Cenário**: maintainer da `nostr-tools` é comprometido. Payload
substitui `generateSecretKey()` para enviar nsec recém-gerado a
endpoint atacante antes de retornar.

**Mitigações em vigor**:
- CSP `connect-src` whitelist relays conhecidos — payload teria que
  abusar de relay legítimo como exfil channel (DM kind 4 para conta
  atacante?). Detectável em audit de network requests.
- Invariante #8: nsec NUNCA sai do dispositivo, NUNCA persiste em
  claro — qualquer side-channel exfil seria desvio observável.

**Gaps**:
- Sem CI test que verifica que `generateSecretKey` é determinístico em
  relação a `crypto.getRandomValues` (impossível de testar — mas
  pode-se snapshot hash do bundle de `nostr-tools` no CI e alertar em
  diff). **Recomendação P3**: SRI baseline para deps críticas (hash da
  dist `nostr-tools`).

---

## 5. Recomendações ranqueadas

| # | Recomendação | ROI | Esforço | Status |
|---|---|---|---|---|
| P1 | `npm audit --audit-level=high` na CI (soft-fail inicial, hard-fail após zerar highs atuais) | alto | 15min | **DONE nesta PR** (job `audit` adicionado em ci.yml, soft-fail) |
| P1 | Script `scripts/gen-sbom.mjs` (wrap `npm sbom --sbom-format=cyclonedx`) | alto | 30min | **DONE nesta PR** |
| P2 | Integrar SBOM no `release.yml` (anexar `sbom.json` aos assets) | alto | 30min | **TODO** — próxima sprint |
| P2 | Bumpar `@lhci/cli` major para zerar 8 lows + cadeia lighthouse | médio | 1h (validar Lighthouse run) | TODO |
| P2 | Bumpar `vite` ou aceitar dev-only moderate como dívida | médio | 2h (revalidar build) | TODO — vite 6/7/8 são major; revisar breakage |
| P3 | Dependabot config com grupos: `security`, `runtime-critical` (nostr-tools, @noble, @scure, sqlite-wasm), `dev` | médio | 1h | TODO |
| P3 | Policy doc formal de update (semver, frequência, gate de review) | baixo | 30min | TODO |
| P4 | SRI baseline de bundle final (hash de chunks crypto) — detecta swap em build CDN | médio | 2h | TODO — já existe `inject-sri.mjs` para HTML; estender |
| P4 | Audit dedicado de `helia`/`libp2p` antes da Fase 6 GA | alto (Fase 6) | 1d | **Bloqueante para Fase 6 final** |

---

## 6. Itens implementados nesta PR

1. **`Docs/security/supply-chain-audit-2026-05-15.md`** (este doc).
2. **`scripts/gen-sbom.mjs`** — gera CycloneDX SBOM via `npm sbom`,
   output em `sbom.json` na raiz. Uso: `node scripts/gen-sbom.mjs`.
3. **`.github/workflows/ci.yml`** — novo job `audit` com
   `npm audit --audit-level=high` e `continue-on-error: true` (soft
   gate). Mover para hard fail quando os 5 highs de toolchain forem
   eliminados (P2).
4. **`Docs/security/supply-chain-policy.md`** — policy de update
   (semver discipline, deps críticas, cadência de audit).

---

## 7. Próximos passos (não nesta PR)

- Anexar `sbom.json` à GitHub Release (release.yml).
- Bumps de major: vite, @lhci/cli.
- Dependabot/Renovate config.
- Audit dedicado helia/libp2p antes de Fase 6 GA.

---

*Audit executado por Barney 2026-05-15. Reproduzir com:
`npm audit --json | jq '.metadata.vulnerabilities'`.*
