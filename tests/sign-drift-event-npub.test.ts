/**
 * Tests — signDriftEvent({ signWithNpub }) (Task 1, lib core).
 *
 *  - signWithNpub presente → event.pubkey === npub escolhido (bytes
 *    emprestados via getIdentitySecretKey).
 *  - signWithNpub ausente → identidade ativa (getOrCreateIdentity),
 *    regressão do path atual.
 *
 * Mockam transport (pra não tocar rede) + identity (ativa) + identities
 * (getIdentitySecretKey). finalizeEvent/verifyEvent reais (puros).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'

const { getOrCreateIdentityMock, getIdentitySecretKeyMock } = vi.hoisted(() => ({
  getOrCreateIdentityMock: vi.fn(),
  getIdentitySecretKeyMock: vi.fn(),
}))

vi.mock('../src/lib/transport/wss', () => ({
  wssTransport: { publish: vi.fn(), subscribe: vi.fn(), health: vi.fn(async () => []) },
  pool: {},
}))
vi.mock('../src/lib/transport/orchestrator', () => ({
  orchestrator: { publish: vi.fn(async () => ({ ok: 0, failed: 0, perRelay: [] })) },
}))

vi.mock('../src/lib/identity', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/identity')>(
    '../src/lib/identity',
  )
  return {
    ...actual,
    getOrCreateIdentity: (...args: unknown[]) => getOrCreateIdentityMock(...args),
  }
})

vi.mock('../src/lib/identities', () => ({
  getIdentitySecretKey: (...args: unknown[]) => getIdentitySecretKeyMock(...args),
}))

import { signDriftEvent } from '../src/lib/nostr'

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0')
  return hex
}

const ACTIVE = generateSecretKey()
const ACTIVE_NPUB = getPublicKey(ACTIVE)
const ACTIVE_HEX = bytesToHex(ACTIVE)

const CHOSEN = generateSecretKey()
const CHOSEN_NPUB = getPublicKey(CHOSEN)

beforeEach(() => {
  getOrCreateIdentityMock.mockReset().mockResolvedValue({
    nsec: ACTIVE_HEX,
    npub: ACTIVE_NPUB,
    nsecBech32: 'nsec1x',
    npubBech32: 'npub1x',
    createdAt: 1,
  })
  // getIdentitySecretKey devolve cópia fresca (signDriftEvent vai .fill(0))
  getIdentitySecretKeyMock.mockReset().mockResolvedValue(CHOSEN.slice())
})

const INPUT = { kind: 9078, tags: [['client', 'drift']], content: '{}' }

describe('signDriftEvent — default (sem opts) → identidade ativa', () => {
  it('event.pubkey === ativa; getIdentitySecretKey NÃO chamado', async () => {
    const ev = await signDriftEvent(INPUT)
    expect(ev.pubkey).toBe(ACTIVE_NPUB)
    expect(verifyEvent(ev)).toBe(true)
    expect(getOrCreateIdentityMock).toHaveBeenCalledTimes(1)
    expect(getIdentitySecretKeyMock).not.toHaveBeenCalled()
  })
})

describe('signDriftEvent — signWithNpub → identidade escolhida', () => {
  it('event.pubkey === escolhido; ativa NÃO consultada', async () => {
    const ev = await signDriftEvent(INPUT, { signWithNpub: CHOSEN_NPUB })
    expect(ev.pubkey).toBe(CHOSEN_NPUB)
    expect(verifyEvent(ev)).toBe(true)
    expect(getIdentitySecretKeyMock).toHaveBeenCalledWith(CHOSEN_NPUB)
    expect(getOrCreateIdentityMock).not.toHaveBeenCalled()
  })

  it('zera (fill 0) os bytes emprestados após assinar', async () => {
    const borrowed = CHOSEN.slice()
    getIdentitySecretKeyMock.mockResolvedValue(borrowed)
    await signDriftEvent(INPUT, { signWithNpub: CHOSEN_NPUB })
    expect(borrowed.every((b) => b === 0)).toBe(true)
  })
})
