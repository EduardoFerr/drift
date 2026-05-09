/**
 * LazyBoundary — combine ErrorBoundary + Suspense pra `React.lazy()`
 * chunks. Round CWV-2 §6.1 (Ted RFC) — fetch de chunk pode falhar em
 * conexão flaky; sem ErrorBoundary, `<Suspense>` fica preso no fallback
 * indefinidamente.
 *
 * Pattern:
 *   <LazyBoundary fallback={<DriftSkeleton variant="card" />}>
 *     <SettingsCards onClose={...} />
 *   </LazyBoundary>
 *
 * Em erro, mostra mensagem + botão retry. Retry incrementa internal
 * `key` → re-mount do tree → React 18 retenta o `import()` (que pode
 * voltar do cache de fetch ou re-baixar o chunk).
 *
 * Manifesto §10 (cliente leve) tangent: lazy chunks reduzem bundle
 * inicial sem comprometer experiência — falha visível e recuperável é
 * preferível a UI travada silenciosamente.
 */

import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'

interface LazyBoundaryProps {
  /** Suspense fallback enquanto chunk baixa. Default: null (overlay
   *  parent já tem framer-motion fade-in que mascara o gap). */
  fallback?: ReactNode
  children: ReactNode
}

interface LazyBoundaryState {
  hasError: boolean
  retryKey: number
}

class LazyErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: true } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[LazyBoundary] chunk load error', error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center gap-3 p-6 font-mono text-[11px] text-drift-muted"
          role="alert"
        >
          <p className="text-center leading-relaxed">
            erro ao carregar este painel.
            <br />
            verifique sua conexão e tente novamente.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false })
              this.props.onReset()
            }}
            className="rounded border border-drift-border px-4 py-2 uppercase tracking-meta text-drift-text transition-colors hover:border-drift-accent hover:text-drift-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-drift-accent2"
          >
            tentar novamente
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export class LazyBoundary extends Component<LazyBoundaryProps, LazyBoundaryState> {
  state: LazyBoundaryState = { hasError: false, retryKey: 0 }

  private handleReset = (): void => {
    // Bump key força re-mount do Suspense + lazy children → re-fetch
    // do chunk (React 18 caching pode servir do bundler cache se
    // disponível, ou disparar fetch novo).
    this.setState((s) => ({ retryKey: s.retryKey + 1 }))
  }

  render(): ReactNode {
    const { fallback = null, children } = this.props
    return (
      <LazyErrorBoundary key={this.state.retryKey} onReset={this.handleReset}>
        <Suspense fallback={fallback}>{children}</Suspense>
      </LazyErrorBoundary>
    )
  }
}
