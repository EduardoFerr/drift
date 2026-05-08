# CI Tauri multi-plataforma — 2026-05-08

**Track:** A.1 — estender CI matrix Tauri pra macOS + Windows
**Persona:** Marshall (schema, types, conformance, CI infra)
**Compromisso:** Manifesto §15 (anti-censura por país via Tor — só roda
em Tauri+arti) e §17 (build reproduzível) — capacidade técnica
preservada cross-platform pros usuários fora de Linux.

---

## Estado anterior

Inventário dos workflows que tocam Tauri:

| Workflow | OS | Quando roda | Escopo |
|---|---|---|---|
| `ci.yml` (job `rust-check`) | Linux only | Todo PR + push | `cargo check` default + `--features arti` |
| `tauri-distribution.yml` | Linux + macOS + Windows | Apenas em tag push (`v*`) | Bundle full (.deb/.AppImage/.dmg/.exe) com `--features arti` |
| `reproducible-build.yml` | Linux Docker | Apenas em tag push | Audit-grade reproduzível |
| `twa.yml` | Linux | Tag push | APK/AAB Android |

**Gap:** PR que toca `src-tauri/**` só passa por Linux `cargo check`.
Quebra em macOS ou Windows só aparece quando o Arquiteto cria a tag
e dispara `tauri-distribution.yml` — caro, lento (~30min) e tarde
demais (já mergeou).

`CLAUDE.md` registrava "Linux ✅; Windows/macOS pendente". Strictly
falando `tauri-distribution.yml` já cobre os 3, mas só em release-time.
A.1 fecha o loop **PR-time**.

## Decisão

Novo workflow `tauri-cross-check.yml` separado de `ci.yml`:

- Matrix `ubuntu-22.04` + `macos-latest` (arm64) + `windows-latest`
- Roda **só `cargo check`** (default + `--features arti`), não bundle
  full — ~4min cold por OS, ~10s warm. Suficiente pra capturar
  regressões de compile cross-platform.
- Trigger restrito a `paths: src-tauri/**` + o próprio workflow file
  → não onera PRs frontend-only.
- `Swatinem/rust-cache@v2` com `shared-key` por plataforma (caches
  são por-OS no GHA mas Swatinem lida com a chave).
- `fail-fast: false` — falha em uma plataforma não cancela as outras
  (queremos saber TODAS que quebraram pra fixar de uma vez).

### Por que não estender `ci.yml`?

Adicionar matrix mac/win em `ci.yml` rodaria em todo PR mesmo
frontend-only. macOS runners são ~10x mais caros (orçamento de
GitHub-hosted runners). Path filter num job filho de matrix ainda
gastaria startup. Workflow separado com `paths:` é o trade clean.

### Por que não bundle full em PR?

Bundle full cross-platform leva ~30min e gera artifacts grandes.
Custo desproporcional vs. ganho em PR (regressões de bundle são
raras; regressões de compile são o caso comum). Bundle full
continua sendo o gate de release em `tauri-distribution.yml`.

### Por que não code-sign nesta fase?

Mesma decisão já documentada em `tauri-distribution.yml` (linhas
13-16): alpha releases não justificam ~$300/ano de cert (Apple
Developer + Windows EV). Cliente vai como "developer build", user
vê Gatekeeper/SmartScreen e segue workaround documentado no README
de release. Track A.2 reabre quando critérios forem satisfeitos
(estabilidade out of alpha + budget aprovado).

## Pre-reqs por plataforma (referência)

### Linux (`ubuntu-22.04`)

```
libwebkit2gtk-4.1-dev
libgtk-3-dev
libayatana-appindicator3-dev
librsvg2-dev
libxdo-dev
libsoup-3.0-dev
pkg-config
file
```

Todas via `apt-get`. Script já no workflow.

### macOS (`macos-latest`, arm64 / Apple Silicon)

- Xcode Command Line Tools — pré-instalado no runner.
- `arti` + `rustls` (preferido sobre `nativetls`/`openssl`) → não
  exige libs nativas extras. Decisão registrada em `Cargo.toml`
  linhas 36-39.
- `libsqlite3-sys` features = `bundled` → compila SQLite from
  source, não precisa Homebrew sqlite. Mesma config Linux/Windows
  → semântica determinística cross-platform (Cargo.toml linhas
  46-54).

**Gotchas conhecidos arti em macOS:**
- arti workspace pula em MSRV ~mensalmente. `dtolnay/rust-toolchain@stable`
  acomoda; pin específico vira jogo de gato e rato (vide cascata
  1.83→1.85→1.88→1.89 documentada em `ci.yml`).
- Intel macOS (`x86_64-apple-darwin`) NÃO está no matrix — `macos-13`
  (Intel) fica pra A.2 quando justificarmos custo. Apple Silicon
  cobre 100% dos macs novos desde 2020.

### Windows (`windows-latest`)

- MSVC toolchain — pré-instalado.
- `libsqlite3-sys` bundled é **obrigatório**. Sem ele: `LINK : fatal
  error LNK1181: cannot open input file 'sqlite3.lib'`. Já forçado em
  `Cargo.toml` linha 54.
- `--bundles nsis` em vez de MSI/WiX em build full — MSI rejeita
  pre-release semver não-numeric (`alpha.3` → erro
  "optional pre-release identifier must be numeric-only"). Detalhes
  em `tauri-distribution.yml` linhas 137-148.
- WiX **NÃO** é necessário pra `cargo check` (este workflow). Só
  em bundle full (`tauri-distribution.yml`), onde NSIS já contorna.

**Gotchas conhecidos arti em Windows:**
- `tokio-tungstenite` com `rustls-tls-webpki-roots` (em vez de
  `native-tls`) → evita dependência de Schannel/openssl para WS
  bridge. Já configurado em `Cargo.toml` linha 60.
- Path separators: scripts usam `bash` shell explícito (Git Bash
  vem com windows-latest runner) onde aplicável.

## Validação local realizada

- [x] YAML parse limpo via `npx js-yaml`:
  - `tauri-cross-check.yml` — keys: name, on, concurrency, permissions, jobs
  - Jobs: `check`, `summary`
  - Matrix platforms: `linux,macos,windows`
- [ ] `actionlint` — não disponível localmente (não instalado). Workflow
  segue padrão dos existentes (`tauri-distribution.yml`,
  `reproducible-build.yml`) que rodam ok em produção.
- [ ] Smoke real do workflow — não executado (custaria ~12min de minutos
  GHA + minutos macOS caros). Deve ser smoke testado num PR de teste
  ou via push pra branch tópica antes de merge.

## Checklist manual pré-merge (Arquiteto)

1. [ ] Abrir PR com este workflow + qualquer mudança trivial em
   `src-tauri/` (ex: comentário em `tor.rs`) pra disparar os 3 jobs.
2. [ ] Confirmar que os 3 jobs (`linux`, `macos`, `windows`) ficam
   verdes na primeira execução cold (~4min cada). Esperado: cache cold
   hit ~3-5min macOS, ~4-6min Windows (NTFS overhead).
3. [ ] Confirmar que cache funciona em re-run: 2ª execução do mesmo PR
   deve cair pra <1min por job.
4. [ ] Validar que PRs frontend-only (mudança em `src/**`) NÃO
   disparam este workflow — testar com PR dummy mudando, p.ex.,
   `src/components/Feed/Feed.tsx`.
5. [ ] Se algum job falhar: fixar local antes de merge. Não merge
   "vou consertar depois" — esse padrão foi exatamente o que motivou
   `rust-check` em `ci.yml` (run 25226715868 escapou).
6. [ ] Atualizar `CLAUDE.md` seção "Filosofia (resumo)" trocando "Windows/macOS pendente"
   por "Windows/macOS validado em PR" — mas só DEPOIS do primeiro
   green run.

## Arquivos tocados

- **Criado:** `.github/workflows/tauri-cross-check.yml`
- **Criado:** `Docs/sessions/ci-tauri-multiplatform-2026-05-08.md` (este arquivo)

Nenhum commit feito. Tudo modificado/untracked pra revisão do Arquiteto.

## Tradeoffs registrados

| Decisão | Alternativa rejeitada | Razão |
|---|---|---|
| Workflow separado `tauri-cross-check.yml` | Estender matrix em `ci.yml` | macOS é 10x custo; path filter granular sem onerar PR frontend |
| `cargo check` only (não bundle) | Bundle full em PR | 4min vs 30min; regressões de bundle são raras |
| `macos-latest` (arm64) só | Adicionar `macos-13` (Intel) | Apple Silicon = 100% macs novos; custo adicional injustificado em A.1 |
| Sem code signing | Adicionar Apple/Windows certs | Decisão herdada de A.2 (alpha não justifica $300/ano) |
| `dtolnay/rust-toolchain@stable` | Pin de versão Rust exata | MSRV arti escala mensalmente; reprodutibilidade vive em Dockerfile.reproducible |
| `Swatinem/rust-cache` shared-key por OS | actions/cache manual | Swatinem já lida com platform isolation + cleanup; menos YAML |

## Status do compromisso de manifesto

§15 anti-censura por país (Tor real via Tauri+arti) e §17 build
reproduzível: **capacidade técnica preservada cross-platform** desde
que green run do workflow se confirme. CLAUDE.md "Filosofia (resumo)"
deve ser atualizado de:

> "Tor ✅ em build Tauri com `--features arti` (smoke e2e VERIFIED 2026-05-01, §15)"
> "build reproduzível ✅ Linux (Fase 6.7); Windows/macOS pendente"

para:

> "build reproduzível ✅ Linux audit-grade (Fase 6.7); macOS/Windows
> validado em PR via cargo check cross-platform (A.1 2026-05-08).
> Bundle full cross-platform via tauri-distribution.yml em release."

Atualização da CLAUDE.md fica como follow-up — não escrita aqui pra
não pre-julgar o resultado do primeiro CI run.
