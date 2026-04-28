# F-Droid — Submissão ao catálogo

**Fase**: 7 (distribuição) — depende de Fase 7.1 (TWA, ✅ feito).

Submeter Drift (`com.driftnet.client`) ao F-Droid: catálogo de apps Android OSS-only, build reproduzível, sem app store proprietária. Manifesto §17 (sem chave mestra na distribuição) ↔ §16 (disponibilidade distribuída).

## 1. Pré-requisitos

| Requisito F-Droid | Status Drift | Ação |
|-------------------|--------------|------|
| Licença OSS-compatible | MIT (`LICENSE`) | OK — declarar `License: MIT` |
| Source público | Repo privado | **Bloqueador** — tornar público antes da MR |
| Sem deps proprietárias em build-time | Bubblewrap (Apache-2.0), Gradle/AGP OSS, MapLibre OSS | OK |
| Sem trackers/analytics não-livres | Sem Firebase/GMS no TWA padrão | Auditar antes da submissão |
| `versionCode` monotônico | `git rev-list --count HEAD` em `twa.yml` | OK |
| Build reproduzível (recomendado) | Bubblewrap pode introduzir não-determinismo | Documentar; tentar via SOURCE_DATE_EPOCH |
| Keystore consistente entre builds | `drift-release.keystore` (gitignored, secrets do GH) | Usar `AllowedAPKSigningKeys` pra preservar assinatura própria |

## 2. Conflitos identificados

- **`VITE_PHOTODNA_KEY` em `.env.example`** — não é usado em `src/` (manifesto v2.2 §25 proíbe scan automático embutido). Remover do `.env.example` antes da submissão pra não confundir reviewers.
- **Mapbox** — ✅ migrado pra MapLibre + tiles CARTO/OSM (v0.5.2). Sem token. OK.
- **Vercel host** referenciado em `twa-manifest.json` — TWA carrega PWA hospedado em SaaS proprietário. F-Droid vai exigir AntiFeature `NonFreeNet`. Honesto declarar — protocolo Nostr é OSS, mas a *hospedagem* atual é Vercel.
  - **Mitigação de longo prazo**: hospedar build estático em GitLab Pages / Netlify / IPFS + domínio próprio (ainda assim NonFreeNet enquanto for SaaS, mas reduz lock-in).
- **TWA + Chrome Custom Tabs** — F-Droid aceita TWAs (precedentes), mas pede que o source do PWA esteja no release.

## 3. Esboço `metadata/com.driftnet.client.yml`

```yaml
Categories:
  - Internet
  - Connectivity
License: MIT
AuthorName: Drift Protocol Contributors
WebSite: https://drift-wheat-one.vercel.app
SourceCode: https://github.com/EduardoFerr/drift
IssueTracker: https://github.com/EduardoFerr/drift/issues
Changelog: https://github.com/EduardoFerr/drift/blob/main/CHANGELOG.md

AntiFeatures:
  NonFreeNet:
    en-US: |
      Trusted Web Activity wrapping a PWA hosted on Vercel
      (proprietary hosting). Backend protocol (Nostr) is OSS;
      client works against any standard Nostr relay.

RepoType: git
Repo: https://github.com/EduardoFerr/drift.git

Builds:
  - versionName: 0.5.2
    versionCode: <git rev-list --count HEAD na tag>
    commit: v0.5.2
    sudo:
      - apt-get update
      - apt-get install -y openjdk-17-jdk expect
    init: npm ci && npm run build
    subdir: app/twa
    build: |
      npm install -g @bubblewrap/cli
      yes "" | bubblewrap update
      yes "" | bubblewrap build --skipPwaValidation
    output: app/twa/app-release-signed.apk

AllowedAPKSigningKeys: <SHA256 do drift-release.keystore>

AutoUpdateMode: Version v%v
UpdateCheckMode: Tags ^v[0-9]
```

`AllowedAPKSigningKeys` mantém a assinatura do dev (consistente com APK do GitHub Releases) — F-Droid não reassina, evita TWA abrir com barra do Chrome.

## 4. CI hook de reprodutibilidade (recomendado)

`.github/workflows/fdroid-check.yml` em PRs:

1. Buildar TWA duas vezes em jobs paralelos
2. Comparar APKs com `diffoscope` ou `apksigner verify` + `unzip` + `sha256sum` (ignorando blocos de assinatura)
3. Falhar se houver divergência em `classes.dex` / `resources.arsc`
4. Publicar relatório como artifact

Causas conhecidas de não-determinismo Bubblewrap: timestamps em `META-INF/MANIFEST.MF`, ordem de entradas no APK ZIP. Mitigar com `SOURCE_DATE_EPOCH` consistente.

## 5. Fluxo de submissão

1. Tornar `EduardoFerr/drift` público
2. Adicionar `fastlane/metadata/android/{pt-BR,en-US}/` com `title.txt`, `short_description.txt`, `full_description.txt`, `images/phoneScreenshots/`, `icon.png`
3. Garantir tag estável (≥ v0.5.2) com APK assinado anexado ao GitHub Release
4. Fork `https://gitlab.com/fdroid/fdroiddata`
5. Adicionar `metadata/com.driftnet.client.yml` (§3)
6. Local: `fdroid lint com.driftnet.client` + `fdroid build --latest com.driftnet.client` (Docker `registry.gitlab.com/fdroid/fdroidserver:buildserver`)
7. Abrir MR em `fdroiddata`, título "New app: com.driftnet.client (Drift)"
8. Review: 1-3 semanas. Responder bot + reviewers
9. Após merge, app aparece em `https://f-droid.org/packages/com.driftnet.client/` no próximo ciclo (~24h)

## 6. Riscos / motivos de recusa

- **Repo privado na submissão** — bloqueio imediato
- **TWA + host SaaS** — reviewers podem questionar. Mitigação: enfatizar que protocolo Nostr é OSS, cliente é offline-first com SQLite-WASM local, funciona contra qualquer relay
- **NonFreeNet** reduz visibilidade default — aceitável e honesto
- **`drift-release.keystore` commitado** — verificado: está fora do git (`.gitignore: *.keystore`). OK.
- **CHANGELOG / fastlane metadata ausente** — atrasa mas não bloqueia
- **`minSdkVersion: 23`** — OK (F-Droid aceita ≥19)

## 7. Quando atacar

Sub-fase de Fase 7 — depois de:
- ✅ TWA estável (v0.5.2 testado em sideload)
- ⏳ Repo público (decisão do user)
- ⏳ APK reproduzivelmente buildável (verificação com diffoscope)
- ⏳ Screenshots reais do app pra fastlane

Sessão dedicada deve durar ~4h (manifest YAML + lint local + MR + iteração com reviewers).
