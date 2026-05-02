# Security

## Escopo

Este documento cobre **vulnerabilidades em código deste repositório** —
quebras de invariantes do `CLAUDE.md`, bugs criptográficos no manuseio
de `nsec`, falhas que expõem dados locais, comprometimento do pipeline
`onNostrEvent`, regressões em `lib/scoring.ts`/`lib/moderation.ts`.

**Fora de escopo:**

- Conteúdo publicado em relays Nostr — relays operam independentemente;
  endereçar via mecanismos do protocolo (kind 9081 reports → threshold
  dinâmico) ou diretamente com o operador do relay.
- Comportamento de forks ou redistribuições — cada distribuição é
  responsável pela sua superfície.
- Disponibilidade de qualquer instância hospedada (Vercel, IPFS gateway,
  mirrors) — instâncias específicas não são parte do protocolo. Self-host
  ou use outra distribuição.

## Reportar

Issues públicas no GitHub do repositório-fonte são aceitas para
vulnerabilidades de baixa severidade. Para classes que comprometem
identidade ou integridade de eventos (forja de assinatura Schnorr,
exfiltração de `nsec`, bypass de verify): abrir issue com label
`security` e detalhes mínimos suficientes pra reprodução; commits de
correção são preferenciais a relatórios privados.

**Sem SLA. Sem garantia de resposta.** Patches via PR aceleram
qualquer correção. Forks que aplicarem fix antes do upstream estão
fazendo a coisa certa — comuniquem o fix via PR pra propagar.

## Disclosure

Há preferência por **disclosure imediata pública** assim que houver
patch disponível em pelo menos uma fork. Manifesto §17 (sem chave
mestra) implica que ninguém tem autoridade pra "embargo coordenado";
qualquer ator informado tem direito igual de publicar e patchear.

## Reprodutibilidade como mecanismo de segurança

Releases binárias têm `Dockerfile.reproducible` + `SHA256SUMS`
publicados. Verificação independente é o único método robusto de
confirmar que uma binária corresponde ao source — não confie em
nenhuma assinatura como garantia única. Ver [Docs/build-reproducible.md](Docs/build-reproducible.md).

## Threat model

[Docs/drift-arquitetura-v4.md §36](Docs/drift-arquitetura-v4.md) lista o
modelo de ameaças geral. [Docs/webrtc-threats.md](Docs/webrtc-threats.md)
cobre WebRTC especificamente (Fase 6).
