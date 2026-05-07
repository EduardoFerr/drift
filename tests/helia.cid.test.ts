/**
 * Track B.1 — testes de helpers puros de CID em `lib/helia`.
 *
 * O wrapper Helia em si depende de browser runtime (libp2p, IndexedDB,
 * WebRTC) e não roda em Node — smoke test ao vivo é manual no dev
 * console (`window.driftHelia.smokeTest()`). Mas os helpers de parse/
 * serialização de CID são funções puras que funcionam em qualquer
 * ambiente; cobrimos aqui pra garantir invariantes de wire format
 * (RFC §3.5.1 — formato CID Drift).
 */

import { describe, expect, it } from 'vitest'
import { cidFromString, cidToString, cidToIpfsUrl } from '../src/lib/helia'

// CID v1 raw + sha256 — formato canônico Drift (RFC §3.5.1).
// Gerado de "hello drift" com codec=raw, hash=sha2-256.
const KNOWN_CID_V1 = 'bafkreieq5jui4j25lacwomsqgjeswwl3y5fpovesozb6kcfsr7ye6kfp4q'

// CID v0 — base58 Qm prefix, ainda usado por gateways legacy
const KNOWN_CID_V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'

describe('cidFromString', () => {
  it('parseia CID v1 (bafy...)', async () => {
    const cid = await cidFromString(KNOWN_CID_V1)
    expect(cid.toString()).toBe(KNOWN_CID_V1)
    expect(cid.version).toBe(1)
  })

  it('parseia CID v0 (Qm...)', async () => {
    const cid = await cidFromString(KNOWN_CID_V0)
    expect(cid.toString()).toBe(KNOWN_CID_V0)
    expect(cid.version).toBe(0)
  })

  it('aceita prefixo ipfs:// (NIP-94 imeta wire format)', async () => {
    const cid = await cidFromString(`ipfs://${KNOWN_CID_V1}`)
    expect(cid.toString()).toBe(KNOWN_CID_V1)
  })

  it('rejeita string inválida', async () => {
    await expect(cidFromString('not-a-cid-at-all')).rejects.toThrow()
  })
})

describe('cidToString / cidToIpfsUrl', () => {
  it('round-trip preserva CID v1', async () => {
    const cid = await cidFromString(KNOWN_CID_V1)
    expect(cidToString(cid)).toBe(KNOWN_CID_V1)
  })

  it('cidToIpfsUrl prefixa com ipfs:// (formato wire NIP-94)', async () => {
    const cid = await cidFromString(KNOWN_CID_V1)
    expect(cidToIpfsUrl(cid)).toBe(`ipfs://${KNOWN_CID_V1}`)
  })

  it('cidToIpfsUrl é roundtrippable com cidFromString', async () => {
    const cid = await cidFromString(KNOWN_CID_V1)
    const url = cidToIpfsUrl(cid)
    const parsed = await cidFromString(url)
    expect(parsed.toString()).toBe(KNOWN_CID_V1)
  })
})
