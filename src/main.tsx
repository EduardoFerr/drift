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
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
