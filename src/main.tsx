import React from 'react'
import ReactDOM from 'react-dom/client'
import { LazyMotion } from 'framer-motion'
import App from './App.tsx'
import { AppErrorBoundary } from './components/UI/AppErrorBoundary'
import './index.css'

// Lazy-load features de framer-motion num chunk separado. O entry só
// puxa o `m` primitive (~5 KB) + LazyMotion shell; `domMax` (~35 KB com
// animate/exit/initial/drag/layout) emite chunk próprio que carrega em
// paralelo com o React mount. Lighthouse 2026-05-15: vendor-motion
// virou entry-only ~12 KB raw + chunk separado pelo resto.
const loadMotionFeatures = () =>
  import('framer-motion').then((mod) => mod.domMax)

// DEV: expor webrtcTransport pra smoke test e2e em 2 abas.
// Acesso via console: `window.driftWebRTC.getPeers()` etc.
// Removido em build prod (tree-shaken pelo guard).
if (import.meta.env.DEV) {
  void import('./lib/transport/webrtc').then((m) => {
    ;(window as unknown as Record<string, unknown>).driftWebRTC = {
      transport: m.webrtcTransport,
      getPeers: m.getPeers,
      closeAll: m.closeAll,
      connectTo: m.connectTo,
      getMyPeerId: m.getMyPeerId,
      signalingMode:
        import.meta.env.VITE_USE_NOSTR_SIGNALING === '1' ? 'nostr' : 'mock',
    }
  })

  // Track B.1 (Helia spike) — expor lazy-loaded API pra smoke test
  // manual no console: `await window.driftHelia.smokeTest()`.
  // Helia só é baixado quando o user efetivamente chama um destes —
  // dynamic import() emite chunks separados (assets/helia-*.js).
  void import('./lib/helia').then((m) => {
    ;(window as unknown as Record<string, unknown>).driftHelia = {
      addBlob: m.addBlob,
      getBlob: m.getBlob,
      pinBlob: m.pinBlob,
      unpinBlob: m.unpinBlob,
      listPinned: m.listPinned,
      heliaStats: m.heliaStats,
      cidFromString: m.cidFromString,
      cidToString: m.cidToString,
      // Smoke test round-trip: add bytes → CID → get bytes → compara.
      // Validação ao vivo de B.1 antes de partir pra B.2.
      smokeTest: async () => {
        const bytes = new TextEncoder().encode('hello drift ' + Date.now())
        const cid = await m.addBlob(bytes)
        await m.pinBlob(cid)
        const out = await m.getBlob(cid)
        const stats = await m.heliaStats()
        const ok = bytes.byteLength === out.byteLength &&
          bytes.every((b, i) => b === out[i])
        return { ok, cid: m.cidToString(cid), bytes: bytes.byteLength, stats }
      },
    }
  })
}

// LazyMotion: substitui o bundle "full" do framer-motion (que carrega
// TODAS as features) por um core mínimo + features carregadas sob
// demanda em chunk SEPARADO. Componentes usam `m.*` (~5 KB) em vez de
// `motion.*` (~30 KB). Passando `features` como factory async, o bundler
// emite as features num chunk próprio que carrega async no mount.
//
// `domMax` (resolved lazy) = `domAnimation` + drag + layout. Cobre todos
// os usos do Drift (animate/exit/initial em ~17 componentes, drag no
// SwipeHandler, `layoutId` no FeedTabs). `strict` faz `motion.*` direto
// lançar erro em dev — força adoção do `m.*` (evita regressão).
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <LazyMotion features={loadMotionFeatures} strict>
        <App />
      </LazyMotion>
    </AppErrorBoundary>
  </React.StrictMode>,
)
