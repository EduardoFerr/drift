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
 *
 * V3.4 reskin: consome `<SlideUpOverlay>` + `<ModalHeader hideClose>`.
 * `backdropDismissible={false}` — user precisa decidir explicitamente
 * (não pode dispensar por click out).
 */

import { SlideUpOverlay } from './SlideUpOverlay'
import { ModalHeader } from './ModalHeader'

export function MultiTabModal() {
  return (
    <SlideUpOverlay
      onClose={() => {}}
      backdropDismissible={false}
      ariaLabel="Drift já está aberto em outra aba"
    >
      <ModalHeader
        title="Drift já está aberto em outra aba"
        onClose={() => {}}
        hideClose
      />
      <p className="mb-4 text-[12px] text-drift-text">
        Cada aba precisa do mesmo banco local (OPFS), e só uma pode segurar
        por vez. Feche uma das abas pra continuar.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={() => window.close()}
          className="rounded border border-drift-border px-3 py-2 text-[12px] uppercase tracking-widest text-drift-text hover:border-drift-accent hover:text-drift-accent"
        >
          Fechar esta aba
        </button>
        <button
          onClick={() => location.reload()}
          className="rounded border border-drift-accent bg-drift-accent/10 px-3 py-2 text-[12px] uppercase tracking-widest text-drift-accent hover:bg-drift-accent/20"
        >
          Recarregar
        </button>
      </div>
    </SlideUpOverlay>
  )
}
