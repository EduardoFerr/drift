/**
 * Setup global pra a11y tests.
 *
 * - `@testing-library/jest-dom`: extende matchers do Vitest com `toBeInTheDocument`,
 *   `toHaveAccessibleName`, etc. Útil pra assertions semânticas além de axe.
 * - cleanup: garante DOM limpo entre tests (RTL faz auto-cleanup com vitest globals
 *   off, então chamamos explicitamente).
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// jsdom não implementa HTMLCanvasElement.getContext (sem `canvas` npm package).
// axe-core tenta usar canvas pra computed-color contrast checks. Em jsdom isso
// não vai funcionar nunca, e axe já cai pro fallback estrutural automaticamente.
// O warning interno polui o output. Silenciamos só essa string específica
// em ambos os canais (stdout/stderr) já que jsdom escreve direto via virtual console.
const originalErr = console.error
console.error = (...args: unknown[]) => {
  const first = args[0]
  if (typeof first === 'string' && first.includes("HTMLCanvasElement's getContext")) {
    return
  }
  originalErr(...args)
}

const originalStderrWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
  if (typeof chunk === 'string' && chunk.includes("HTMLCanvasElement's getContext")) {
    return true
  }
  // @ts-expect-error rest forwarding mantém compat com encoding/callback overloads
  return originalStderrWrite(chunk, ...rest)
}) as typeof process.stderr.write
