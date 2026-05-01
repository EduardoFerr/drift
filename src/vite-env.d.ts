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
