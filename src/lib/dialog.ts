/**
 * dialog — modal central pra alert/confirm/prompt no estilo Drift.
 *
 * Substitui `window.alert` / `window.confirm` / `window.prompt` que
 * renderizam native dialog feio em cima da UI dark-themed (user
 * feedback 2026-05-06).
 *
 * API promise-based pra mudança mínima nos call sites:
 *
 *   // Antes:
 *   if (!confirm('Tem certeza?')) return
 *   alert('Falhou: ' + err.message)
 *   const name = prompt('Novo label:')
 *
 *   // Depois:
 *   if (!(await dialog.confirm('Tem certeza?'))) return
 *   await dialog.alert('Falhou: ' + err.message)
 *   const name = await dialog.prompt('Novo label:')
 *
 * Implementação: Zustand store com `current: DialogRequest | null`.
 * Componente `<DialogHost />` (mountado uma vez em App.tsx) observa
 * o store e renderiza o modal apropriado. Cada chamada pra `alert`/
 * `confirm`/`prompt` cria uma Promise + escreve a request no store +
 * resolve quando user fecha. Modal é serial (1 por vez) — chamadas
 * concorrentes enfileiram (LIFO simples; em prática raro).
 *
 * Acessibilidade: ESC cancela (alert resolve undefined; confirm false;
 * prompt null). Enter confirma. focus trap dentro do modal. role=dialog
 * + aria-modal=true.
 */

import { create } from 'zustand'

// ─── Request shape ───────────────────────────────────────────────────

export interface AlertOptions {
  title?: string
  okLabel?: string
}

export interface ConfirmOptions {
  title?: string
  /** Estiliza o botão de confirmar como destrutivo (vermelho). */
  dangerous?: boolean
  okLabel?: string
  cancelLabel?: string
}

export interface PromptOptions {
  title?: string
  defaultValue?: string
  placeholder?: string
  okLabel?: string
  cancelLabel?: string
  /** maxlength do input. */
  maxLength?: number
}

export type DialogRequest =
  | {
      kind: 'alert'
      message: string
      options: AlertOptions
      resolve: () => void
    }
  | {
      kind: 'confirm'
      message: string
      options: ConfirmOptions
      resolve: (ok: boolean) => void
    }
  | {
      kind: 'prompt'
      message: string
      options: PromptOptions
      resolve: (value: string | null) => void
    }

interface DialogState {
  /** Request atualmente exibida (null = nenhum dialog aberto). */
  current: DialogRequest | null
  /** Fila de requests aguardando — primeira da lista vai pra `current`
   *  quando o atual fecha. Cresce só se chamadas concorrentes ocorrem. */
  queue: DialogRequest[]
}

export const useDialogStore = create<DialogState>(() => ({
  current: null,
  queue: [],
}))

function enqueue(req: DialogRequest): void {
  const { current } = useDialogStore.getState()
  if (current) {
    useDialogStore.setState((s) => ({ queue: [...s.queue, req] }))
  } else {
    useDialogStore.setState({ current: req })
  }
}

/**
 * Fecha o modal atual chamando `resolve` com o valor passado, e avança
 * a queue. Chamado pelo `<DialogHost>` quando user clica OK/Cancelar/ESC.
 */
export function resolveCurrent(value: unknown): void {
  const { current, queue } = useDialogStore.getState()
  if (!current) return
  // Type-narrow via runtime kind
  if (current.kind === 'alert') current.resolve()
  else if (current.kind === 'confirm') current.resolve(Boolean(value))
  else current.resolve((value as string | null) ?? null)

  const [next, ...rest] = queue
  useDialogStore.setState({ current: next ?? null, queue: rest })
}

// ─── API pública ─────────────────────────────────────────────────────

/**
 * Mostra um alert (single OK button). Resolve void quando user fecha.
 */
function alert(message: string, options: AlertOptions = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    enqueue({ kind: 'alert', message, options, resolve })
  })
}

/**
 * Mostra um confirm (OK + Cancelar). Resolve true se user clicou OK,
 * false caso contrário (Cancelar, ESC, click fora).
 */
function confirm(
  message: string,
  options: ConfirmOptions = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    enqueue({ kind: 'confirm', message, options, resolve })
  })
}

/**
 * Mostra um prompt (text input + OK + Cancelar). Resolve a string
 * digitada (vazia se user só clicou OK), ou null se user cancelou
 * (Cancelar, ESC, click fora).
 */
function prompt(
  message: string,
  options: PromptOptions = {},
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    enqueue({ kind: 'prompt', message, options, resolve })
  })
}

export const dialog = { alert, confirm, prompt }
