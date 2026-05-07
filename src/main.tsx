import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
