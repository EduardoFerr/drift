import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Apenas funções puras testáveis em Node — sem React, sem SQLite WASM,
    // sem WebAuthn. Tests que precisam de browser ficam em manual/E2E.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Pure module mocking — vitest auto-mocka módulos quando vi.mock() é chamado
    // explicitamente. Default OFF.
    mockReset: true,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
