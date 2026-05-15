/**
 * Vitest config dedicado a tests de acessibilidade.
 *
 * Por que separado de `vitest.config.ts`:
 * - Config raiz roda em `environment: node` e cobre só funções puras
 *   (sem React, sem SQLite WASM). Lock estabelecido em §16 do CLAUDE.md.
 * - A11y tests precisam de `jsdom` (renderizar DOM real pra axe-core
 *   inspecionar landmarks, roles, ARIA, contraste de structure).
 *
 * Convivência:
 * - `npm run test`     → suite Node padrão (funções puras, conformance)
 * - `npm run test:a11y` → suite axe-core jsdom (este config)
 * - `npm run test:all` → roda os dois em sequência
 *
 * Padrão de file: `tests/a11y/**\/*.a11y.test.tsx`. O suffix `.a11y.test`
 * é deliberado pra evitar colisão acidental com a suite Node se alguém
 * mover include patterns no futuro.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/a11y/**/*.a11y.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['tests/a11y/setup.ts'],
    mockReset: true,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
