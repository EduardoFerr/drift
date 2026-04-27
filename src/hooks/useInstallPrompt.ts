/**
 * useInstallPrompt — captura `beforeinstallprompt` do browser, expõe
 * função pra disparar o prompt nativo, e detecta iOS pra mostrar
 * instruções manuais (iOS Safari não tem API de install programático).
 *
 * Manifesto §1 (Existência Autônoma) — instalar como PWA é um caminho
 * de acesso ao Drift independente de loja de apps. Combinado com APK
 * direto (Fase 5.x) e Tauri (Fase 6), formam as alternativas pra
 * cenários onde stores são bloqueadas ou removem o app.
 *
 * Três estados possíveis:
 *   - `kind: 'native'`   — Chrome Android/desktop, Edge: dispara prompt
 *                          via `install()`.
 *   - `kind: 'ios-safari'` — iOS Safari: sem API, UI mostra instruções
 *                          "Compartilhar → Adicionar à Tela de Início".
 *   - `kind: 'unavailable'` — Firefox desktop, app já instalado, ou
 *                            browser sem suporte.
 *
 * Banner é dispensável; flag persiste em localStorage.
 */

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallKind = 'native' | 'ios-safari' | 'unavailable'

export interface InstallPromptState {
  /** Se o banner deve aparecer (não dismissed + alguma forma de instalar). */
  available: boolean
  /** Tipo de fluxo de instalação suportado neste browser. */
  kind: InstallKind
  /** Dispara prompt nativo. No iOS retorna 'unavailable' — UI mostra instrução. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  dismissed: boolean
  setDismissed: (v: boolean) => void
}

const DISMISS_KEY = 'drift-install-dismissed'

function detectIosSafari(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  // iOS = iPhone | iPad | iPod, OU iPad moderno reportando como Mac com
  // touch (iPadOS 13+). Safari = não-Chrome (CriOS), não-Firefox (FxiOS).
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && 'ontouchend' in document)
  const isSafari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  return isIOS && isSafari
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari expõe `navigator.standalone` quando rodando como
    // home-screen app — sinal de que já está instalado.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

export function useInstallPrompt(): InstallPromptState {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosSafari, setIosSafari] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    setIosSafari(detectIosSafari())
    setInstalled(isStandalone())

    function onBeforeInstall(e: Event) {
      e.preventDefault()
      setEvt(e as BeforeInstallPromptEvent)
    }
    function onInstalled() {
      setEvt(null)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!evt) return 'unavailable'
    await evt.prompt()
    const choice = await evt.userChoice
    setEvt(null)
    if (choice.outcome === 'dismissed') {
      persistDismiss(true)
      setDismissed(true)
    }
    return choice.outcome
  }

  function setDismissedPersist(v: boolean) {
    setDismissed(v)
    persistDismiss(v)
  }

  // Determina o kind. Native ganha se temos `evt`; senão iOS Safari
  // fallback; senão sem suporte.
  const kind: InstallKind = evt
    ? 'native'
    : iosSafari && !installed
    ? 'ios-safari'
    : 'unavailable'

  const available = !installed && !dismissed && kind !== 'unavailable'

  return {
    available,
    kind,
    install,
    dismissed,
    setDismissed: setDismissedPersist,
  }
}

function persistDismiss(v: boolean): void {
  try {
    if (v) localStorage.setItem(DISMISS_KEY, '1')
    else localStorage.removeItem(DISMISS_KEY)
  } catch {
    /* storage cheio ou indisponível — apenas continue */
  }
}
