/**
 * Stub plugins that define no-op versions of rules referenced in inline
 * `eslint-disable-next-line` comments scattered across the codebase.
 *
 * Background: source files include directives like
 *   // eslint-disable-next-line react-hooks/exhaustive-deps
 * that pre-date this ESLint setup. ESLint 9+ flat config errors when a
 * disable directive references an unconfigured rule. We don't actually
 * run those plugins (out of scope for the token-enforcement RFC), so we
 * register no-op rule entries to keep the disable directives valid
 * without pulling in (and possibly conflicting with) the real plugins.
 *
 * Adding a real plugin later is harmless — the stub is replaced by
 * whichever plugins object wins in the merge, and we'd then drop the
 * stub here.
 */

'use strict'

/** @type {import('eslint').Rule.RuleModule} */
const noopRule = {
  meta: { type: 'problem', schema: [], messages: {} },
  create() {
    return {}
  },
}

function makePlugin(ruleNames) {
  const rules = {}
  for (const name of ruleNames) rules[name] = noopRule
  return { rules }
}

module.exports = {
  'react-hooks': makePlugin(['exhaustive-deps', 'rules-of-hooks']),
  react: makePlugin(['button-has-type']),
  '@typescript-eslint': makePlugin([
    'no-unused-vars',
    'no-namespace',
    'ban-types',
    'no-unsafe-member-access',
    'no-unsafe-assignment',
    'no-unsafe-return',
    'no-unsafe-call',
    'no-unsafe-argument',
    'no-explicit-any',
    'no-non-null-assertion',
    'no-empty-interface',
    'no-empty-function',
    'consistent-type-imports',
  ]),
}
