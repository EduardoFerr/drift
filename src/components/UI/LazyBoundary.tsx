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
 * Retry behavior (IMPORTANTE):
 *   `React.lazy()` cacheia a Promise INTERNAMENTE — se um `import()`
 *   rejeita (chunk 404, network fail, stale SW), re-montar o tree
 *   não retenta o fetch porque a Promise rejeitada já está cached.
 *   Solução pragmática: `window.location.reload()` no retry, que
 *   garante novo fetch + nova instância de `lazy()`. Em casos de
 *   chunk fantasma após deploy (SW serving stale precache list),
 *   tentamos também limpar o SW cache antes do reload.
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

/**
 * Tenta limpar caches do service worker antes de reload — útil quando
 * o SW está servindo um precache list stale após deploy. Falha silente:
 * se a API não existe ou rejeita, o reload sozinho ainda resolve a
 * maioria dos casos.
 */
async function clearServiceWorkerAndReload(): Promise<void> {
  try {
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[LazyBoundary] cache clear failed', err)
  }
  // Force GET (ignore HTTP cache) — alguns browsers honram esse flag.
  window.location.reload()
}

class LazyErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean; clearing: boolean }
> {
  state = { hasError: false, clearing: false }

  static getDerivedStateFromError(): { hasError: true } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[LazyBoundary] chunk load error', error, info)
  }

  private handleRetry = (): void => {
    if (this.state.clearing) return
    this.setState({ clearing: true })
    void clearServiceWorkerAndReload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center gap-4 p-8"
          role="alert"
        >
          <div className="w-full max-w-sm rounded-2xl border border-drift-warning/20 bg-drift-warning/5 px-5 py-5">
            <div className="mb-2 font-display text-[13px] font-bold uppercase tracking-tag text-drift-warning">
              não foi possível carregar
            </div>
            <p className="font-mono text-[11px] leading-relaxed text-drift-warning/60">
              falha ao baixar este painel. pode ser cache antigo após atualização ou conexão instável.
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            disabled={this.state.clearing}
            className="w-full max-w-sm rounded-xl bg-drift-accent2 px-4 py-3 font-mono text-[12px] uppercase tracking-meta font-medium text-drift-bg transition-colors hover:bg-drift-accent2/85 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-drift-accent2/40"
          >
            {this.state.clearing ? 'recarregando…' : '↻ recarregar'}
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
    // Bump key força re-mount — mas note que React.lazy() cacheia a
    // Promise; o retry real (reload da página) é feito dentro do
    // LazyErrorBoundary. Esse bump é defensivo caso o filho não-lazy
    // tenha errado.
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
