/**
 * View mode store — controla modo de visualização da home (padrão/slim).
 *
 * Adicionado 2026-05-17 a pedido do user. Modos:
 *   - `padrão` (default): NavBar bottom + FeedTabs top visíveis,
 *     card centralizado com chrome ao redor
 *   - `slim`: NavBar + FeedTabs hidden (slide-off animado), card
 *     expande pra ocupar toda viewport disponível
 *
 * Toggle via long-press 5s no card (substitui o gesto antigo que abria
 * ModerationModal — esse foi movido pro ActionsFan).
 *
 * **Ephemeral** (não persistido em user_prefs): slim é per-sessão.
 * Razão: feature exploratória, evita "user fica preso em slim sem saber
 * como sair" entre sessions. Pode virar persistido depois se user pedir.
 *
 * Manifesto §28 (privacy pelo mínimo): zero side effect — nenhum kind
 * Nostro, nenhum log, nenhuma telemetria. Só state local volátil.
 */

import { create } from 'zustand'

export interface ViewModeState {
  /** True = slim mode (chrome hidden, card fullscreen). */
  slim: boolean
}

const INITIAL: ViewModeState = {
  slim: false,
}

export const useViewModeStore = create<ViewModeState>(() => INITIAL)

/**
 * Alterna entre modo padrão e modo slim.
 * Chamado pelo handler de long-press 5s no PostViewer.
 */
export function toggleSlim(): void {
  useViewModeStore.setState((s) => ({ slim: !s.slim }))
}

/** Força modo padrão (escape hatch). */
export function exitSlim(): void {
  useViewModeStore.setState({ slim: false })
}
