/**
 * ESLint custom rule: drift/no-tailwind-non-drift-tokens
 *
 * Disallow Tailwind core color tokens (slate-*, emerald-*, red-*, yellow-*,
 * amber-*, gray-*, blue-*, etc.) in JSX `className` attributes.
 *
 * Drift tokens (`drift-*`) are the canonical source — see
 * `tailwind.config.js` `theme.extend.colors.drift` and
 * `Docs/design-system.md` §1.
 *
 * Spec: `Docs/rfcs/2026-05-rfc-token-enforcement.md` §2.
 *
 * Severity strategy (Fase 1 — Round 4):
 *   - Hot path (POST/Feed/Compose) → caller wires `error` via overrides
 *   - Default → `warn`
 *   - Fase 3 (Round 5) flips global to `error`
 *
 * Hex literals in arbitrary classnames (`bg-[#xxxxxx]`) and inline `style`
 * objects are flagged separately with messageId `hexLiteral`.
 *
 * Falsos positivos esperados:
 *   - JSXText (não-className) — não dispara, só JSXAttribute name=className
 *   - `aria-label="text-red-500"` — não dispara (name !== className)
 *   - Classes em comments — AST não vê comments, bypass natural
 */

'use strict'

// Colors blocked: Tailwind core scales that aren't `drift-*`. Anything
// in this list as `<prop>-<color>-<shade>` triggers the rule.
const BLOCKED_COLORS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose',
]

// Property prefixes: only these can attach a color in Tailwind.
const PROPERTY_PREFIXES = [
  'text', 'bg', 'border', 'ring', 'divide',
  'from', 'to', 'via',
  'placeholder', 'caret', 'accent', 'decoration', 'outline',
  'fill', 'stroke', 'shadow',
]

// Strip variant prefixes (hover:, focus:, dark:, sm:, group-*:, peer-*:)
// before pattern check. Allows nested chains (`hover:focus:text-red-500`).
const VARIANT_RE =
  /^(?:hover|focus|focus-visible|focus-within|active|disabled|visited|checked|placeholder|first|last|odd|even|empty|read-only|disabled|aria-[a-z-]+|data-\[[^\]]+\]|dark|sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl|max-2xl|group-hover|group-focus|peer-hover|peer-focus|motion-safe|motion-reduce|portrait|landscape|print|rtl|ltr|before|after|placeholder|file|marker|selection|first-letter|first-line|backdrop):/

const HEX_ARBITRARY_RE = /\[#[0-9a-fA-F]{3,8}(?:\/\d+)?\]/

/**
 * Check whether a className token is blocked.
 * Returns the raw color/shade (e.g., 'slate-700') if blocked, else null.
 */
function classify(token) {
  // Strip variants (chained allowed)
  let cls = token
  for (let safety = 0; safety < 8; safety++) {
    const m = cls.match(VARIANT_RE)
    if (!m) break
    cls = cls.slice(m[0].length)
  }
  // Empty / negation prefix
  cls = cls.replace(/^!/, '').replace(/^-/, '')
  if (!cls) return null

  // Drift OK
  if (cls.startsWith('drift-')) return null
  if (/^(?:text|bg|border|ring|divide|from|to|via|placeholder|caret|accent|decoration|outline|fill|stroke|shadow)-drift-/.test(cls)) return null

  // Hex arbitrary?
  if (HEX_ARBITRARY_RE.test(cls)) {
    return { kind: 'hex', cls }
  }

  // Pattern: <prop>-<color>-<shade>
  const m = cls.match(/^([a-z]+)-([a-z]+)-(\d{2,3})(?:\/\d+)?$/)
  if (!m) return null
  const [, prop, color] = m
  if (!PROPERTY_PREFIXES.includes(prop)) return null
  if (!BLOCKED_COLORS.includes(color)) return null

  return { kind: 'blocked', cls }
}

/**
 * Recursively walk an expression, calling visit(literalString, node) for
 * every string contained — covers template literals, conditionals,
 * classnames(...) helpers, array elements.
 */
function walkStrings(node, visit) {
  if (!node) return
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') visit(node.value, node)
      return
    case 'TemplateLiteral':
      for (const q of node.quasis) {
        if (q.value && typeof q.value.cooked === 'string') visit(q.value.cooked, q)
      }
      for (const e of node.expressions) walkStrings(e, visit)
      return
    case 'ConditionalExpression':
      walkStrings(node.consequent, visit)
      walkStrings(node.alternate, visit)
      return
    case 'LogicalExpression':
    case 'BinaryExpression':
      walkStrings(node.left, visit)
      walkStrings(node.right, visit)
      return
    case 'CallExpression':
      for (const arg of node.arguments) walkStrings(arg, visit)
      return
    case 'ArrayExpression':
      for (const el of node.elements) walkStrings(el, visit)
      return
    case 'ObjectExpression':
      for (const p of node.properties) {
        if (p.type === 'Property') walkStrings(p.key, visit)
      }
      return
    default:
      return
  }
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow non-drift Tailwind color tokens in JSX className',
      url: 'https://drift.docs/rfcs/2026-05-rfc-token-enforcement#section-2',
    },
    schema: [],
    messages: {
      blocked:
        'Tailwind color "{{cls}}" is not a Drift token. Use a `drift-*` token (see tailwind.config.js theme.extend.colors.drift). Spec: Docs/rfcs/2026-05-rfc-token-enforcement.md.',
      hexLiteral:
        'Hex literal "{{cls}}" in className. Use a `drift-*` token instead, or add a `// drift-allow-hex: <reason>` comment above to opt out.',
      hexInStyle:
        'Hex literal "{{value}}" in inline style. Use a `drift-*` token via Tailwind class, or add a `// drift-allow-hex: <reason>` comment above to opt out.',
    },
  },
  create(context) {
    function checkClassNameString(value, node) {
      const tokens = value.split(/\s+/).filter(Boolean)
      for (const tok of tokens) {
        const result = classify(tok)
        if (!result) continue
        if (result.kind === 'hex') {
          context.report({ node, messageId: 'hexLiteral', data: { cls: result.cls } })
        } else {
          context.report({ node, messageId: 'blocked', data: { cls: result.cls } })
        }
      }
    }

    function isAllowedHexBySource(node) {
      const sourceCode = context.getSourceCode ? context.getSourceCode() : context.sourceCode
      if (!sourceCode) return false
      const comments = sourceCode.getCommentsBefore(node)
      for (const c of comments) {
        if (/drift-allow-hex/.test(c.value)) return true
      }
      return false
    }

    return {
      JSXAttribute(node) {
        if (!node.name || node.name.name !== 'className') return
        const v = node.value
        if (!v) return
        if (v.type === 'Literal' && typeof v.value === 'string') {
          checkClassNameString(v.value, node)
          return
        }
        if (v.type === 'JSXExpressionContainer') {
          walkStrings(v.expression, (s, n) => checkClassNameString(s, n))
        }
      },
      // style={{ color: '#f87171' }} — flag hex literais
      Property(node) {
        if (!node.value || node.value.type !== 'Literal') return
        const val = node.value.value
        if (typeof val !== 'string') return
        if (!/^#[0-9a-fA-F]{3,8}$/.test(val)) return
        if (isAllowedHexBySource(node)) return
        // Only flag when the property is part of a style-like object —
        // heuristic: parent ObjectExpression whose parent is JSXExpressionContainer
        // attached to a `style` JSXAttribute. Cheap walk:
        let p = node.parent
        if (!p || p.type !== 'ObjectExpression') return
        let pp = p.parent
        // Allow nested objects inside style
        while (pp && pp.type === 'Property') {
          pp = pp.parent && pp.parent.parent
        }
        if (!pp || pp.type !== 'JSXExpressionContainer') return
        const attr = pp.parent
        if (!attr || attr.type !== 'JSXAttribute') return
        if (!attr.name || attr.name.name !== 'style') return
        context.report({ node: node.value, messageId: 'hexInStyle', data: { value: val } })
      },
    }
  },
}
