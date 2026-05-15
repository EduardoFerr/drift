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
 *   2. Renderiza fallback ASCII-style (font-mono) com:
 *      - Texto curto explicando que algo quebrou
 *      - Mensagem do erro (typeof Error)
 *      - "↻ Recarregar" — `location.reload()`
 *      - "↻ Limpar cache e recarregar" — drop IndexedDB + reload (último
 *        recurso quando schema/state corrompido)
 *   3. Loga em `console.error` (já vai pro Sentry no futuro)
 *
 * Manifesto §17 (sem chave mestra) — esse boundary NÃO envia
 * telemetria silenciosa. User vê o erro e decide o que fazer.
 *
 * Class component (não function) porque `componentDidCatch` /
 * `getDerivedStateFromError` exigem class API. React 18 não mudou isso.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

const INITIAL_STATE: State = { error: null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = INITIAL_STATE

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log estruturado pro DevTools. Stack do React em info.componentStack.
    console.error('[AppErrorBoundary] caught:', error)
    console.error('[AppErrorBoundary] componentStack:', info.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleClearAndReload = async (): Promise<void> => {
    // Drop IndexedDB do app (SQLite WASM + Helia datastore se houver).
    // Manifesto §3 — identidade portável: se o user tem nsec backup,
    // re-importa após reload. Sem backup, perde identidade — mostramos
    // aviso antes via confirm.
    const ok = window.confirm(
      'Isso vai apagar TUDO armazenado localmente (posts, identidade, configurações). ' +
        'Se você tem o nsec backupado, pode re-importar depois.\n\nContinuar?',
    )
    if (!ok) return
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
            <p className="font-mono text-[11px] leading-relaxed text-drift-muted">
              Drift travou aqui. Não é a internet — algo no app local. Tenta
              recarregar primeiro; se persistir, limpe o cache (perde estado
              local — backup do nsec recupera identidade).
            </p>
          </div>

          <div className="rounded border border-drift-border bg-drift-bg/60 p-3">
            <div className="font-mono text-[9px] uppercase tracking-meta text-drift-muted">
              mensagem
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-drift-text">
              {msg}
            </pre>
          </div>

          {stack && (
            <details className="rounded border border-drift-border bg-drift-bg/60 p-3">
              <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-meta text-drift-muted hover:text-drift-text">
                stack trace (debug)
              </summary>
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed text-drift-muted">
                {stack}
              </pre>
            </details>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={this.handleReload}
              className="w-full rounded border border-drift-accent px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-accent hover:bg-drift-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            >
              ↻ Recarregar
            </button>
            <button
              onClick={() => void this.handleClearAndReload()}
              className="w-full rounded border border-drift-danger/60 bg-drift-danger/5 px-4 py-2 font-mono text-[11px] uppercase tracking-meta text-drift-danger hover:bg-drift-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2"
            >
              ↻ Limpar cache e recarregar
            </button>
          </div>
        </div>
      </div>
    )
  }
}
