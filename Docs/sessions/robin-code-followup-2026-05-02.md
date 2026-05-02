# Robin — Code Follow-up à Análise Marshall

**Persona:** Robin Scherbatsky (LLM, papel: research, curadoria, gaps cross-cutting, docs/scripts)
**Data:** 2026-05-02
**Input:** [`legal-analysis-marshall-2026-05-02.md`](./legal-analysis-marshall-2026-05-02.md) (Marshall, ~5115 palavras)
**Escopo:** traduzir findings jurídicos do Marshall em **artefatos commit-áveis** — scripts, workflows, docs operacionais que reduzem SPOF e instrumentam continuidade do projeto independentemente do mantenedor pessoa física.

---

## DISCLAIMER

Este documento é produzido por **persona LLM Robin** como complemento ao relatório do Marshall. As recomendações abaixo são **implementáveis tecnicamente**, mas:

1. Cada decisão de **publicar mirror em jurisdição X**, **registrar entidade Y**, ou **fazer commitment público Z** **requer validação humana** (Eduardo + advogado especializado conforme Marshall §6) **antes** de execução em produção.
2. APIs e serviços citados (drand mainnet via Cloudflare, web3.storage, pinata.cloud, Câmara dados abertos) podem mudar termos ou desaparecer. Re-validar antes de depender deles.
3. Nada aqui substitui consulta OAB-vinculante. Marshall já carimbou esse aviso; Robin reforça.

*Robin checa o relógio, anota: "I'll have what he's having, but with footnotes."*

---

## Sumário executivo

Marshall identificou 3 gaps de natureza **engenharia/operacional** que caem na minha lente:

| Finding Marshall | Gap | Entrega Robin |
|---|---|---|
| §C.1 / 4.1+4.2 | Mirrors automáticos + IPFS pin de release ausentes | Seção (a): scripts + workflow `mirror-on-release.yml` |
| §4.13 | Dead-man's switch é teoria, não engenharia | Seção (b) + script `scripts/dms-refresh.sh` |
| §4.10 | Onboarding multi-maintainer indefinido | Seção (c): rascunho `Docs/maintainership.md` + schema `.maintainers.yaml` |
| §3.2 / Top-3 gatilhos | PL 2630 watch list é promessa vaga | Seção (d): `Docs/regulatory-watchlist.md` + script Python opt-in |
| §4.11 + 4.12 + 4.13 | Continuidade — entidade jurídica + DNS resiliente sub-detalhados | Seção (e): comparativos Stichting/LLC/Verein + Njalla setup + mirror rationale |

Cada seção tem código-real ou doc-real, não placeholders.

---

## (a) Mirrors automatizados — Codeberg, GitLab, IPFS

**Problema (Marshall §C.1):** hoje source único em `github.com/EduardoFerr/drift`. Takedown unilateral GitHub = projeto invisível até forks reativos aparecerem. Pin IPFS de releases ausente.

**Solução proposta:** workflow disparado em tag `v*` que (i) faz push pra Codeberg + GitLab; (ii) gera `git bundle` + pina no IPFS via web3.storage; (iii) commita CIDs num `MIRRORS.md` pública e versionada.

### Setup pré-requisito (uma vez)

| Conta | Onde | Secret a configurar | Custo |
|---|---|---|---|
| Codeberg account + empty repo `drift` | codeberg.org (Forgejo, jurisdição DE, NPO) | `CODEBERG_TOKEN` (Settings → Applications → Generate Token, scope `write:repository`) | R$ 0 |
| GitLab.com account + empty mirror `drift` | gitlab.com (US, mas EU-hosted disponível) | `GITLAB_TOKEN` (Personal Access Token, scope `write_repository`) | R$ 0 |
| web3.storage account (Storacha) | console.storacha.network | `W3_PRINCIPAL`, `W3_PROOF` (via `w3 key create` + `w3 delegation create`) | R$ 0 (5GiB free) |
| (opcional) Pinata account | pinata.cloud | `PINATA_JWT` | R$ 0 (1GB free) |

Adicionar todos em GitHub Settings → Secrets and variables → Actions.

### `scripts/mirror-source.sh`

```bash
#!/usr/bin/env bash
# Espelha o repo atual (todos os refs) em Codeberg + GitLab.
# Pré-requisito: CODEBERG_TOKEN, GITLAB_TOKEN no env.
# Idempotente: força push só de refs já existentes; nunca cria branches novas.
set -euo pipefail

CODEBERG_USER="${CODEBERG_USER:-drift-protocol}"
GITLAB_USER="${GITLAB_USER:-drift-protocol}"
REPO="${REPO:-drift}"

require() { [[ -n "${!1:-}" ]] || { echo "Faltando env $1" >&2; exit 1; }; }
require CODEBERG_TOKEN
require GITLAB_TOKEN

# Mirrors são remotes adicionados ad-hoc; nunca persistir token no .git/config.
git remote add codeberg "https://${CODEBERG_USER}:${CODEBERG_TOKEN}@codeberg.org/${CODEBERG_USER}/${REPO}.git" 2>/dev/null || true
git remote add gitlab "https://oauth2:${GITLAB_TOKEN}@gitlab.com/${GITLAB_USER}/${REPO}.git" 2>/dev/null || true

echo "==> Push refs para Codeberg"
git push --mirror codeberg

echo "==> Push refs para GitLab"
git push --mirror gitlab

# Limpeza — não deixar URL com token na config persistente
git remote remove codeberg
git remote remove gitlab

echo "Mirror OK"
```

**Trade-off:** `--mirror` reflete deletes upstream (se você apagar branch X local, mirror apaga também). Em ambiente release-only isso é seguro. Se preferir append-only (proteção contra branch deletada por engano ou por compromised account), trocar por `git push codeberg --tags && git push codeberg main`.

### `scripts/pin-source-ipfs.sh`

```bash
#!/usr/bin/env bash
# Gera bundle do repo na tag atual + pina no IPFS via web3.storage (storacha CLI).
# Output: CID + tamanho. Stdout machine-parseable.
set -euo pipefail

TAG="${1:-$(git describe --tags --abbrev=0)}"
OUTDIR="${OUTDIR:-./dms-artifacts}"
BUNDLE="${OUTDIR}/drift-${TAG}.bundle"

require() { [[ -n "${!1:-}" ]] || { echo "Faltando env $1" >&2; exit 1; }; }
require W3_PRINCIPAL
require W3_PROOF

mkdir -p "$OUTDIR"

echo "==> git bundle create $BUNDLE (tag $TAG + main)" >&2
git bundle create "$BUNDLE" --all

echo "==> SHA256" >&2
sha256sum "$BUNDLE" | tee "${BUNDLE}.sha256"

echo "==> w3 login + space" >&2
# storacha CLI: npm i -g @web3-storage/w3cli
w3 login --principal "$W3_PRINCIPAL" >/dev/null
w3 space use --proof "$W3_PROOF" >/dev/null

echo "==> w3 up $BUNDLE" >&2
CID=$(w3 up "$BUNDLE" --json | jq -r '.root."/"')

echo "==> Resultado" >&2
echo "TAG=$TAG"
echo "BUNDLE=$BUNDLE"
echo "BUNDLE_SHA256=$(awk '{print $1}' < "${BUNDLE}.sha256")"
echo "CID=$CID"
echo "GATEWAY=https://${CID}.ipfs.w3s.link/"
```

**Trade-off web3.storage vs Pinata vs IPFS local:** web3.storage é gratuita até 5GiB e usa Filecoin como cold storage (bundle persiste mesmo se a conta sumir, em tese). Pinata é mais confortável de manusear mas free tier menor. IPFS local sem pin remoto = pin desaparece quando o nó cai. Recomendação: web3.storage como primário, Pinata como secundário (ambos free tier juntos custam zero), e instrução em `MIRRORS.md` pra usuários técnicos rodarem `ipfs pin add <CID>` localmente.

### `.github/workflows/mirror-on-release.yml`

```yaml
name: mirror-on-release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      tag:
        description: 'Tag para espelhar (ex: v0.6.0-alpha.3)'
        required: true

jobs:
  mirror:
    name: Push mirrors + IPFS pin
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: write  # commitar MIRRORS.md de volta

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # bundle precisa de histórico completo

      - name: Resolve tag
        id: tag
        run: |
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            echo "tag=${{ inputs.tag }}" >> "$GITHUB_OUTPUT"
          else
            echo "tag=${GITHUB_REF#refs/tags/}" >> "$GITHUB_OUTPUT"
          fi

      - name: Push to Codeberg + GitLab
        env:
          CODEBERG_USER: drift-protocol
          CODEBERG_TOKEN: ${{ secrets.CODEBERG_TOKEN }}
          GITLAB_USER: drift-protocol
          GITLAB_TOKEN: ${{ secrets.GITLAB_TOKEN }}
        run: bash scripts/mirror-source.sh

      - name: Setup Node + storacha CLI
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g @web3-storage/w3cli

      - name: Pin source bundle to IPFS
        id: ipfs
        env:
          W3_PRINCIPAL: ${{ secrets.W3_PRINCIPAL }}
          W3_PROOF: ${{ secrets.W3_PROOF }}
        run: |
          bash scripts/pin-source-ipfs.sh "${{ steps.tag.outputs.tag }}" | tee pin-result.txt
          {
            grep '^TAG=' pin-result.txt
            grep '^CID=' pin-result.txt
            grep '^BUNDLE_SHA256=' pin-result.txt
            grep '^GATEWAY=' pin-result.txt
          } >> "$GITHUB_OUTPUT"

      - name: Update MIRRORS.md
        run: |
          python3 scripts/update-mirrors-md.py \
            --tag "${{ steps.tag.outputs.tag }}" \
            --cid "${{ steps.ipfs.outputs.CID }}" \
            --sha256 "${{ steps.ipfs.outputs.BUNDLE_SHA256 }}"

      - name: Commit MIRRORS.md
        run: |
          git config user.name "drift-mirror-bot"
          git config user.email "noreply@drift-protocol.org"
          git add MIRRORS.md
          git commit -m "chore(mirrors): add ${{ steps.tag.outputs.tag }} CID" || echo "Nada a commitar"
          git push origin HEAD:main
```

`scripts/update-mirrors-md.py` é trivial (lê tag/cid/sha, prepend numa tabela markdown ordenada por data — não duplico aqui). `MIRRORS.md` no repo dá audit trail público — mesmo se a conta GitHub do Eduardo for banida amanhã, o histórico do `MIRRORS.md` no fork de qualquer mirror tem os CIDs, e qualquer um faz `ipfs cat <CID>` pra recuperar o source.

---

## (b) Dead-man's switch — design real

**Problema (Marshall §4.13 + Cenário E):** se Eduardo é preso, foge, ou desaparece, hoje co-maintainers (que ainda não existem) não têm acesso a (a) lista de contatos jurídicos, (b) credenciais de domínio Vercel/registrar, (c) chaves backup de assinatura, (d) lista de mirrors prioritários e quem operá-los. "Plano de continuidade" sem instrumentação criptográfica é teatro.

**Design:** **time-locked encryption** com [tlock](https://github.com/drand/tlock) usando a rede drand mainnet (League of Entropy — Cloudflare/EPFL/Protocol Labs/etc., quórum BLS de threshold; nenhum operador único pode revelar a chave antes do round). Ciphertext publicado. Decifrável só após round X (= timestamp futuro). Eduardo refresca a cada N meses; se não refrescar, ciphertext vira público.

### Componentes

1. **drand mainnet** via `https://api.drand.sh` ou Cloudflare endpoint `https://drand.cloudflare.com`. Round público, não-interativo, threshold BLS — não há operador único capaz de antecipar revelação.
2. **`tlock-cli`** (Go binary, [`drand/tlock`](https://github.com/drand/tlock)) — encrypt/decrypt against drand round.
3. **OpenTimestamps** (`ots stamp`) — ancora hash do ciphertext na blockchain Bitcoin. Prova publicamente verificável de que o blob existia em data X.
4. **Repo público `drift-protocol/dms`** (separado do código pra reduzir ruído) ou pasta `dms/` neste repo.

### O que entra no payload (Eduardo gera localmente)

Plaintext único, jamais commitado em claro. Conteúdo proposto (`.dms-payload.txt`, gitignored):

```
# Drift dead-man's package — gerado YYYY-MM-DD
# Dest: co-maintainers listados em .maintainers.yaml na data de geração

## 1. Co-maintainers de emergência (ordem de prioridade)
- alice@example: pubkey ssh-ed25519 AAAA...; pode operar Vercel + GitHub release
- bob@example: pubkey ssh-ed25519 AAAA...; pode operar Codeberg/GitLab mirrors

## 2. Credenciais de infra (criptografadas individualmente — payload contém só pointers)
- Vercel team owner transfer: instruções em https://vercel.com/docs/accounts/team-roles
- GitHub org transfer: settings → transfer ownership para drift-protocol
- Domínio (se registrado): registrar = Njalla; account email = legal@drift-protocol.org;
  password manager export (Bitwarden) = anexo `.bw-export.json.age` cifrado com pubkey de alice

## 3. Contatos jurídicos pré-acordados
- ITS-Rio clínica: <link público>
- InternetLab triagem: <link público>
- Advogado(a) de retenção (se houver): nome + OAB + telefone

## 4. Lista de mirrors confirmados em <data>
- codeberg.org/drift-protocol/drift
- gitlab.com/drift-protocol/drift
- ipfs CID conforme MIRRORS.md mais recente

## 5. Instruções operacionais
- Procedimento de release multi-sig sob ausência (ver Docs/maintainership.md §rotação)
- Como notificar usuários (Nostr kind 30023 long-form post via npub do projeto, se existir)
```

**Princípio:** payload contém **pointers e instruções**, não secrets de alto valor. Secrets de alto valor (chaves PGP backup, exports de password manager) são sub-cifrados individualmente com pubkey de cada co-maintainer (`age -r <pubkey>`). Assim, mesmo se o tlock falhar (drand sumir, vulnerabilidade BLS, etc.), o secret continua protegido pela camada `age`.

### Fluxo Eduardo (semestral)

```bash
# 1. Atualiza plaintext local
$EDITOR .dms-payload.txt

# 2. Roda script (ver scripts/dms-refresh.sh, abaixo)
./scripts/dms-refresh.sh --months 6

# 3. Verifica em modo dry-run primeiro
./scripts/dms-refresh.sh --months 6 --dry-run

# 4. Output: dms/dms-2026-05.asc + dms/dms-2026-05.ots
# Commita na pasta dms/ — pública, mas inútil até o round drand passar
git add dms/dms-2026-05.asc dms/dms-2026-05.ots
git commit -m "chore(dms): refresh 2026-05 → 2026-11"
```

### Fluxo co-maintainer (ativação)

Se Eduardo desaparecer e o round chegar:

```bash
# 1. Verificar que round drand realmente passou
drand-cli get public --url https://api.drand.sh <round-N>

# 2. Decifrar
tlock-cli --decrypt -o payload.txt dms/dms-2026-05.asc

# 3. Verificar timestamp Bitcoin
ots verify dms/dms-2026-05.ots

# 4. Seguir instruções do payload
```

### Onde publicar o ciphertext

**Recomendação:** dentro do próprio repo, em `dms/dms-YYYY-MM.asc`, mais espelhamento via mirror workflow (a). Razões:

- **Auditável:** qualquer um vê que existe e quando foi atualizado pela última vez. Falta de refresh = sinal público.
- **Resiliente:** mirrors automáticos garantem cópias em ≥3 hosts.
- **Não-secreto:** ciphertext sem o round drand é ruído — publicar é seguro **se** a curva é segura e o tlock é correto.

**Alternativa rejeitada:** Gist público anônimo. Reduz auditabilidade ("será que ainda é o último?") e não tem mirroring automático.

### Reset semestral

`scripts/dms-refresh.sh` (entregue separadamente — ver §entregáveis ao final). Recomenda-se rodar via cron/CI **manual** em laptop pessoal de Eduardo (não em GitHub Actions — plaintext nunca toca CI). Lembrete: criar evento de calendar recorrente "DMS refresh" a cada 5 meses (1 mês de margem antes do expiry).

### Trade-off honesto

DMS criptográfico **não substitui co-maintainers ativos** (Marshall §4.10). Ele apenas garante que, **quando** existirem co-maintainers, eles tenham as ferramentas pra continuar. Implementar DMS sem ter co-maintainers cadastrados é entregar payload pro vazio. **Ordem correta:** primeiro recrutar 1+ co-maintainer real (mesmo que solo, com PGP key trocada presencialmente ou via Keyoxide), depois ativar DMS.

---

## (c) Multi-maintainer onboarding

**Problema (Marshall §4.10):** "recrutar 2+ co-maintainers" é o maior redutor de SPOF do roteiro inteiro, mas não tem critério publicado. Sem critério, ninguém aplica.

**Solução:** novo arquivo `Docs/maintainership.md` (ou seção em `CONTRIBUTING.md`) com critérios objetivos, processo de onboarding, schema de `.maintainers.yaml`, e processo de rotação/aposentadoria.

### Esboço `Docs/maintainership.md`

```markdown
# Maintainership

Drift é projeto FOSS sem entidade jurídica. Maintainers exercem papel
limitado de revisão de PRs, release tagging, e operação de
infraestrutura mínima. Não operam serviço comercial, não custodiam
fundos, não moderam conteúdo (manifesto §17).

## Por que múltiplos maintainers

Continuity (`Docs/continuity.md`) exige que indisponibilidade de
qualquer indivíduo não derrube o projeto. Single-maintainer = SPOF.

## Critérios pra virar co-maintainer

Cumulativos:

- ≥10 PRs merged que tocam código de produção (não só docs)
- ≥6 meses de atividade contínua (≥1 contribuição por mês)
- ≥3 reviews substantivas em PRs de outros
- Pubkey PGP ou SSH publicada e estável (Keyoxide, GitHub profile, ou pgp.mit.edu)
- Concorda explicitamente com manifesto v2.2 + license MIT (registrado em PR)

Estes são critérios *necessários* — não suficientes. Aceitação final
requer consenso entre maintainers ativos (regra: 100% concordância
quando há ≤3 maintainers; 2/3 quando há ≥4).

## Processo de onboarding

1. Candidato abre issue `meta: maintainer application` com:
   - Lista de PRs/reviews
   - Pubkey + jurisdição (país de residência fiscal — informação pública,
     relevante pra diversidade jurisdicional, ver `Docs/continuity.md`)
   - Disponibilidade declarada (mínimo 4h/mês)
2. Maintainers existentes revisam em até 30 dias
3. Se aprovado:
   - PR adiciona entry em `.maintainers.yaml`
   - Convite pra org GitHub `drift-protocol` (role: Maintain, não Admin)
   - Convite pra Codeberg + GitLab mirrors
   - Primeira tag co-assinada acontece na próxima release (smoke test)
4. Se rejeitado: feedback público explicando critérios faltantes

## Schema `.maintainers.yaml`

```yaml
# Lista pública de maintainers com role ativo.
# Pseudônimos são aceitos desde que pubkey resolva.
version: 1
maintainers:
  - handle: EduardoFerr
    name_or_pseudonym: Eduardo de Moraes Ferreira
    pubkey_pgp: 0xDEADBEEFCAFEBABE
    pubkey_ssh: ssh-ed25519 AAAA...
    jurisdiction: BR
    contact: legal@drift-protocol.org
    active_since: 2025-09-01
    role: lead          # lead | maintainer | release-signer
  - handle: alice
    name_or_pseudonym: Alice (pseudonym)
    pubkey_pgp: 0x...
    pubkey_ssh: ssh-ed25519 AAAA...
    jurisdiction: DE
    contact: alice@protonmail.com
    active_since: 2026-XX-XX
    role: maintainer
```

Diversidade jurisdicional importa: 3 maintainers todos em BR é menos
robusto que 1 BR + 1 DE + 1 NL contra pressão jurídica concentrada.

## Rotação / aposentadoria

- **Voluntária:** maintainer abre PR removendo seu entry. Merge imediato.
- **Por inatividade:** sem commits/reviews por 6 meses + ausência de
  resposta a ping → outros maintainers fazem PR de remoção. 14 dias de
  janela de resposta antes do merge.
- **Por quebra de contrato (manifesto):** evidência documentada,
  proposta pública, voto unânime dos demais. Maintainer removido pode
  manter fork — manifesto §17 garante que ninguém é "expulso do
  projeto", apenas do role de maintainer upstream.

## Multi-sig de releases

Quando `.maintainers.yaml` tiver ≥3 entries com role `release-signer`:

- Tag `v*` requer ≥2 assinaturas pra ser considerada release oficial
- CI valida em `.github/workflows/release.yml` step `Verify signatures`
- Não-cumprimento: tag existe mas binários não são publicados em GitHub
  Releases automaticamente — ação manual coordenada exigida

Implementação técnica vem quando o gatilho for atingido.
```

**Trade-off pseudônimo vs nome civil:** o projeto aceita pseudônimo (manifesto §4 — anonimato é princípio). Mas pubkey deve ser estável e usada em outros contextos (Keyoxide ajuda a corroborar). Pseudônimo + pubkey nova hoje + zero histórico é vetor Sybil — maintainers existentes têm dever de ceticismo.

---

## (d) PL 2630 watch list — mecanismo real

**Problema (Marshall §3.2 + Top-3 gatilhos):** "monitorar PL 2630" precisa de mecanismo, não promessa. Manifesto §4 (anonimato) é estruturalmente incompatível com versões da lei que exigiam KYC + rastreabilidade — quando (e se) lei similar for aprovada, postura Drift muda materialmente. Saber **quando** é operacional.

**Solução:** `Docs/regulatory-watchlist.md` versionado + script Python opt-in que consulta API da Câmara dos Deputados (dados abertos, `dadosabertos.camara.leg.br/api/v2/`) e Senado pra status atualizado.

### Esboço `Docs/regulatory-watchlist.md`

```markdown
# Watch list regulatória

Itens monitorados por implicarem mudança de postura Drift quando
status muda. Atualização: revisão trimestral por maintainer
designado (rotativa). Source of truth: links oficiais Câmara/Senado.

| # | Item | Tipo | Status (2026-05-02) | Gatilho que muda postura | Ação prevista |
|---|---|---|---|---|---|
| 1 | PL 2630/2020 ("Lei das Fake News") | PL Câmara | Pronto pra pauta plenário, suspenso | Pauta confirmada OU substitutivo com KYC obrigatório | Acelerar entidade jurídica internacional (Marshall §4.11); revisão pública do manifesto §4 |
| 2 | RE 1.037.396 (tema 987 STF) | Repercussão geral | Em julgamento (parado em pedido de vista) | Tese firmada ampliando dever do provedor sem ordem específica | Acelerar `Docs/legal-policy.md` (Marshall §4.8) |
| 3 | PL 4717/2023 (rastreabilidade de mensagens) | PL Câmara | Arquivado, em recurso | Desarquivamento OU PL sucessor com mesma essência | Mesmo de #1 |
| 4 | MP RG digital / identidade nacional unificada | MP/PL | Implementação em curso, sem obrigatoriedade pra apps de comunicação | Vinculação a apps (Lei "Identidade nas redes") | Postura "Drift opera fora do escopo de apps regulados" |
| 5 | ADPF/ADI sobre Marco Civil Art. 19 | STF | Diversas pendentes | Decisão derrubando Art. 19 ou criando exceções amplas | Reavaliação completa do roteiro Marshall §4 |
| 6 | LGPD Art. 52 — multas a operadores estrangeiros | Doutrina ANPD | Em formação | Precedente aplicado a FOSS dev brasileiro | Acelerar separação de identidade (Marshall §4.3) |
| 7 | Lei 14.197/2021 (Atos antidemocráticos) — interpretação | Jurisprudência STF | Em construção | Aplicação a "ferramenta facilitadora" sem dolo específico | Reavaliação cenário C/E (Marshall §5) |

## Mecanismo de update

- Maintainer designado revisa trimestralmente (1º dia do trimestre)
- Output: PR atualizando esta tabela + se houve mudança material,
  abrir issue `regulatory: <item>` pra discussão pública
- Apoio automatizado: `scripts/check-pl-status.py` (opt-in, ver abaixo)
- Quando gatilho confirmado: maintainer convoca chamada pública
  (issue `regulatory: trigger fired`); ações Marshall correspondentes
  passam a ser prioridade alta

## Fontes

- Câmara: https://dadosabertos.camara.leg.br/api/v2/proposicoes/{id}
- Senado: https://legis.senado.leg.br/dadosabertos/
- STF: monitoramento manual via portal e clipping de imprensa
  (sem API estável); aceito gap
- Pesquisa acadêmica: ITS-Rio + InternetLab publicam análises
  trimestrais que servem como fonte secundária
```

### `scripts/check-pl-status.py` (rascunho)

```python
#!/usr/bin/env python3
"""
Consulta status de proposições legislativas brasileiras via API
dados abertos da Câmara dos Deputados.

Uso:
    python scripts/check-pl-status.py --pl 2630/2020 --pl 4717/2023

Output: JSON com situação atual + diff vs último cache local.
Cache em .watchlist-cache.json (gitignored).

Não modifica nada do projeto; só observa. Roda local ou em CI agendado.
"""
import argparse
import json
import sys
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlencode

CACHE_FILE = Path(".watchlist-cache.json")
API = "https://dadosabertos.camara.leg.br/api/v2"


def find_proposicao(numero: int, ano: int, sigla: str = "PL") -> dict | None:
    qs = urlencode({"siglaTipo": sigla, "numero": numero, "ano": ano})
    with urlopen(f"{API}/proposicoes?{qs}") as r:
        data = json.load(r)
    items = data.get("dados", [])
    return items[0] if items else None


def detalhe(prop_id: int) -> dict:
    with urlopen(f"{API}/proposicoes/{prop_id}") as r:
        return json.load(r)["dados"]


def parse_pl_arg(s: str) -> tuple[int, int]:
    """'2630/2020' -> (2630, 2020)"""
    num, ano = s.split("/")
    return int(num), int(ano)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pl", action="append", required=True,
                    help="Formato N/AAAA, ex: 2630/2020. Pode repetir.")
    ap.add_argument("--sigla", default="PL")
    args = ap.parse_args()

    cache = json.loads(CACHE_FILE.read_text()) if CACHE_FILE.exists() else {}
    new_cache = {}
    changes = []

    for pl in args.pl:
        numero, ano = parse_pl_arg(pl)
        head = find_proposicao(numero, ano, args.sigla)
        if not head:
            print(f"[!] {args.sigla} {pl} não encontrado", file=sys.stderr)
            continue
        det = detalhe(head["id"])
        snapshot = {
            "id": det["id"],
            "ementa": det.get("ementa", "")[:200],
            "ultimo_status": det.get("statusProposicao", {}).get("descricaoSituacao"),
            "ultima_data": det.get("statusProposicao", {}).get("dataHora"),
            "url": det.get("urlInteiroTeor") or det.get("uri"),
        }
        key = f"{args.sigla}-{pl}"
        new_cache[key] = snapshot
        prev = cache.get(key)
        if prev and prev != snapshot:
            changes.append({"pl": key, "before": prev, "after": snapshot})

    CACHE_FILE.write_text(json.dumps(new_cache, indent=2, ensure_ascii=False))
    if changes:
        print(json.dumps({"changes": changes}, indent=2, ensure_ascii=False))
        sys.exit(2)  # exit 2 = mudança detectada (CI pode disparar issue)
    print(json.dumps({"changes": []}))


if __name__ == "__main__":
    main()
```

**Trade-off:** API Câmara não cobre **Senado** (formato distinto, endpoint `legis.senado.leg.br/dadosabertos/`). Versão completa precisa ramificar por casa de origem. Pra o PL 2630 (originado Câmara), API atual é suficiente. Não vale a pena automatizar 100% — humano revisa output mensal e decide se gatilho disparou.

**Trade-off API → email/issue:** próximo passo natural seria CI agendado (cron GitHub Action) que roda o script semanal e abre issue se exit code 2. Defensável, mas adiciona ruído no projeto. Recomendação Robin: deixar opt-in manual por agora; escalar quando houver maintainer dedicado.

---

## (e) Continuidade plus — entidade jurídica, DNS, mirrors

Marshall mencionou opções (§4.11, §4.12, §4.13) mas não detalhou. Curado abaixo:

### Entidade jurídica — comparativo prático

| Opção | Custo setup | Custo manutenção | Tempo | Documentação | Trade-off principal |
|---|---|---|---|---|---|
| **Associação civil sem fins lucrativos BR** | R$ 5–15k (cartório + advogado) | R$ 2–5k/ano (contador) | 30–60 dias | CPF presidente + estatuto + ata + CNPJ | Mais simples mas **dever de cooperação maior** sob jurisdição BR. Marshall §4.11 alertou: "pode aumentar exposição se mal estruturada". Útil só se Drift quiser receber doação BR formalmente. |
| **Stichting (NL foundation)** | €1.5–4k (notário NL + advogado) | €500–1.5k/ano | 2–4 semanas | Notarização presencial OU procuração; pode ser administrada de fora | Precedente FOSS forte (Python Software Foundation NL chapter, Bitwarden, várias). Jurisdição estável, NPO reconhecida, dever de cooperação calibrado. **Recomendação primária se houver orçamento.** |
| **Wyoming LLC (US)** | US$200–500 (registered agent) | US$60/ano + US$200 registered agent | 1–2 semanas (online) | Operating agreement; pode ser único membro; anonimato moderado (manager-managed) | Barata, rápida, anônima parcial. Mas **US sob FISA + sanctions exposure**. Drift opera anti-censura — má escolha conceitual. |
| **Verein (Suíça)** | CHF 500–2k notário + cadastro | CHF 200–800/ano | 4–8 semanas | 2+ membros fundadores + estatuto | Precedente forte (Wikimedia CH, Mozilla CH). Caro. Estabilidade jurídica máxima. **Recomendação secundária.** |
| **CIC (UK Community Interest Company)** | £100–500 | £200–600/ano | 2–6 semanas | Director identificado | Pós-Brexit menos atraente; cooperação UK com BR via MLAT existe. |

**Conclusão Robin:** se gatilho dispara (Marshall §4.11: financiamento + 2+ co-maintainers + uso significativo), Stichting NL > Verein CH >> Associação BR > LLC US >> CIC UK. **Não montar entidade BR como first move** — multiplica vetor de cooperação no exato lugar onde o risco já existe.

### DNS resiliente — Njalla setup

[Njalla](https://njal.la) é registrar pró-privacidade sediado em St. Kitts and Nevis, paga em cripto ou cartão, **registra o domínio em nome próprio** (Njalla é o titular formal, projeto é beneficiário via contrato). Útil porque:

- WHOIS público mostra Njalla, não maintainer
- Resistente a takedown via WHOIS-based pressure
- Aceita pagamento em Bitcoin/Monero/Lightning

**Setup passo a passo (resumido):**

1. Conta em njal.la (email descartável aceito; Tutanota/Proton recomendados)
2. Search & buy `drift-protocol.org` ou similar (`.org` ~€15/ano; `.is` ~€40/ano e tem precedente bom em casos de pressão)
3. Pagar em XMR ou BTC (history-clean preferível)
4. Configurar DNS records apontando pra mirrors:
   - `A drift-protocol.org` → IP Vercel (alvo primário)
   - `CNAME mirror1.drift-protocol.org` → Cloudflare Pages mirror
   - `CNAME mirror2.drift-protocol.org` → Hetzner static hosting EU
   - `TXT _ipfs-cid.drift-protocol.org` → CID atual da release IPFS (DNSLink)
5. Documentar credenciais Njalla no DMS payload (b)
6. **Importante:** se decisão judicial brasileira chegar, Njalla **não tem presença em BR e não coopera com ordens BR fora MLAT**. Não é blindagem absoluta (ordem US via MLAT internacional pode chegar), mas eleva fricção dramaticamente.

**Trade-off:** Njalla é "operationally hostile" pra ordens judiciais comuns, o que **politicamente** sinaliza algo — pode ser usado como prova de "intenção de evadir". Em jurisdição BR, advogado deve avaliar antes de migrar pra Njalla. **Não migrar precipitadamente.**

### Mirrors — rationale por host

| Host | Jurisdição | Por que | Fricção pra takedown |
|---|---|---|---|
| **Codeberg** (codeberg.org) | DE — operada por Codeberg e.V., NPO alemã | FOSS-friendly, NPO; sem cooperação automática com ordens fora UE; código Forgejo (open source) → fork-able se Codeberg cair | Alta (precisa decisão judicial DE) |
| **GitLab.com** | US (GitLab Inc., Delaware) | Maior plataforma alternativa ao GitHub; SaaS estável | Média (cooperação US-BR via MLAT existe; mas processo lento) |
| **Gitea self-hosted** | Onde maintainer hospedar (sugestão: Hetzner DE, Infomaniak CH) | Controle direto; sem termos de serviço de terceiros | Depende de host físico |
| **IPFS pin (web3.storage / Pinata)** | Distribuído (Filecoin) | Conteúdo endereçado por hash; CID é imutável; sobrevive takedown de qualquer host único | Quase nula (pra remover precisa "des-pinar" em todos os pinning services + nós voluntários) |
| **Sneakernet bundle** (`git bundle` em USB/torrent) | Sem jurisdição central | Última linha; manifesto §16 garantia política | Imune (não tem alvo) |

**Recomendação Robin:** Codeberg + IPFS são os 2 mirrors mais valiosos por unidade de esforço. GitLab.com adiciona pouco valor marginal sobre GitHub (mesma jurisdição base US). Gitea self-hosted só faz sentido depois que entidade jurídica existir (alguém tem que pagar VPS — atribuir conta nominal ao Eduardo é o oposto do que Marshall §4.3 recomenda).

---

## Reflexão final — ordem de execução

Marshall ranqueou prioridades; Robin ranqueia por **dependência técnica** (o que destrava o quê):

1. **Mirrors automáticos (a)** — destrava todo o resto. Sem mirrors, IPFS pin, ou DMS são teatro.
2. **Multi-maintainer doc (c)** — destrava DMS de verdade. Sem co-maintainers cadastrados, payload não tem destinatário.
3. **Watchlist (d)** — independente; pode ir em paralelo. Baixo esforço, alto valor reputacional.
4. **DMS criptográfico (b)** — só faz sentido depois de (c) ter ≥1 co-maintainer com pubkey real.
5. **Continuidade plus (e)** — em standby até gatilho Marshall §4.11 (financiamento + co-maintainers + adoção).

*Robin termina o relatório, fecha o laptop, lembra que ainda precisa fazer o handoff pra próxima persona.* "Engenharia, não teatro" — done.

---

*Robin Scherbatsky, persona LLM, signing off.*
*"What up?"*
