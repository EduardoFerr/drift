# TWA (Trusted Web Activity) — APK Android

Embrulha o PWA hospedado em https://drift-wheat-one.vercel.app dentro de uma WebView Chrome num APK Android. O usuário instala como app nativo, sem barra de URL, sem layout de browser.

**Quando usar TWA vs. Capacitor**:
- **TWA** (este doc): apk/aab fininho (~3MB), só carrega o PWA. Atualização via deploy do site (instantânea). Ideal pra Drift porque a UI é toda web.
- **Capacitor** (Fase 5.x.5, opcional): traz Webview controlada + plugins nativos. Maior, mas permite features OS-específicas (Tor nativo, IPFS embarcado, etc — cobre a Fase 6 também).

## Pré-requisitos

- PWA hospedada com HTTPS válido (✅ já temos via Vercel)
- Domínio do PWA conhecido em build-time (atualmente `drift-wheat-one.vercel.app` — se mudar, atualizar `app/twa/twa-manifest.json:host`)
- Manifest da PWA com `id`, `name`, `start_url`, ícones PNG 192/512/maskable (✅ já temos)
- Keystore Android (gerada uma vez — explicado abaixo)

## Setup inicial (uma vez por desenvolvedor)

### 1. Gerar a keystore de release

Em qualquer máquina com Java JDK 17+:

```bash
keytool -genkey -v \
  -keystore drift-release.keystore \
  -alias drift \
  -keyalg RSA \
  -keysize 4096 \
  -validity 36500 \
  -storepass "<KEYSTORE_PASSWORD>" \
  -keypass "<KEY_PASSWORD>" \
  -dname "CN=Drift, O=Drift Project, C=BR"
```

> **Importante**: guarde a keystore + senhas num gerenciador seguro. Se perder, **não há recuperação** — todo APK assinado com ela vira órfão e o app na Play Store/F-Droid não pode mais atualizar (precisa novo `applicationId`).

### 2. Capturar o SHA256 fingerprint

```bash
keytool -list -v -keystore drift-release.keystore -alias drift
```

Procure a linha `SHA256:` no output. É um hex com `:` separadores, ex:

```
SHA256: AB:CD:EF:12:34:56:...:99
```

### 3. Atualizar `assetlinks.json`

Edita [`public/.well-known/assetlinks.json`](../public/.well-known/assetlinks.json), substitui `REPLACE_WITH_SHA256_FINGERPRINT_FROM_KEYSTORE` pelo fingerprint real (mantém os `:`).

Comita e faz push. Vercel vai servir em https://drift-wheat-one.vercel.app/.well-known/assetlinks.json em segundos.

Verifica:

```bash
curl https://drift-wheat-one.vercel.app/.well-known/assetlinks.json
```

Deve retornar o JSON com o fingerprint.

> **Por quê**: Android Asset Verifier (Google) consulta esse arquivo na primeira abertura do TWA. Se o SHA256 do certificado do APK bate com o do JSON, Android confia que o app é autorizado a abrir o domínio sem barra de URL. Se não bate, vira `Custom Tab` (com barra do Chrome).

### 4. Adicionar secrets no GitHub

`Settings → Secrets and variables → Actions → New repository secret`:

```bash
# Keystore em base64 (Linux/WSL/Git Bash):
base64 -w 0 drift-release.keystore | clip                # Windows clip
base64 -w 0 drift-release.keystore | pbcopy              # macOS

# Ou diretamente via gh CLI:
gh secret set ANDROID_KEYSTORE_BASE64 \
  --repo EduardoFerr/drift \
  --body "$(base64 -w 0 drift-release.keystore)"
gh secret set ANDROID_KEYSTORE_PASSWORD \
  --repo EduardoFerr/drift \
  --body "<KEYSTORE_PASSWORD>"
gh secret set ANDROID_KEY_PASSWORD \
  --repo EduardoFerr/drift \
  --body "<KEY_PASSWORD>"
```

Confere com `gh secret list --repo EduardoFerr/drift`. Devem aparecer:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

## Build

### Automático (recomendado)

Tag de versão dispara build:

```bash
git tag -a v0.6.0 -m "v0.6.0"
git push origin v0.6.0
```

Workflow `.github/workflows/twa.yml` faz:

1. Setup Java 17 + Android SDK + Bubblewrap CLI
2. Decodifica keystore dos secrets
3. Sincroniza versão (`appVersionName` = tag, `appVersionCode` = commit count monotônico)
4. `bubblewrap update` + `bubblewrap build` — gera APK assinado + AAB
5. Renomeia pra `drift-vX.Y.Z.apk` / `drift-vX.Y.Z.aab`
6. Anexa ao GitHub Release da tag
7. Sobe também como artifact (retention 30 dias)

### Manual (sem criar tag)

`Actions → twa → Run workflow` no GitHub. Opcional: passar tag existente em `attach_to_release` pra anexar ao Release dela.

### Local (debug, sem CI)

Precisa Java 17 + Android SDK + 5GB livres:

```bash
npm install -g @bubblewrap/cli
cd app/twa
bubblewrap update      # primeira vez gera estrutura Android
bubblewrap build       # builda + assina; pede passwords interativo
```

APK em `app-release-signed.apk`, AAB em `app-release-bundle.aab`.

## Distribuição

### Sideload direto

Download do APK do GitHub Release. No Android: Configurações → Segurança → Permitir fontes desconhecidas → instalar.

Roda como app standalone. Se `assetlinks.json` está correto, sem barra de URL.

### F-Droid

F-Droid build é reproduzível, exige:

1. Toda dependência buildável a partir de fonte (Bubblewrap atende)
2. Manifest em `metadata/com.driftnet.client.yml` no [fdroid/fdroiddata](https://gitlab.com/fdroid/fdroiddata) (PR separada — Fase 5.x.6)
3. Tag `v*` é a build target

### Play Store (opcional, fora do roadmap atual)

Aceita AAB. Política Google exige privacy policy URL no Play Console — apontar pra seção do manifesto Drift no repo. ApplicationId `com.driftnet.client` deve ser único.

## Arquitetura — quando algo dá errado

### TWA abre com barra de URL

Causa: `assetlinks.json` faltando, mal formatado, ou SHA256 não bate com o cert do APK instalado.

Debug:

```bash
# 1. Confere se o JSON tá acessível
curl -sI https://drift-wheat-one.vercel.app/.well-known/assetlinks.json
# Status 200, Content-Type: application/json

# 2. Confere o SHA256 do APK instalado (no Android via adb)
adb shell pm dump com.driftnet.client | grep -A1 "Signing key"

# 3. Valida via Google Asset Links API
curl "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://drift-wheat-one.vercel.app&relation=delegate_permission/common.handle_all_urls"
```

Se Google retorna `delegate_permission/common.handle_all_urls` com seu package — TWA configurado certo. Se retorna vazio ou erro — assetlinks.json tá com problema.

### Build falha com "Keystore não encontrada"

Secrets ausentes ou mal configurados. Workflow valida no início — mensagem do erro indica qual secret falta.

### `bubblewrap build` interativo trava no CI

O workflow passa passwords via `printf` em stdin. Se travar, é provável que Bubblewrap pediu input adicional (ex: confirmação de uso da keystore). Ver log da Action e ajustar.

### Mudei o domínio de deploy — APK abre com barra

Causa: TWA é "selado" no domínio do build. Mudou de `drift-wheat-one.vercel.app` pra outra coisa? Refazer:

1. Atualizar `app/twa/twa-manifest.json:host`
2. Atualizar `app/twa/twa-manifest.json:webManifestUrl`, `iconUrl`, `maskableIconUrl`, `fullScopeUrl`
3. Hospedar `assetlinks.json` no novo domínio
4. Bumpar `appVersionCode` (e `appVersionName`)
5. Build + tag novo

Custom domain estável (`drift.app`, `drift.eduardoferr.dev` etc.) evita esse retrabalho — ver Fase 5.x.8 follow-up.

## Versionamento

| Campo                  | Origem                           | Significado |
|------------------------|----------------------------------|-------------|
| `appVersionName`       | tag git (ex: `0.5.0`)            | exibido pro user |
| `appVersionCode`       | git rev-list count               | monotônico, único; Play Store rejeita downgrade |
| `versionCode` no AAB   | igual `appVersionCode`           | — |

Por que `git rev-list count` em vez de incrementar manual? Idempotente, monotônico, sem state local.
