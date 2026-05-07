/**
 * DialogHost — renderiza o dialog atual do `useDialogStore`.
 *
 * Mountado uma vez em App.tsx (próximo dos overlays globais). Observa
 * `dialogStore.current` e renderiza modal centrado conforme `kind`:
 *
 *   - 'alert'   → mensagem + 1 botão OK
 *   - 'confirm' → mensagem + 2 botões (Cancelar/OK; OK destrutivo opcional)
 *   - 'prompt'  → mensagem + input + 2 botões
 *
 * Visual: backdrop escuro (drift-bg/80 backdrop-blur), modal centrado
 * (`drift-surface` border, ~340px), framer-motion slide+fade.
 *
 * Acessibilidade: role=dialog aria-modal=true, ESC fecha (cancela),
 * Enter no prompt confirma, focus auto no botão primário ou input.
 */

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { resolveCurrent, useDialogStore } from '../../lib/dialog'

export function DialogHost() {
  const current = useDialogStore((s) => s.current)
  return (
    <AnimatePresence>
      {current && <DialogModal key={kindKey(current)} />}
    </AnimatePresence>
  )
}

function kindKey(req: { kind: string; message: string }): string {
  // Garante remount entre dialogs sucessivos pra inputs/focus reagirem
  return `${req.kind}-${req.message.slice(0, 32)}-${Date.now()}`
}

function DialogModal() {
  const current = useDialogStore((s) => s.current)
  const [inputValue, setInputValue] = useState(
    current?.kind === 'prompt' ? (current.options.defaultValue ?? '') : '',
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  // Auto-focus: input pra prompt, OK pros outros.
  useEffect(() => {
    if (current?.kind === 'prompt') {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else {
      okRef.current?.focus()
    }
  }, [current?.kind])

  // ESC = cancela; Enter = confirma (em prompt + confirm).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current) return
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      } else if (e.key === 'Enter') {
        // Em <input>, Enter já dispara form submit — só interceptamos
        // pra alert/confirm (sem input). Em prompt o input lida com Enter
        // no próprio onKeyDown abaixo.
        if (current.kind !== 'prompt') {
          e.preventDefault()
          handleOk()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  if (!current) return null

  function handleOk() {
    if (!current) return
    if (current.kind === 'prompt') resolveCurrent(inputValue)
    else if (current.kind === 'confirm') resolveCurrent(true)
    else resolveCurrent(undefined)
  }

  function handleCancel() {
    if (!current) return
    if (current.kind === 'prompt') resolveCurrent(null)
    else if (current.kind === 'confirm') resolveCurrent(false)
    else resolveCurrent(undefined) // alert: ESC fecha igualmente
  }

  const showCancel = current.kind !== 'alert'
  const danger = current.kind === 'confirm' && current.options.dangerous === true
  const okLabel =
    current.options.okLabel ??
    (current.kind === 'alert'
      ? 'OK'
      : current.kind === 'prompt'
      ? 'confirmar'
      : 'sim')
  const cancelLabel =
    (current.kind === 'confirm' || current.kind === 'prompt'
      ? current.options.cancelLabel
      : undefined) ?? 'cancelar'

  return (
    <motion.div
      key="dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-drift-bg/80 px-4 backdrop-blur-sm"
      onClick={(e) => {
        // Click fora do modal cancela (mesma semântica de native).
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={current.options.title ? 'dialog-title' : undefined}
        aria-describedby="dialog-message"
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.34, 1.56, 0.64, 1] }}
        className="w-full max-w-[340px] rounded border border-drift-border bg-drift-surface p-5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      >
        {current.options.title && (
          <h2
            id="dialog-title"
            className="mb-3 font-display text-[14px] font-extrabold uppercase tracking-meta text-drift-text"
          >
            {current.options.title}
          </h2>
        )}

        <p
          id="dialog-message"
          className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-drift-text"
        >
          {current.message}
        </p>

        {current.kind === 'prompt' && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleOk()
              }
            }}
            placeholder={current.options.placeholder}
            maxLength={current.options.maxLength}
            className="mt-4 w-full rounded border border-drift-border bg-drift-bg px-3 py-2 font-mono text-[12px] text-drift-text placeholder:text-slate-500 focus:border-drift-accent2 focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
          />
        )}

        <div className="mt-5 flex gap-2">
          {showCancel && (
            <button
              onClick={handleCancel}
              className="flex-1 rounded border border-drift-border px-3 py-2 font-mono text-[10px] uppercase tracking-meta text-slate-400 transition-colors hover:border-drift-text hover:text-drift-text focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={okRef}
            onClick={handleOk}
            className={
              danger
                ? 'flex-1 rounded border border-drift-bury bg-drift-bury/10 px-3 py-2 font-mono text-[10px] uppercase tracking-meta text-drift-bury transition-colors hover:bg-drift-bury hover:text-drift-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-bury focus-visible:ring-offset-2 focus-visible:ring-offset-drift-bg'
                : 'flex-1 rounded bg-drift-accent px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-meta text-drift-bg transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2 focus-visible:ring-offset-2 focus-visible:ring-offset-drift-bg'
            }
          >
            {okLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
