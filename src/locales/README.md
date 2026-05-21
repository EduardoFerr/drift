# `src/locales/` — i18n catalogs (Phase 1A scaffold)

**Estado:** STRUCTURAL SCAFFOLD ONLY. Sem strings wrapped, sem lib
i18n instalada, sem build pipeline. Diretório existe pra reservar a
estrutura quando user der GO/NO-GO na Phase 1A.

## Estrutura prevista

```
src/locales/
├── pt-BR/
│   └── messages.po    (master catalog — pt-BR é nativo do projeto)
├── en/
│   └── messages.po    (Phase 1A initial target)
└── README.md          (este arquivo)
```

## Pendências de decisão (BACKLOG — ainda blockeadas)

1. **GO/NO-GO Phase 1A** — Decisão estratégica: investir 10 dias +
   ~8 KB bundle agora ou defer?
2. **Lib pick** — Recomendação atual: LinguiJS v4 (~2 KB, macros AOT,
   ICU completo, types gerados). Alternativas validadas no plano:
   react-i18next, FormatJS, no-lib custom helper.
3. **Hosting de traduções** — Weblate self-host (manifesto §17 — sem
   chave mestra na plataforma) vs Crowdin/Lokalise SaaS.
4. **Locales iniciais** — PT-BR + EN apenas, ou já incluir ES, FR?
5. **CONTRIBUTING-i18n.md** — quem escreve a guideline pra
   contributors externos.

## Glossário protocolar (CONGELADO — não traduzir)

Os termos abaixo são **identificadores técnicos** do protocolo Drift
/ Nostr e **NUNCA** são traduzidos, mesmo em pt-BR catalog:

- `SPREAD` / `BURY` (kind names, código fonte)
- `nsec` / `npub` (formatos bech32)
- `NIP-01`, `NIP-02`, `NIP-65`, `NIP-94`, etc. (Nostr specs)
- `9078`, `9079`, `9080`, `9081` (kind numbers)

**Mapeamento UI-facing (separado, ESSE traduz):**

| Identifier técnico | pt-BR | EN |
|---|---|---|
| SPREAD action | DRIFT | DRIFT (mantido) |
| BURY action | SINK | SINK (mantido) |
| score numérico | DERIVA | DRIFT SCORE |

Quando Phase 1A vier, vai existir LOCK_VIA_TEST congelando esse
mapping (single-source-of-truth em `src/lib/i18n-glossary.ts`).

## Próximos passos quando user destravar

1. Ler plano completo em `Docs/plans/i18n-phase1a-plan.md` (se
   existir, senão criar)
2. `npm i @lingui/core @lingui/react @lingui/macro` (após GO)
3. Vite plugin config em `vite.config.ts`
4. Wrap strings progressivamente (não bulk — caso-a-caso por feature)
5. CI step: `lingui extract` valida catalog atualizado
6. Weblate setup (se hosted decision = self-host)

## Não fazer agora

- ❌ NÃO wrap strings em arquivos existentes — sem lib ainda
- ❌ NÃO instalar LinguiJS — bloqueado por GO/NO-GO
- ❌ NÃO criar catalogs .po populados — placeholder sem helper
  gera ruído

---

*Scaffold criado 2026-05-20. BACKLOG item "i18n Phase 1A" continua
bloqueado por decisão user — estrutura preserva a direção sem
commitar com lib externa antes do GO.*
