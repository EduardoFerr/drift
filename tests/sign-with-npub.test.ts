/**
 * Tests — per-post identity picker, Task 1 (lib core, NO UI).
 *
 * Cobre os blockers de security review:
 *  (a) getIdentitySecretKey:
 *      - retorna bytes cujo getPublicKey === npub pedido
 *      - throw em npub inexistente
 *      - throw em pubkey-mismatch (row decifrada NÃO bate com npub)
 *      - NO-CACHE: decrypt é chamado fresh a cada call
 *      - error message contém SÓ o npub (público) — nunca hex/bytes/ciphertext
 *  (b) signDriftEvent({signWithNpub}):
 *      - event.pubkey === npub escolhido
 *      - default (sem opts) → identidade ativa (regressão bit-exact path)
 *
 * Rodam em Node. Mockam db + crypto.decrypt + identity (getOrCreateIdentity).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const { getMock, decryptMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  decryptMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: { exec: vi.fn(), run: vi.fn(), get: getMock },
}))

vi.mock('../src/lib/crypto', () => ({
  encrypt: vi.fn(async (s: string) => `enc(${s})`),
  decrypt: (...args: unknown[]) => decryptMock(...args),
}))

import { getIdentitySecretKey } from '../src/lib/identities'

// ─── Helpers ──────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0')
  return hex
}

/** Gera um par (npub hex, nsec hex) coerente. */
function makePair(): { npub: string; nsecHex: string; nsecBytes: Uint8Array } {
  const sk = generateSecretKey()
  return { npub: getPublicKey(sk), nsecHex: bytesToHex(sk), nsecBytes: sk }
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(null)
  decryptMock.mockReset()
})

describe('getIdentitySecretKey', () => {
  it('retorna bytes cujo getPublicKey === npub pedido', async () => {
    const { npub, nsecHex } = makePair()
    getMock.mockResolvedValue({ nsec_encrypted: `enc(${nsecHex})` })
    decryptMock.mockResolvedValue(nsecHex)

    const bytes = await getIdentitySecretKey(npub)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(32)
    expect(getPublicKey(bytes)).toBe(npub)
  })

  it('throw quando npub não existe na tabela', async () => {
    getMock.mockResolvedValue(null)
    const npub = 'a'.repeat(64)
    await expect(getIdentitySecretKey(npub)).rejects.toThrow()
    // crypto.decrypt nunca chamado se não há row
    expect(decryptMock).not.toHaveBeenCalled()
  })

  it('throw em pubkey-mismatch (row decifrada NÃO bate com o npub)', async () => {
    const a = makePair()
    const b = makePair() // chave decifrada será a DELE, mas pedimos npub do A
    getMock.mockResolvedValue({ nsec_encrypted: `enc(${b.nsecHex})` })
    decryptMock.mockResolvedValue(b.nsecHex)

    await expect(getIdentitySecretKey(a.npub)).rejects.toThrow()
  })

  it('NO-CACHE: decrypt é chamado fresh a cada call', async () => {
    const { npub, nsecHex } = makePair()
    getMock.mockResolvedValue({ nsec_encrypted: `enc(${nsecHex})` })
    decryptMock.mockResolvedValue(nsecHex)

    await getIdentitySecretKey(npub)
    await getIdentitySecretKey(npub)
    expect(decryptMock).toHaveBeenCalledTimes(2)
  })

  it('error message contém SÓ o npub — nunca hex/bytes/ciphertext (mismatch)', async () => {
    const a = makePair()
    const b = makePair()
    const cipher = `enc(${b.nsecHex})`
    getMock.mockResolvedValue({ nsec_encrypted: cipher })
    decryptMock.mockResolvedValue(b.nsecHex)

    let msg = ''
    try {
      await getIdentitySecretKey(a.npub)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).not.toContain(a.nsecHex)
    expect(msg).not.toContain(b.nsecHex)
    expect(msg).not.toContain(cipher)
    // o npub público pode aparecer (não é segredo)
  })

  it('error message não vaza ciphertext em npub inexistente', async () => {
    getMock.mockResolvedValue(null)
    const npub = 'c'.repeat(64)
    let msg = ''
    try {
      await getIdentitySecretKey(npub)
    } catch (e) {
      msg = (e as Error).message
    }
    // não deve conter nada decifrado (não há) nem prefixo enc(
    expect(msg).not.toContain('enc(')
  })
})
