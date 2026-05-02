# Contributing

## Premissa

Este projeto é desenhado pra sobreviver ao desinteresse, ausência, ou
impossibilidade de qualquer contributor individual — incluindo quem
abriu o repositório. Cada contribuição assume essa premissa: você
contribui pro protocolo + cliente, não pra um mantenedor.

## Como contribuir

1. Abra fork. Faça as mudanças. PR contra `main`.
2. Cumpra as **17 invariantes** de [CLAUDE.md](CLAUDE.md) — quebrá-las
   quebra o sistema; PRs que as quebram são rejeitados independente do
   mérito da feature.
3. Funções puras (`lib/scoring.ts`, `lib/weight.ts`, `lib/moderation.ts`,
   `lib/feed.ts:applyContentFilters`, `lib/bip39.ts`, `lib/nip65.ts`)
   exigem testes Vitest. Ver `tests/`.
4. `npx tsc --noEmit && npm run test` precisa passar.

## DCO — Developer Certificate of Origin

Cada commit precisa de `Signed-off-by:` no trailer. Exemplo:

```
git commit -s -m "feat(feed): adiciona filtro X"
```

Com isso você certifica:

- (a) Você escreveu o código, OU
- (b) O código vem de uma fonte com licença compatível MIT, OU
- (c) Foi passado a você por alguém que certificou (a) ou (b).

Texto completo: <https://developercertificate.org/>.

DCO é leve (uma linha por commit). **Não há CLA.** O copyright fica
com cada contributor; não há transferência pra um mantenedor central.
Implicação prática: o repositório é coletivo desde o primeiro PR de
terceiro.

## Conformidade com manifesto

[Docs/manifesto.md](Docs/manifesto.md) é o contrato técnico. Quando uma
mudança conflita com o manifesto, o manifesto vence — a arquitetura se
ajusta ou a mudança é rejeitada.

Mudanças no próprio manifesto exigem PR separado, justificativa
explícita, e idealmente revisão crítica das 5 perspectivas
documentadas em CLAUDE.md ("personas LLM"). Manifesto é CC0 — qualquer
fork pode adotar, modificar, ou substituir o manifesto sem permissão.

## Personas LLM como ferramenta de revisão

Documentos de plano podem referenciar revisões por papel
(`[revisão: segurança]`, `[revisão: conformance]`) — isto descreve um
**tipo de análise crítica estruturada**, não pessoas reais. Personas
não conferem autoridade; rejeições de PR usam o manifesto + invariantes
como base, não opiniões nominais.

## Releases

Tags `v*` em `main` disparam:

- `release.yml` → PWA `dist.zip` + SHA256SUMS
- `reproducible-build.yml` → Tauri Linux determinístico via `Dockerfile.reproducible`
- `tauri-distribution.yml` → Tauri macOS/Windows/Linux com Tor (`--features arti`)
- `twa.yml` → APK/AAB Android (Bubblewrap)

Qualquer fork com tag `v*` deveria reproduzir bit-identical a Linux
Tauri (verificável). Se não reproduz, ou o `Dockerfile.reproducible`
quebrou, ou o source diverge — ambos são bugs reportáveis.

## Multi-maintainer

Hoje o repositório aceita PRs e merge é manual. Quando houver pelo
menos 3 contributors com histórico de merges substantivos, o objetivo
é mover signing de tags pra **2-de-3 multi-sig** entre eles — preserva
release continuity mesmo se um contributor for impedido (legalmente,
fisicamente, ou por desinteresse). Ver [Docs/continuity.md](Docs/continuity.md).
