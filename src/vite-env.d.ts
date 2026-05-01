/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string
  readonly VITE_USE_NOSTR_SIGNALING?: '1'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// permite importar .sql como string crua
declare module '*.sql?raw' {
  const content: string
  export default content
}
