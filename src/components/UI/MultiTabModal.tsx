/**
 * MultiTabModal — exibido quando OPFS sinaliza NoModificationAllowedError
 * (db.worker → 'MULTI_TAB_CONFLICT' → bootstrap em step='error' com
 * error='MULTI_TAB_CONFLICT').
 *
 * Por que isso acontece: OPFS permite apenas 1 SyncAccessHandle por
 * arquivo. Se outra aba do mesmo origin já segura `/drift.db`, esta aba
 * não consegue abrir o banco. Solução pragmática (Opção A): explicar
 * pro user e oferecer ações claras (fechar / recarregar). Cliente nativo
 * (Fase 6) e/ou BroadcastChannel + leader election ficam pra depois.
 *
 * Nota: window.close() só funciona em abas abertas via window.open() ou
 * via target=_blank a partir do próprio site — em outras situações o
 * browser silenciosamente ignora. Por isso o botão "Recarregar" também
 * é oferecido (nesse caso o user fecha a outra aba primeiro e clica
 * recarregar).
 */

import { motion } from 'framer-motion'

export function MultiTabModal() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-drift-bg/90 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="multi-tab-title"
    >
      <motion.div
        initial={{ y: 12 }}
        animate={{ y: 0 }}
        className="w-full max-w-md rounded border border-drift-border bg-drift-surface p-5 text-sm"
      >
        <h2
          id="multi-tab-title"
          className="mb-3 text-sm uppercase tracking-widest text-drift-accent"
        >
          Drift já está aberto em outra aba
        </h2>
        <p className="mb-4 text-[12px] text-slate-300">
          Cada aba precisa do mesmo banco local (OPFS), e só uma pode segurar
          por vez. Feche uma das abas pra continuar.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => window.close()}
            className="rounded border border-drift-border px-3 py-2 text-[11px] uppercase tracking-widest text-slate-300 hover:border-drift-accent hover:text-drift-accent"
          >
            Fechar esta aba
          </button>
          <button
            onClick={() => location.reload()}
            className="rounded border border-drift-accent bg-drift-accent/10 px-3 py-2 text-[11px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/20"
          >
            Recarregar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
