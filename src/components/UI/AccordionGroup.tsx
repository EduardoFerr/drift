/**
 * AccordionGroup — wrapper React Context que coordena 1-aberto-por-vez
 * entre N child `<SettingExplainer>` (ou qualquer componente que leia
 * `useAccordionGroup()`).
 *
 * Source: Ted HIMYM dispatch 2026-05-18. User reclamou que Settings cards
 * com 2+ explainers viraram flat list após Phase 2 — inconsistente com
 * SettingsRoot que usa accordion 1-at-a-time.
 *
 * **Design decisions (Ted):**
 *
 * 1. **API por ID semântico, não index** — `accordionId="filters-nsfw"`
 *    (string slug), não `accordionIndex={0}` (numérico). Razões:
 *     - Index frágil quando `<SettingExplainer level='advanced'>` filtra
 *       child (retorna null → gaps no index).
 *     - Index obriga callsite a contar manualmente.
 *     - ID stable across re-renders + tolera reordenação.
 *
 * 2. **Contexto opcional** — child que NÃO está dentro de AccordionGroup
 *    funciona standalone (sempre expanded). Zero breakage nos 30+ usos
 *    de SettingExplainer fora de Settings cards.
 *
 * 3. **defaultOpen='first' | 'none' | <id>** — controla qual abre no
 *    mount. 'first' = primeiro child que se auto-registra. 'none' = todos
 *    fechados (user clica pra abrir).
 *
 * 4. **Reusa primitives existentes** — Collapse (CSS grid, sem JS) +
 *    SectionHeader (modo accordion com chevron). Zero novo motion code.
 *
 * **Uso típico:**
 *
 *   <AccordionGroup defaultOpen="first">
 *     <SettingExplainer accordionId="filters-nsfw" label="..." ...>
 *       <Toggle ... />
 *     </SettingExplainer>
 *     <SettingExplainer accordionId="filters-spoilers" label="..." ...>
 *       <Toggle ... />
 *     </SettingExplainer>
 *   </AccordionGroup>
 *
 * Standalone (back-compat):
 *
 *   <SettingExplainer label="..." ...> ... </SettingExplainer>
 *   // Sem AccordionGroup parent → ctx === null → render expanded sempre.
 *
 * Manifesto §28: 100% local-only, zero export, zero telemetry.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface AccordionContextValue {
  openId: string | null
  setOpenId: (id: string | null) => void
  /** Filho avisa que existe — primeiro a chamar fica default-open se
   *  `defaultOpen='first'`. Idempotente. */
  register: (id: string) => void
}

export const AccordionContext = createContext<AccordionContextValue | null>(null)

export function useAccordionGroup(): AccordionContextValue | null {
  return useContext(AccordionContext)
}

export interface AccordionGroupProps {
  /**
   * Qual section abre no mount.
   *   - 'first' (default): primeiro child que se registra.
   *   - 'none': todos fechados; user clica pra abrir.
   *   - string específica: ID do child que deve abrir.
   */
  defaultOpen?: 'first' | 'none' | string
  children: ReactNode
}

export function AccordionGroup({
  defaultOpen = 'first',
  children,
}: AccordionGroupProps) {
  // Inicializa baseado no defaultOpen.
  //   - 'first' → null; primeiro register() seta.
  //   - 'none' → null; nenhum register() seta.
  //   - <id> → string direto; register() ignora porque já tem.
  const initialId =
    defaultOpen === 'first' || defaultOpen === 'none' ? null : defaultOpen
  const [openId, setOpenIdState] = useState<string | null>(initialId)

  const setOpenId = useCallback((id: string | null) => {
    setOpenIdState(id)
  }, [])

  // useRef-style first-seen tracking via state. Quando defaultOpen='first',
  // primeiro register vence; subsequentes são no-op.
  const [firstSeen, setFirstSeen] = useState<string | null>(initialId)
  const register = useCallback(
    (id: string) => {
      if (defaultOpen !== 'first') return
      if (firstSeen !== null) return // já tem first
      setFirstSeen(id)
      setOpenIdState((prev) => (prev === null ? id : prev))
    },
    [defaultOpen, firstSeen],
  )

  return (
    <AccordionContext.Provider value={{ openId, setOpenId, register }}>
      {children}
    </AccordionContext.Provider>
  )
}

/**
 * Helper hook pro SettingExplainer (ou qualquer accordion child) lidar
 * com auto-registro + isOpen lookup. Retorna `null` se não dentro de
 * AccordionGroup (caller renderiza standalone).
 */
export function useAccordionMember(id: string): {
  inGroup: true
  isOpen: boolean
  toggle: () => void
} | { inGroup: false } {
  const ctx = useContext(AccordionContext)
  useEffect(() => {
    if (ctx) ctx.register(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  if (!ctx) return { inGroup: false }
  const isOpen = ctx.openId === id
  return {
    inGroup: true,
    isOpen,
    toggle: () => ctx.setOpenId(isOpen ? null : id),
  }
}
