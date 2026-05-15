/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string
  readonly VITE_USE_NOSTR_SIGNALING?: '1'
  /** Fase 6.3: TURN servers pra mobile real (4G symmetric NAT).
   *  Comma-separated `turn:host:port?username=...&credential=...`.
   *  Default vazio (só STUN). Manifesto §28. */
  readonly VITE_TURN_SERVERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// permite importar .sql como string crua
declare module '*.sql?raw' {
  const content: string
  export default content
}

// Ted bundle audit 2026-05-15 §1.4 — `qrcode/lib/browser` é o entrypoint
// canvas-only do qrcode (sem PNG renderer Node, sem terminal). Package
// `exports` map só expõe ".", então sem declare module TS não acha.
declare module 'qrcode/lib/browser' {
  interface QRCodeToDataURLOptions {
    width?: number
    margin?: number
    color?: { dark?: string; light?: string }
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }
  function toDataURL(text: string, opts?: QRCodeToDataURLOptions): Promise<string>
  const _default: { toDataURL: typeof toDataURL }
  export default _default
  export { toDataURL }
}
