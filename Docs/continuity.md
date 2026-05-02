# Continuidade

Este documento descreve como o projeto continua se qualquer contributor
individual deixar de estar disponível — voluntariamente, por
desinteresse, ou por impedimento legal. **Não há figura central cuja
ausência derruba o projeto.** Este documento é a verificação operacional
dessa afirmação.

---

## Premissa

A persistência do Drift não depende de:

- Acesso a `github.com/EduardoFerr/drift` (este pode ser substituído
  por qualquer fork público).
- Disponibilidade da PWA hospedada em Vercel (essa é uma instância
  entre infinitas).
- Cooperação de qualquer pessoa específica (todo conhecimento crítico
  está no repo).
- Manutenção contínua sob o mesmo nome (forks podem renomear).

A persistência depende de:

- Source público distribuído via git (espelhável em qualquer host).
- Manifesto + arquitetura + invariantes documentados.
- Build reproduzível bit-identical (`Dockerfile.reproducible`).
- Manifesto licenciado **CC0** (não MIT) — qualquer fork pode adotar
  o contrato técnico sem permissão.
- Código licenciado MIT — qualquer fork pode redistribuir.

---

## Reproduzir uma release sem cooperação de nenhum contributor

```bash
# 1. Obter source da tag desejada
git clone <qualquer-fork-com-a-tag>
git checkout v0.6.0-alpha.3

# 2. Verificar integridade contra hash conhecido
git rev-parse HEAD            # deve bater com hash publicado em release notes
sha256sum -c SHA256SUMS       # se SHA256SUMS estiver no source

# 3. Build reproduzível Linux (PWA + Tauri)
docker buildx build \
  -f Dockerfile.reproducible \
  --target artifacts \
  --output type=local,dest=./artifacts \
  --build-arg SOURCE_DATE_EPOCH=1735689600 \
  .

# 4. Comparar bit-identical com release publicada
sha256sum artifacts/dist/* artifacts/tauri/*
diff <(sha256sum -c SHA256SUMS-reproducible) <(echo OK)
```

Se hash bate, source é genuíno **independente de quem assinou a
release**. Manifesto §17 (sem chave mestra) implica que assinaturas
são prova fraca; reprodutibilidade é a prova forte.

---

## Mirrors do source

Para reduzir dependência de qualquer host único, recomenda-se:

- Espelhar o repo em pelo menos um host alternativo (Codeberg, GitLab,
  gitea self-hosted). Tags assinadas migram intactas.
- Pin do source no IPFS após cada release: `ipfs add -r .` produz CID
  que não depende de DNS nem de hosting comercial.
- Bundle source completo (`git bundle create drift-vX.bundle --all`) +
  SHA256 distribuído junto com binárias na release.

Estado atual: source primário em `github.com/EduardoFerr/drift`.
Mirror automatizado é tarefa do roadmap (Track C.5). Forks operativos
servem como mirror de fato — quanto mais forks, mais robusto.

---

## Continuar sob outro nome

O nome "Drift" não é trademark registrado; é descritivo. Qualquer
fork pode:

- Manter o nome "Drift" se entregar protocolo equivalente
  (kinds 9078–9081 + manifesto cumprido).
- Renomear se preferir distância narrativa ou se houver conflito
  específico — o protocolo continua compatível com Damus/Snort/Coracle/
  outros clientes Nostr.

Manifesto + arquitetura são **CC0** (ou caminham pra isso, ver
[manifesto.md](manifesto.md) header). Qualquer fork pode adotar como
seu próprio contrato sem atribuição obrigatória.

---

## Multi-sig de releases (objetivo)

Hoje tags são assinadas (quando assinadas) por uma única chave. Quando
houver 3+ contributors com histórico de merges substantivos, o
objetivo é migrar pra esquema 2-de-3:

- Cada contributor mantém sua chave PGP/SSH.
- Tag `v*` requer pelo menos 2 assinaturas pra ser considerada
  release oficial pela comunidade.
- Contributor impedido (legalmente, fisicamente, por desinteresse)
  não bloqueia release dos outros 2.

Implementação: `.git/hooks` ou GitHub Actions checando assinaturas no
push da tag. Documentação detalhada virá quando o trigger (3+
contributors ativos) for atingido.

---

## Cenário: este repositório for derrubado

Roteiro pra terceiros:

1. Procurar por forks ativos (busca GitHub: `drift-protocol`,
   `kinds 9078 9079 9080 9081`, ou heurística similar). Manifesto +
   arquitetura são identificáveis.
2. Verificar via reprodutibilidade que o fork escolhido produz
   bit-identical à última release conhecida — se sim, é continuação
   válida.
3. Se nenhum fork produz bit-identical mas algum implementa o
   manifesto + as 17 invariantes, é continuação **conceitual** válida;
   protocolo Nostr garante interop entre eles.

Pra usuários: a identidade `nsec` continua funcionando em qualquer
cliente Nostr. Não há "lock-in" — manifesto §3.

---

## O que este documento **não** promete

- Que qualquer pessoa específica continuará trabalhando no projeto.
- Que a PWA hospedada em Vercel continuará no ar.
- Que tags futuras serão assinadas por chaves específicas.
- Que o nome "Drift" continuará apontando pra esta árvore de código.

O que persiste é o que está escrito nos arquivos versionados.
