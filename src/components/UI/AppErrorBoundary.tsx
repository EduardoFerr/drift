/**
 * AppErrorBoundary — fallback de último recurso pra qualquer exception
 * não capturada na árvore de render do Drift.
 *
 * `LazyBoundary` já cobre erros de fetch em `React.lazy()`; este boundary
 * é o catch-all do root. Sem ele, qualquer crash em App.tsx / boot /
 * componente eagerly-mounted vira tela branca silenciosa — UX hostil
 * (user reabre, mesmo erro acontece, sem caminho de saída).
 *
 * Comportamento:
 *   1. Captura via `getDerivedStateFromError` (state.error)
 *   2. Renderiza fallback ASCII-style (font-mono)
 *   3. "↻ Recarregar" reload simples
 *   4. "↻ Limpar cache e recarregar" abre modal CUSTOM INLINE (B-UX-3
 *      P0 threat fix 2026-05-23): substitui `window.confirm` nativo
 *      por flow de 2 etapas — export do nsec primeiro, depois apagar.
 *      Modal vive dentro do boundary (não usa `dialog.confirm` porque
 *      `DialogHost` monta dentro do App, e o boundary monta acima).
 *      Sem Zustand, sem Framer Motion, sem providers — só class state.
 *   5. Loga em `console.error`
 *
 * Manifesto §3 — dispositivo descartável, identidade NÃO. User em
 * estado de erro tem direito de saber que apagar TUDO sem exportar
 * o nsec = perda permanente da conta. §17 — sem telemetria silenciosa.
 *
 * Class component (não function) porque `componentDidCatch` /
 * `getDerivedStateFromError` exigem class API. React 18 não mudou isso.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshIcon } from './Icons'

interface Props {
  children: ReactNode
}

type WipeStep = 'idle' | 'warn' | 'final' | 'wiping'

interface State {
  error: Error | null
  wipeStep: WipeStep
  exportedNsec: string | null
  exportFailed: boolean
  copied: boolean
}

const INITIAL_STATE: State = {
  error: null,
  wipeStep: 'idle',
  exportedNsec: null,
  exportFailed: false,
  copied: false,
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = INITIAL_STATE

  static getDerivedStateFromError(error: Error): State {
    return { ...INITIAL_STATE, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log estruturado pro DevTools. Stack do React em info.componentStack.
    console.error('[AppErrorBoundary] caught:', error)
    console.error('[AppErrorBoundary] componentStack:', info.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  // Abre etapa 1 do modal — tenta exportar nsec (best-effort) e mostra
  // texto pro user copiar ANTES de apagar. Se export falhar (db pode
  // estar corrompido — é exatamente o cenário de erro), mostra warning
  // explícito de que nsec é irrecuperável.
  openWipeWarn = async (): Promise<void> => {
    this.setState({ wipeStep: 'warn' })
    try {
      // Import dinâmico evita acoplar identity.ts (e seu cadeia de
      // imports SQLite) ao boundary em condições normais.
      const { exportIdentity } = await import('../../lib/identity')
      const id = await exportIdentity()
      this.setState({ exportedNsec: id.nsecBech32, exportFailed: false })
    } catch (err) {
      console.warn('[AppErrorBoundary] export nsec falhou:', err)
      this.setState({ exportedNsec: null, exportFailed: true })
    }
  }

  closeWipeModal = (): void => {
    this.setState({
      wipeStep: 'idle',
      exportedNsec: null,
      exportFailed: false,
      copied: false,
    })
  }

  copyNsec = async (): Promise<void> => {
    const nsec = this.state.exportedNsec
    if (!nsec) return
    try {
      await navigator.clipboard.writeText(nsec)
      this.setState({ copied: true })
    } catch (err) {
      console.warn('[AppErrorBoundary] clipboard falhou:', err)
    }
  }

  proceedToFinal = (): void => {
    this.setState({ wipeStep: 'final' })
  }

  doWipe = async (): Promise<void> => {
    this.setState({ wipeStep: 'wiping' })
    try {
      const dbs = await indexedDB.databases?.()
      if (dbs) {
        for (const { name } of dbs) {
          if (name) indexedDB.deleteDatabase(name)
        }
      }
      // OPFS — só Chromium expõe API direto; tentativa best-effort.
      const root = await (
        navigator as unknown as {
          storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
        }
      ).storage?.getDirectory?.()
      if (root) {
        for await (const [name] of (
          root as unknown as {
            entries: () => AsyncIterable<[string, FileSystemHandle]>
          }
        ).entries()) {
          await root.removeEntry(name, { recursive: true }).catch(() => {})
        }
      }
    } catch (err) {
      console.warn('[AppErrorBoundary] limpeza falhou (parcial):', err)
    }
    window.location.reload()
  }

  renderWipeModal(): ReactNode {
    const { wipeStep, exportedNsec, exportFailed, copied } = this.state
    if (wipeStep === 'idle') return null

    const wiping = wipeStep === 'wiping'

    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-drift-bg p-4"
        // Backdrop OPACO (não translúcido) — coerente com fix B7+B9.
        // Estado de erro merece ainda mais clareza visual.
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="drift-wipe-title"
          aria-describedby="drift-wipe-desc"
          className="w-full max-w-md space-y-4 rounded border border-drift-danger bg-drift-surface p-5"
        >
          <h2
            id="drift-wipe-title"
            className="font-display text-lg font-bold uppercase tracking-tag text-drift-danger"
          >
            apagar tudo localmente
          </h2>

          <div
            id="drift-wipe-desc"
            className="space-y-2 font-mono text-[12px] leading-relaxed text-drift-text"
          >
            <p>· Isso apaga sua identidade Drift local.</p>
            <p>
              · Se você não exportou o nsec,{' '}
              <strong className="text-drift-danger">você perde a conta</strong>
              .
            </p>
            <p className="text-drift-muted">
              · Manifesto §3: dispositivo descartável, identidade não.
            </p>
          </div>

          {wipeStep === 'warn' && (
            <div className="space-y-3">
              {exportedNsec && (
                <div className="rounded border border-drift-accent/60 bg-drift-bg/60 p-3">
                  <div className="mb-1 font-mono text-[11px] uppercase tracking-meta text-drift-muted">
                    seu nsec (copie antes de continuar)
                  </div>
                  <textarea
                    readOnly
                    value={exportedNsec}
                    aria-label="nsec para backup"
                    className="h-20 w-full resize-none break-all bg-transparent font-mono text-[11px] text-drift-text outline-none"
                  />
                  <button
                    onClick={() => void this.copyNsec()}
                    className="mt-2 w-full rounded border border-drift-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/10"
                  >
                    {copied ? '✓ copiado' : 'copiar nsec'}
                  </button>
                </div>
              )}
              {exportFailed && (
                <div className="rounded border border-drift-danger/60 bg-drift-danger/5 p-3 font-mono text-[11px] text-drift-danger">
                  Export do nsec FALHOU (banco local pode estar corrompido).
                  Se você não tem backup externo, apagar agora{' '}
                  <strong>perde a identidade permanentemente</strong>.
                </div>
              )}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={this.closeWipeModal}
                  className="w-full rounded border border-drift-accent bg-drift-accent/5 px-4 py-2 font-mono text-[12px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
                >
                  voltar (não apagar)
                </button>
                <button
                  onClick={this.proceedToFinal}
                  className="w-full rounded border border-drift-border px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-muted hover:bg-drift-bg/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
                >
                  apagar tudo mesmo assim
                </button>
              </div>
            </div>
          )}

          {(wipeStep === 'final' || wiping) && (
            <div className="space-y-3">
              <div className="rounded border border-drift-danger/60 bg-drift-danger/5 p-3 font-mono text-[12px] text-drift-danger">
                Última confirmação: vai apagar IndexedDB + OPFS. Sem volta.
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={this.closeWipeModal}
                  disabled={wiping}
                  className="w-full rounded border border-drift-accent bg-drift-accent/5 px-4 py-2 font-mono text-[12px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/15 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
                >
                  cancelar
                </button>
                <button
                  onClick={() => void this.doWipe()}
                  disabled={wiping}
                  className="w-full rounded border border-drift-border px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-muted hover:bg-drift-bg/40 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
                >
                  {wiping ? 'apagando…' : 'confirmar apagar tudo'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    const err = this.state.error
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null

    return (
      <div
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-drift-bg p-6 text-drift-text"
      >
        <div className="w-full max-w-md space-y-5 rounded border border-drift-danger/60 bg-drift-surface p-5">
          <div className="space-y-2">
            <h1 className="font-display text-lg font-bold uppercase tracking-tag text-drift-danger">
              algo quebrou
            </h1>
            <p className="font-mono text-[12px] leading-relaxed text-drift-muted">
              Drift travou aqui. Não é a internet — algo no app local. Tenta
              recarregar primeiro; se persistir, limpe o cache (perde estado
              local — backup do nsec recupera identidade).
            </p>
          </div>

          <div className="rounded border border-drift-border bg-drift-bg/60 p-3">
            <div className="font-mono text-[12px] uppercase tracking-meta text-drift-muted">
              mensagem
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[12px] text-drift-text">
              {msg}
            </pre>
          </div>

          {stack && (
            <details className="rounded border border-drift-border bg-drift-bg/60 p-3">
              <summary className="cursor-pointer font-mono text-[12px] uppercase tracking-meta text-drift-muted hover:text-drift-text">
                stack trace (debug)
              </summary>
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-drift-muted">
                {stack}
              </pre>
            </details>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={this.handleReload}
              className="flex w-full items-center justify-center gap-2 rounded border border-drift-accent px-4 py-2 font-mono text-[12px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            >
              <RefreshIcon size={14} /> Recarregar
            </button>
            <button
              onClick={() => void this.openWipeWarn()}
              className="flex w-full items-center justify-center gap-2 rounded border border-drift-danger/60 bg-drift-danger/5 px-4 py-2 font-mono text-[12px] uppercase tracking-meta text-drift-danger hover:bg-drift-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            >
              <RefreshIcon size={14} /> Limpar cache e recarregar
            </button>
          </div>
        </div>

        {this.renderWipeModal()}
      </div>
    )
  }
}
