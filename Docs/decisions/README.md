# Docs/decisions — Architecture Decision Records (ADRs)

Esta pasta guarda **ADRs** (Architecture Decision Records) do Drift —
documentos curtos, datados e imutáveis que registram decisões
arquiteturais não-triviais.

## Quando criar uma ADR

- Decisão arquitetural que **não é óbvia** lendo o código (precisa de
  racional + alternativas consideradas).
- Decisão que **remove ou inverte** comportamento que já existia
  (risco alto de reintrodução acidental por contributor novo).
- Decisão com **trade-off explícito** entre dois eixos (ex.:
  discoverability vs gesture-clarity, performance vs flexibility).
- Decisão que **referencia o manifesto** ou destrava/bloqueia um
  princípio.

Decisões pequenas (refactors locais, fixes óbvios) **não** precisam
de ADR — vivem no commit message + eventualmente em
`Docs/sessions/`.

## Convenções

- Filename: `YYYY-MM-DD-slug-curto.md` (data de aceite, não da
  proposta).
- Status: `Proposed` → `Accepted` → (`Superseded by <ADR>` |
  `Deprecated`). **Nunca editar uma ADR aceita** — crie outra que
  a supersede.
- Tom: técnico-direto, PT-BR, alvo 80-120 linhas. Citar SHAs curtos
  (7 chars) e arquivos por path relativo.
- Estrutura mínima: **Context · Problem · Decision · Consequences ·
  Alternatives considered · References**.

Diferenças versus `Docs/sessions/`:
- `sessions/` = artefato pontual de uma sessão (auditoria, conformance
  check de uma data).
- `decisions/` = decisão arquitetural formal, referenciável por ADRs
  futuras, não-revogável sem nova ADR superseding.
