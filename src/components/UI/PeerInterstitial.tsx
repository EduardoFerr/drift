/**
 * PeerInterstitial — confirmation dialog before connecting to a peer
 * via `?peer=nprofile1...` deep link.
 *
 * Barney deliberation (2026-05-16): link direto is ON by default, but
 * requires interstitial before calling connectTo(). Reason: IP leaks
 * via ICE candidates to the remote peer — user must consent explicitly.
 *
 * Flow:
 *   1. App.tsx detects `?peer=` in URL
 *   2. Pushes this layer with peerLink data
 *   3. User confirms → connectTo(npubHex) + pop layer
 *   4. User cancels → pop layer only
 *   5. cleanDeepLinkParams() runs regardless
 */

import { nip19 } from 'nostr-tools'
import { FullPageCard } from './FullPageCard'
import { DriftButton } from './DriftButton'

export interface PeerInterstitialProps {
  npubHex: string
  relayHints: string[]
  onConfirm: () => void
  onCancel: () => void
}

export function PeerInterstitial({
  npubHex,
  relayHints,
  onConfirm,
  onCancel,
}: PeerInterstitialProps) {
  const npubBech32 = nip19.npubEncode(npubHex)
  const short = npubBech32.slice(0, 16) + '...' + npubBech32.slice(-6)

  return (
    <FullPageCard
      title="conectar a peer"
      onClose={onCancel}
      clickOutToClose
      footer={
        <div className="flex gap-3 px-5 py-4">
          <DriftButton variant="cancel" size="lg" onClick={onCancel} className="flex-1">
            cancelar
          </DriftButton>
          <DriftButton variant="primary" size="lg" onClick={onConfirm} className="flex-1">
            conectar
          </DriftButton>
        </div>
      }
    >
      <div className="flex flex-col gap-5 px-5 py-6">
        <p className="text-[14px] leading-relaxed text-drift-text">
          Alguem compartilhou um link pra conectar diretamente com voce via P2P (WebRTC).
        </p>

        <div className="rounded-lg border border-drift-border bg-black/20 px-4 py-3">
          <span className="block font-mono text-[12px] text-drift-accent break-all">
            {short}
          </span>
          {relayHints.length > 0 && (
            <span className="mt-1 block text-[11px] text-drift-muted">
              {relayHints.length} relay hint{relayHints.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/10 px-4 py-3">
          <p className="text-[12px] leading-relaxed text-yellow-300/90">
            Conexao direta — seu IP sera visivel para este peer.
            So conecte com alguem que voce confia.
          </p>
        </div>
      </div>
    </FullPageCard>
  )
}
