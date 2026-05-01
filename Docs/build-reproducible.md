# Build Reproduzível — Verificação

**Manifesto §17**: build reproduzível como garantia. User confere que binário publicado **bate exatamente** com source público disponível em GitHub.

## Por que isso importa

- O fundador do Drift **não pode**, por design, slipping em código malicioso entre source e binário publicado. Build reproduzível torna esse claim verificável.
- Sem reprodutibilidade, o fundador é trust point — viola §17 (resistência ao fundador).
- Com reprodutibilidade, qualquer auditor independente confirma que `dist.zip` que você baixou corresponde ao código auditável no `git tag v0.6.0-alpha.1`.

## Como verificar (5 min, exige Docker)

### Passo 1: clone source na tag desejada

```bash
git clone https://github.com/EduardoFerr/drift.git
cd drift
git checkout v0.6.0-alpha.1
```

### Passo 2: build reproduzível via Docker

```bash
docker buildx build \
  -f Dockerfile.reproducible \
  --target artifacts \
  --output type=local,dest=./local-build \
  --build-arg SOURCE_DATE_EPOCH=1735689600 \
  .
```

Demora 5-30min na primeira vez (Docker pulls + Cargo + npm install + Vite build + Tauri release build). Subsequentes ~2-5min via cache layer.

Output: `local-build/dist/` + `local-build/tauri/` + `local-build/SHA256SUMS`.

### Passo 3: baixe artifacts oficiais do release

```bash
RELEASE=v0.6.0-alpha.1
curl -L -o drift-pwa-published.zip \
  https://github.com/EduardoFerr/drift/releases/download/$RELEASE/drift-pwa-$RELEASE.zip
curl -L -o SHA256SUMS-published \
  https://github.com/EduardoFerr/drift/releases/download/$RELEASE/SHA256SUMS-reproducible
```

### Passo 4: empacote local com mesmas opções determinísticas

```bash
cd local-build/dist
LC_ALL=C find . -type f | LC_ALL=C sort | zip -X -@ ../../drift-pwa-local.zip
cd ../..
```

- `LC_ALL=C` força ordering byte-a-byte sem dependência de locale do host (sem isso, `sort` em ambientes diferentes pode produzir ordens distintas → hashes divergentes).
- `-X` strip extra (`uid/gid`, extra fields ZIP).
- `@` lê file list de stdin, mantém ordem do `sort`.

### Passo 5: compare hashes

```bash
sha256sum drift-pwa-local.zip
grep drift-pwa- SHA256SUMS-published
# Os hashes devem ser **idênticos**.
```

Se bater: binário publicado **é** o código que você auditou.
Se NÃO bater: **investigar**. Pode ser:
- Drift do compilador/toolchain (Rust 1.83.0 minor patch)
- `SOURCE_DATE_EPOCH` divergente
- Modificação no source do release vs source público
- Bug no Dockerfile.reproducible (reportar issue)

## O que está coberto vs não coberto

### Linux PWA build (coberto)
Bit-identical reproduzível. `dist.zip` em qualquer Linux com Docker → mesmo SHA256.

### Linux Tauri build (.deb, .AppImage) (coberto)
Bit-identical reproduzível **se** rodando o mesmo Dockerfile. Cargo + Rust 1.83.0 + glibc bookworm.

### Windows Tauri build (.msi, .exe) (NÃO coberto)
Razões:
- Code signing exige certificado privado do publisher (legítimo gap; signing differs entre publishers honestos)
- Windows-specific timestamps em PE headers
- Solução: 6.7-extension (futuro) — Authenticode signing detached + signature verification separada

### macOS Tauri build (.dmg, .app) (NÃO coberto)
Razões:
- Apple notarization (assinatura cloud da Apple) injeta timestamps remotos
- Code signing similar Windows
- Mesmo plano: signing detached pra futuro

### Identifying-via-hash de source code modificado em runtime (NÃO coberto)
- Service Worker do PWA pode ser cached em browser → user precisa flush cache
- Tauri auto-update (futuro) precisa hash chain do publisher

## Limitações honestas (manifesto §17)

> "Build reproduzível **NÃO** prova que o source não é malicioso — só prova que binário corresponde ao source. Auditoria independente do source é tarefa separada."

- Reprodutibilidade ≠ ausência de backdoor. User precisa **ler** o source pra confirmar isso.
- Reprodutibilidade ≠ source seguro. Ferramentas de scanning (cargo-audit, npm audit) são complementares.
- Reprodutibilidade ≠ supply chain seguro. Crates.io e npm registry são trust points (mitigação: Cargo.lock + package-lock.json com integrity hashes).

## Troubleshooting

### Hash não bate

1. Confirma `SOURCE_DATE_EPOCH=1735689600` em build args
2. Confirma `git checkout` está exatamente na tag (não em `main` que avançou)
3. Roda Docker em Linux real (não WSL2 — Linux native garante glibc consistente)
4. Confere versão do Dockerfile (`grep SOURCE_DATE_EPOCH Dockerfile.reproducible` deve mostrar `1735689600`)

### Docker buildx falha
- `docker buildx create --use` cria um buildx instance
- Versão Docker mínima: 20.10+

### Tauri stage falha
- Sistema host pode estar sem espaço (Tauri build precisa ~5GB livres)
- Se persistir: `docker buildx build --target pwa-builder ...` pra só PWA

## Referências

- [Reproducible Builds Project](https://reproducible-builds.org/) — principles e tools
- `Dockerfile.reproducible` (raiz do repo) — definição completa
- `.github/workflows/reproducible-build.yml` — CI que gera artifacts
- Manifesto §17 — "Resistência ao Fundador"
- Manifesto §31 — "Compatibilidade entre Versões Drift"

## Status atual

| Stage | Reproduzível | Status |
|---|---|---|
| PWA dist | Linux bit-identical | shipped 6.7 |
| Tauri Linux .deb/.AppImage | Linux bit-identical | shipped 6.7 |
| Tauri Windows .msi | signing-dependent | futuro |
| Tauri macOS .dmg | notarization-dependent | futuro |
| F-Droid Android | planned 7.2 | requires F-Droid build infra |
