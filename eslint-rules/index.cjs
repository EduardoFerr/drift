/**
 * Local ESLint plugin index. Registers Drift custom rules under the
 * `drift/` namespace.
 *
 * Usage in eslint.config.js:
 *   import driftPlugin from './eslint-rules/index.cjs'
 *   export default [{ plugins: { drift: driftPlugin }, rules: { 'drift/no-tailwind-non-drift-tokens': 'warn' } }]
 */

'use strict'

module.exports = {
  rules: {
    'no-tailwind-non-drift-tokens': require('./no-tailwind-non-drift-tokens.cjs'),
  },
}
