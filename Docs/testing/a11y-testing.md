# A11y testing — axe-core + jsdom

## Por que

Lighthouse a11y está em **100/100**, mas o LH roda apenas um subset
das regras axe-core (focado em problemas detectáveis sem interação).
A suite axe completa (WCAG 2.1 A + AA) cobre:

- ARIA correctness (roles, states, properties)
- Landmark structure
- Accessible name computation
- Form labelling
- Image alt text
- Focus management primitives (estrutural — focus trap runtime ainda
  é manual / Playwright)

Esta suite é complementar ao LH CI (que roda contra build em
`tests/cwv-conformance.test.ts` + `lhci`). Aqui testamos
**componentes isoladamente** com a fidelidade do DOM real (jsdom).

## Como rodar

```bash
# Apenas a suite a11y (rápida — ~8s)
npm run test:a11y

# Watch mode durante desenvolvimento
npm run test:a11y:watch

# Suite completa: Node + a11y
npm run test:all
```

A suite a11y **não roda** no `npm run test` default — fica num config
separado (`vitest.a11y.config.ts`) porque exige `jsdom` (DOM real).
A suite Node continua leve e cobre só funções puras (lock §16 do
CLAUDE.md: pure-only em Node).

## Arquitetura

```
tests/a11y/
├── setup.ts          ← jest-dom matchers + cleanup + canvas warning silencer
├── axeRunner.ts      ← wrapper sobre axe-core (WCAG 2.1 AA)
├── DriftButton.a11y.test.tsx
├── DriftChip.a11y.test.tsx
├── GlassIconButton.a11y.test.tsx
├── ModalHeader.a11y.test.tsx
└── SlideUpOverlay.a11y.test.tsx
```

Cada test file segue o padrão:

```tsx
import { render } from '@testing-library/react'
import { expectNoViolations } from './axeRunner'

it('descrição', async () => {
  const { container } = render(<MeuComponente />)
  await expectNoViolations(container)
})
```

## Cobertura atual (2026-05-15)

| Componente          | Variants × Sizes × States | Tests |
|---------------------|---------------------------|-------|
| `<DriftButton>`     | 5 × 3 × 2 + 1 icon-only    | 31    |
| `<DriftChip>`       | 7 × 3 × 3                  | 63    |
| `<GlassIconButton>` | 2 × 4 + 1 disabled         | 9     |
| `<ModalHeader>`     | 4 cenários                 | 4     |
| `<SlideUpOverlay>`  | 4 cenários                 | 4     |
| **Total**           |                            | **111** |

**Violations encontradas no scaffold inicial: 0.** Os primitives do
design system v0.7 (DriftButton, DriftChip, GlassIconButton) foram
desenhados com a11y em mente — `aria-pressed`, `aria-label`
obrigatório em icon-only via TS strict, `aria-hidden` em ícones
decorativos, focus-visible ring nas base classes.

## Adicionando um novo componente

1. Criar `tests/a11y/<Component>.a11y.test.tsx`
2. Renderizar com `@testing-library/react`
3. Cobrir estados relevantes (variants, sizes, enabled/disabled, etc.)
4. Embrulhar em landmark se o componente assume contexto
   (ex.: `ModalHeader` precisa `<section role="dialog">` ao redor pra
   o `<h2>` standalone não disparar violation de "heading levels
   skip"; `SlideUpOverlay` já vem com `role="dialog"` próprio).
5. Rodar `npm run test:a11y:watch` durante o desenvolvimento.

## Componentes ainda NÃO cobertos (futuras rounds)

Os seguintes não foram incluídos no scaffold inicial porque dependem
de stores Zustand / SQLite / efeitos colaterais que exigem mocks
substanciais. Triagem futura:

- `<PostViewer>` — depende de useFeedStore, weight, geolocation
- `<FeedTabs>` — usa `useFeedStore` (precisa mock de store)
- `<IdentityPanel>` — depende de identity store + crypto
- `<ProfileModal>`, `<IdentitySwitcher>` — idem
- `<ComposeOverlay>`, `<ReportModal>`, `<ReplySheet>` — formulários
  ricos

Estes ainda são cobertos parcialmente via Lighthouse CI (que roda
contra a build completa). A11y deep nessas surfaces requer:

(a) Refatorar pra stores injetadas via props (testabilidade);
(b) OU usar Playwright + axe browser pra rodar contra app real.

## Triagem de violations

Quando axe encontra uma violation, a saída inclui:

- `[rule-id]` — id da regra axe (ex.: `button-name`, `color-contrast`)
- `help` — descrição humana
- `helpUrl` — link pra docs Deque com explicação + fix
- `nodes[].html` — snippet do DOM violando
- `nodes[].failureSummary` — explicação contextual

**Política**:

- Violação real → fixar no componente, manter test
- Falso positivo claro (ex.: axe não entende custom landmark) →
  **investigar primeiro**. Só desabilitar regra como último recurso,
  via `runAxe(container, { rules: { 'rule-id': { enabled: false } } })`
  no test específico, **com comentário explicando o porquê**.
- Nunca silenciar globalmente em `axeRunner.ts` sem RFC explícito.

## Limites conhecidos

- `color-contrast` em jsdom: jsdom não computa CSS real (sem canvas),
  então contraste fica em fallback estrutural. Para validação real de
  contraste use LH CI (já em vigor) ou Playwright + axe.
- `focus trap` runtime: axe valida structure (ex.: `aria-modal`), mas
  não o comportamento de tab cycling. Test manual ou Playwright.
- `tap target size` (WCAG 2.5.5): axe-core ainda não cobre
  confiavelmente em jsdom. Cobertura via LH.

## Referências

- [axe-core API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)
- [WCAG 2.1 quick reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [Testing Library a11y guide](https://testing-library.com/docs/dom-testing-library/api-accessibility)
