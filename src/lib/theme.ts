/**
 * theme — multi-tema runtime sem recompile.
 *
 * Estratégia (Ted Round 2026-05-17):
 *   - 3 paletas: Cinder (default), Rosenholz, Velatura
 *   - Tokens em CSS vars (`src/styles/themes.css` → `[data-theme="X"]` blocks)
 *   - Tailwind config aponta utilities pra `var(--drift-X)`
 *   - Switch = `setAttribute('data-theme', id)` no `<html>` — zero JS
 *     overhead, sem repaint custoso (CSS engine handle natively)
 *
 * Persistência: `user_prefs.theme_id` (SQLite). Boot order:
 *   `loadPrefs() → applyTheme(prefs.theme_id || DEFAULT_THEME_ID)`
 *
 * Manifesto §7 (determinismo): tema é decisão local, NÃO vai pra rede,
 * NÃO afeta score/feed/weight. Outros clientes Drift veem o user
 * idêntico — só a UI local muda. LOCK_VIA_TEST garante isolamento.
 *
 * Sentimento de gesto (Robin v4 curadoria):
 *   - Cinder    → brasa fria, decay rápido (motion-fast favorita)
 *   - Rosenholz → página virando, demora poética (motion-emphasis)
 *   - Velatura  → tato físico, papel afundando (motion-card)
 */

export const THEME_IDS = ['cinder', 'rosenholz', 'velatura'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME_ID: ThemeId = 'cinder'

/**
 * Type guard — narrow string pra `ThemeId`. Útil em `applyRow` de
 * prefs.ts pra rejeitar valores corrompidos no SQLite.
 */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

/**
 * Aplica tema setando `data-theme` no `<html>`. Idempotente — chamar 2x
 * com mesmo id é no-op.
 *
 * Side effect único: `documentElement.setAttribute`. Nenhum store,
 * nenhum SQLite write (caller decide persistência). Permite que callers
 * façam preview-on-hover sem persistir.
 */
export function applyTheme(id: ThemeId): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', id)
}

/**
 * Lê tema atual do DOM. Retorna `null` se atributo ausente — caller
 * deve usar `DEFAULT_THEME_ID` como fallback.
 */
export function getCurrentTheme(): ThemeId | null {
  if (typeof document === 'undefined') return null
  const raw = document.documentElement.getAttribute('data-theme')
  return isThemeId(raw) ? raw : null
}

/**
 * Metadados pra UI (AppearanceCard) — nome, tagline, mood.
 * Não usar em decisões de runtime (só apresentação visual).
 */
export interface ThemeMeta {
  id: ThemeId
  name: string
  tagline: string
  mood: string
  isLight: boolean
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  cinder: {
    id: 'cinder',
    name: 'Cinder',
    tagline: 'Brasa quase apagada sob cinza monástico',
    mood: 'monástico · brasoso · taciturno',
    isLight: false,
  },
  rosenholz: {
    id: 'rosenholz',
    name: 'Rosenholz',
    tagline: 'Madeira-de-rosa sob luz de luminária na biblioteca',
    mood: 'literário · contemplativo · noturno',
    isLight: false,
  },
  velatura: {
    id: 'velatura',
    name: 'Velatura',
    tagline: 'Camada de tinta translúcida sobre gesso seco',
    mood: 'terroso · artesanal · diurno',
    isLight: true,
  },
}
