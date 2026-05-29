// Bug #2.2 (2026-05-28) — InstallDrift iOS card aparecia em Chromium/
// desktop. Causa: detecção usava `'ontouchend' in document` como proxy
// de iPad; Chromium desktop define a API touch independente de hardware.
//
// `isIosSafariUA(ua, maxTouchPoints)` é a versão pura da detecção. Lock:
// só retorna true pra iOS Safari real; nunca pra Chromium/Firefox/Edge
// desktop nem pra Chrome/Firefox em iOS (que têm install próprio).

import { describe, it, expect } from 'vitest'
import { isIosSafariUA } from '../src/hooks/useInstallPrompt'

// UAs representativos. maxTouchPoints: desktop = 0, iPhone/iPad = 5.
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

describe('isIosSafariUA — bug #2.2 platform detection', () => {
  it('reconhece iPhone Safari real', () => {
    expect(isIosSafariUA(IPHONE_SAFARI, 5)).toBe(true)
  })

  it('reconhece iPad Safari (UA Macintosh + multi-touch)', () => {
    expect(isIosSafariUA(IPAD_SAFARI, 5)).toBe(true)
  })

  it('NÃO mostra iOS card em Chromium desktop Windows (bug original)', () => {
    expect(isIosSafariUA(WINDOWS_CHROME, 0)).toBe(false)
  })

  it('NÃO mostra iOS card em Chrome desktop Mac (sem multi-touch)', () => {
    expect(isIosSafariUA(MAC_CHROME, 0)).toBe(false)
  })

  it('NÃO mostra iOS card em Safari desktop Mac (não é iOS)', () => {
    expect(isIosSafariUA(MAC_SAFARI, 0)).toBe(false)
  })

  it('NÃO mostra iOS card em Chrome iOS (tem install próprio, CriOS)', () => {
    expect(isIosSafariUA(IOS_CHROME, 5)).toBe(false)
  })

  it('NÃO mostra iOS card em Android Chrome (usa beforeinstallprompt)', () => {
    expect(isIosSafariUA(ANDROID_CHROME, 5)).toBe(false)
  })

  it('Chromium desktop Mac com touch emulado (maxTouchPoints=0) não dispara', () => {
    // Regressão direta do bug: ontouchend existia em Chromium, mas
    // maxTouchPoints continua 0 em desktop sem hardware touch.
    expect(isIosSafariUA(MAC_CHROME, 0)).toBe(false)
  })
})
