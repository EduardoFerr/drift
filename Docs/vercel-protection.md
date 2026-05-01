# Vercel Deployment Protection — histórico

**Data da decisão**: 2026-04-29
**Autor**: Arquiteto
**Estado atual**: `ssoProtection.deploymentType = "preview"` (Only Preview Deployments)

## Por que existe esta doc

Pra **não esquecer** o que está configurado no Vercel e por quê. O setting de proteção
não vive no repo — fica no Vercel project, gerenciado via API/dashboard. Sem
registrar aqui, daqui 6 meses ninguém lembra qual estado está aplicado nem por que
foi escolhido. Esta doc é o source of truth narrativo (a fonte de verdade técnica
está no Vercel mesmo).

## Sintoma original

User reportou em produção:

```
Manifest fetch from https://drift-19gxuyke7-eduardo-de-moraes-ferreiras-projects.vercel.app/manifest.webmanifest failed, code 401
```

PWA install banner não aparecia. Service Worker não registrava em alguns hostnames.

## Diagnóstico

Vercel tem um setting **Deployment Protection** com 4 modos:

| Modo | API value | Comportamento |
|---|---|---|
| Disabled | `null` | Tudo público |
| Only Preview Deployments | `preview` | Só PRs/branches protegidos; production público |
| **Standard Protection** (default) | `all_except_custom_domains` | Tudo protegido **exceto** domínios custom configurados manualmente |
| All Deployments | `all` | Tudo protegido (inclusive custom) |

**O que estava acontecendo**: o project Drift estava em `all_except_custom_domains`.

Vercel atribui **dois hostnames** pra cada deployment de production:

1. **Custom alias** estável: `drift-wheat-one.vercel.app` (configurado manualmente no Vercel) — público.
2. **Hostname auto-gerado**: `drift-{hash}-eduardo-de-moraes-ferreiras-projects.vercel.app` (mudano a cada deploy) — **bloqueado** pelo `all_except_custom_domains`.

Os dois hostnames servem o mesmo `dpl_*` (mesmo build), mas só o custom passa pelo filtro
de protection. Resultado: top-level navigation no hostname auto-gerado funciona pra
quem está logado no Vercel (cookie SSO via redirect), mas subresource fetch
(`manifest.webmanifest`, assets) falha com `401` porque o cookie não acompanha.

## Decisão tomada

Mudou pra `deploymentType: "preview"` via REST API:

```bash
VTOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.APPDATA+'/com.vercel.cli/Data/auth.json')).token)")
PROJ=prj_nG23izPr9ujL55C6gHqwrQJ8LOzi
TEAM=team_qMPP8YHCvFrZdKkiWZYKlUGS
curl -X PATCH "https://api.vercel.com/v9/projects/$PROJ?teamId=$TEAM" \
  -H "Authorization: Bearer $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssoProtection":{"deploymentType":"preview"}}'
```

Validação:
```
GET drift-19gxuyke7-...vercel.app/manifest.webmanifest → 200 ✅ (era 401)
GET drift-wheat-one.vercel.app/manifest.webmanifest    → 200 ✅
```

## Por que essa decisão (e não reverter)

`Standard Protection` é o default Vercel **pensado pra projetos comerciais**:
cliente paga, deploy de prod é "release oficial", dev quer forçar acesso via domínio
comprado, hostnames auto-gerados são "internal references" pra debug interno.

**Drift não se encaixa nesse perfil**:

- **Open source**: código já em [github.com/EduardoFerr/drift](https://github.com/EduardoFerr/drift).
  Nenhum bit nesses hostnames de prod é privado.
- **Manifesto §17 (sem chave mestra)**: gating de acesso via auth de fornecedor é antitético.
- **Manifesto §16 (disponibilidade distribuída)**: menos fricção pra acessar = melhor.
- **PWA precisa funcionar em qualquer hostname** onde o user pode estar (Service Worker,
  install banner, manifest fetch). Não dá pra prever todas as URLs que vão circular.
- **Sem backend / API surface**: Drift é PWA cliente puro. Não há rota administrativa,
  endpoint privado, ou superfície "secreta" pra esconder.
- **Sem secrets no bundle**: `.env` não vai pro client (Vite só expõe vars `VITE_*`).
- **Source maps já estão públicos** (`/assets/index-*.js.map` retorna 200) desde [0.5.1].
  Coerente com open source — debugging em prod é positivo.

**Previews continuam protegidos**: PRs em revisão, branches em desenvolvimento, e
hotfixes em teste ficam atrás do auth Vercel até serem mergeados pra `main`. Mantém
proteção de "trabalho em andamento" sem bloquear o produto final.

## Como reverter (se algum dia precisar)

### Via API (rápido, exige token CLI logado)

```bash
VTOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.APPDATA+'/com.vercel.cli/Data/auth.json')).token)")
curl -X PATCH "https://api.vercel.com/v9/projects/prj_nG23izPr9ujL55C6gHqwrQJ8LOzi?teamId=team_qMPP8YHCvFrZdKkiWZYKlUGS" \
  -H "Authorization: Bearer $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}'
```

### Via UI (não requer CLI, qualquer admin do project)

1. [vercel.com/eduardo-de-moraes-ferreiras-projects/drift/settings/deployment-protection](https://vercel.com/eduardo-de-moraes-ferreiras-projects/drift/settings/deployment-protection)
2. *Vercel Authentication* → mudar pra **Standard Protection** → *Save*

### Quando faria sentido reverter

- Drift virou produto comercial com tier privado (improvável dado o manifesto).
- Precisa esconder builds de prod específicos pra rollout controlado (use feature flags
  no código em vez disso — mais granular).
- Aviso de incidente de segurança que exija "fechar tudo" como contenção temporária.

## Inspecionar estado atual

```bash
VTOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.APPDATA+'/com.vercel.cli/Data/auth.json')).token)")
curl -sS "https://api.vercel.com/v9/projects/prj_nG23izPr9ujL55C6gHqwrQJ8LOzi?teamId=team_qMPP8YHCvFrZdKkiWZYKlUGS" \
  -H "Authorization: Bearer $VTOKEN" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log(JSON.stringify(d.ssoProtection,null,2))"
```

Esperado hoje:
```json
{ "deploymentType": "preview" }
```

## Hardening opcional (não aplicado)

Se quiser canonicalização SEO sem voltar a auth, dá pra adicionar `X-Robots-Tag:
noindex` em hostnames não-canônicos via `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "has": [{ "type": "host", "value": "(?!drift-wheat-one\\.vercel\\.app$).*" }],
      "headers": [{ "key": "X-Robots-Tag", "value": "noindex" }]
    }
  ]
}
```

**Decisão (2026-04-29):** Não implementar agora. Drift é descoberto via npub/Nostr/sneakernet (manifesto §16/§17), não SEO orgânico. Hardening trivial sem ROI observado hoje. **Trigger pra revisitar**: SEO fragmentado afetar ranking real (Google indexar duplicatas e impactar discovery).

Não foi aplicado — sem urgência. O custo de SEO fragmentado é negligível pra um app
que é descoberto via npub/Nostr, não via Google.

## Cross-references

- [`deploy.md`](deploy.md) — visão geral dos 4 caminhos de deploy (Vercel, GitHub
  Releases, Cloudflare Tunnel, F-Droid/Play).
- [`manifesto.md`](manifesto.md) §16 (disponibilidade distribuída), §17 (sem chave
  mestra), §28 (privacidade pelo mínimo).
- Project ID + team ID estão em `.vercel/project.json` (não-secret, mas commitado
  separadamente do code-base público no `.gitignore` se ele estiver lá — confirmar).
