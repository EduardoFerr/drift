import { describe, expect, it, vi, beforeEach } from 'vitest'

const { execMock, runMock, getMock, encryptMock, decryptMock, resetMasterKeyMock } = vi.hoisted(
  () => ({
    execMock: vi.fn(),
    runMock: vi.fn(),
    getMock: vi.fn(),
    encryptMock: vi.fn(),
    decryptMock: vi.fn(),
    resetMasterKeyMock: vi.fn(),
  }),
)

vi.mock('../src/lib/db', () => ({
  db: { exec: execMock, run: runMock, get: getMock },
}))

vi.mock('../src/lib/crypto', () => ({
  encrypt: (...args: unknown[]) => encryptMock(...args),
  decrypt: (...args: unknown[]) => decryptMock(...args),
  resetMasterKey: () => resetMasterKeyMock(),
}))

import {
  getOrCreateIdentity,
  setIdentityFromNsec,
  exportIdentity,
  resetIdentity,
  getCurrentNpub,
  clearIdentityCache,
  nsecHexToBytes,
} from '../src/lib/identity'

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'

// ─── Helpers ─────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

function makeTestKey(): { sk: Uint8Array; skHex: string; nsec1: string; npub: string } {
  const sk = generateSecretKey()
  const skHex = bytesToHex(sk)
  const nsec1 = nip19.nsecEncode(sk)
  const npub = getPublicKey(sk)
  return { sk, skHex, nsec1, npub }
}

beforeEach(() => {
  clearIdentityCache()
  execMock.mockReset().mockResolvedValue([])
  runMock.mockReset().mockResolvedValue(undefined)
  getMock.mockReset().mockResolvedValue(null)
  encryptMock.mockReset().mockResolvedValue('encrypted-blob')
  decryptMock.mockReset()
  resetMasterKeyMock.mockReset().mockResolvedValue(undefined)
})

// ─── getOrCreateIdentity ─────────────────────────────────────────────

describe('getOrCreateIdentity', () => {
  it('cria nova identidade quando banco está vazio', async () => {
    getMock.mockResolvedValue(null)

    const id = await getOrCreateIdentity()

    // Deve ter 64 chars hex no nsec
    expect(id.nsec).toMatch(/^[0-9a-f]{64}$/)
    // npub também é 64 chars hex
    expect(id.npub).toMatch(/^[0-9a-f]{64}$/)
    // Formatos bech32
    expect(id.nsecBech32).toMatch(/^nsec1/)
    expect(id.npubBech32).toMatch(/^npub1/)
    // Timestamp razoável
    expect(id.createdAt).toBeGreaterThan(0)
    expect(id.createdAt).toBeLessThanOrEqual(Date.now())
  })

  it('persiste identidade nova com nsec encriptado no SQLite', async () => {
    getMock.mockResolvedValue(null)

    await getOrCreateIdentity()

    // encrypt deve ter sido chamado com o nsec hex
    expect(encryptMock).toHaveBeenCalledTimes(1)
    const encryptedInput = encryptMock.mock.calls[0]![0] as string
    expect(encryptedInput).toMatch(/^[0-9a-f]{64}$/)

    // db.run deve ter sido chamado com INSERT
    expect(runMock).toHaveBeenCalledTimes(1)
    const sql = runMock.mock.calls[0]![0] as string
    expect(sql).toContain('INSERT INTO identity')
    // O valor persistido é o blob encriptado, NUNCA o hex claro
    const params = runMock.mock.calls[0]![1] as unknown[]
    expect(params[1]).toBe('encrypted-blob')
  })

  it('nsec hex NUNCA é persistido em claro no SQLite (manifesto §8)', async () => {
    getMock.mockResolvedValue(null)

    const id = await getOrCreateIdentity()

    // Verificar que o nsec hex não aparece nos params do INSERT
    const params = runMock.mock.calls[0]![1] as unknown[]
    expect(params[1]).not.toBe(id.nsec)
    expect(params[1]).toBe('encrypted-blob')
  })

  it('retorna identidade existente do banco (decifra nsec)', async () => {
    const key = makeTestKey()

    getMock.mockResolvedValue({
      npub: key.npub,
      nsec_encrypted: 'stored-encrypted-blob',
      created_at: 1700000000000,
    })
    decryptMock.mockResolvedValue(key.skHex)

    const id = await getOrCreateIdentity()

    expect(decryptMock).toHaveBeenCalledWith('stored-encrypted-blob')
    expect(id.nsec).toBe(key.skHex)
    expect(id.npub).toBe(key.npub)
    expect(id.nsecBech32).toBe(key.nsec1)
    expect(id.createdAt).toBe(1700000000000)
  })

  it('usa cache na segunda chamada — não faz query extra', async () => {
    getMock.mockResolvedValue(null)

    const id1 = await getOrCreateIdentity()
    const id2 = await getOrCreateIdentity()

    // Mesma referência (cache)
    expect(id1).toBe(id2)
    // db.get chamado apenas na primeira vez
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('se decrypt falha, reseta identidade e cria nova', async () => {
    getMock
      .mockResolvedValueOnce({
        npub: 'a'.repeat(64),
        nsec_encrypted: 'corrupted-blob',
        created_at: 1000,
      })
      // Após reset, banco está vazio pra criação de nova identidade
      .mockResolvedValueOnce(null)

    decryptMock.mockRejectedValue(new Error('decrypt failed'))

    const id = await getOrCreateIdentity()

    // Deve ter resetado (DELETE + resetMasterKey)
    expect(resetMasterKeyMock).toHaveBeenCalled()
    // Deve ter criado identidade nova
    expect(id.nsec).toMatch(/^[0-9a-f]{64}$/)
    expect(encryptMock).toHaveBeenCalled()
  })
})

// ─── exportIdentity ──────────────────────────────────────────────────

describe('exportIdentity', () => {
  it('retorna identidade com nsec1-prefixed (bech32)', async () => {
    getMock.mockResolvedValue(null)

    const id = await exportIdentity()

    expect(id.nsecBech32).toMatch(/^nsec1/)
    expect(id.npubBech32).toMatch(/^npub1/)
  })

  it('retorna mesma identidade que getOrCreateIdentity', async () => {
    getMock.mockResolvedValue(null)

    const id = await getOrCreateIdentity()
    const exported = await exportIdentity()

    expect(exported).toBe(id)
  })

  it('nsecBech32 decodifica de volta pro mesmo nsec hex', async () => {
    getMock.mockResolvedValue(null)

    const id = await exportIdentity()

    const decoded = nip19.decode(id.nsecBech32)
    expect(decoded.type).toBe('nsec')
    const roundtrip = bytesToHex(decoded.data as Uint8Array)
    expect(roundtrip).toBe(id.nsec)
  })
})

// ─── setIdentityFromNsec ─────────────────────────────────────────────

describe('setIdentityFromNsec', () => {
  it('importa nsec1 válido e retorna identidade correspondente', async () => {
    const key = makeTestKey()

    const id = await setIdentityFromNsec(key.nsec1)

    expect(id.nsec).toBe(key.skHex)
    expect(id.npub).toBe(key.npub)
    expect(id.nsecBech32).toBe(key.nsec1)
  })

  it('persiste nsec importado encriptado — nunca em claro', async () => {
    const key = makeTestKey()

    await setIdentityFromNsec(key.nsec1)

    // encrypt recebe o hex do nsec
    expect(encryptMock).toHaveBeenCalledWith(key.skHex)
    // INSERT recebe o blob encriptado
    const params = runMock.mock.calls.find((c) => {
      const sql = c[0] as string
      return sql.includes('INSERT INTO identity')
    })
    expect(params).toBeTruthy()
    expect(params![1]![1]).toBe('encrypted-blob')
  })

  it('reseta identidade anterior antes de importar', async () => {
    const key = makeTestKey()

    await setIdentityFromNsec(key.nsec1)

    // resetIdentity chama DELETE FROM identity + resetMasterKey
    const deleteCalls = runMock.mock.calls.filter((c) => {
      const sql = c[0] as string
      return sql.includes('DELETE FROM identity')
    })
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1)
    expect(resetMasterKeyMock).toHaveBeenCalled()
  })

  it('aceita nsec1 com espaços ao redor (trim)', async () => {
    const key = makeTestKey()

    const id = await setIdentityFromNsec(`  ${key.nsec1}  `)

    expect(id.nsec).toBe(key.skHex)
  })

  it('rejeita string que não começa com nsec1', async () => {
    await expect(setIdentityFromNsec('npub1abc')).rejects.toThrow(/nsec1/)
    await expect(setIdentityFromNsec('abc123')).rejects.toThrow(/nsec1/)
    await expect(setIdentityFromNsec('')).rejects.toThrow(/nsec1/)
  })

  it('rejeita bech32 corrompido', async () => {
    await expect(setIdentityFromNsec('nsec1invalidbech32data')).rejects.toThrow(
      /corrompido|inválid/i,
    )
  })

  it('rejeita nsec1 que decodifica pra tipo errado', async () => {
    // npub1 codificado como nsec1 — impossível na prática mas
    // testa o guard de decoded.type
    const key = makeTestKey()
    const npub1 = nip19.npubEncode(key.npub)

    await expect(setIdentityFromNsec(npub1)).rejects.toThrow(/nsec1/)
  })

  it('db.run não é chamado se validação falha', async () => {
    try {
      await setIdentityFromNsec('invalid')
    } catch {
      // esperado
    }
    // Nenhuma operação no banco
    expect(runMock).not.toHaveBeenCalled()
    expect(encryptMock).not.toHaveBeenCalled()
  })
})

// ─── resetIdentity ───────────────────────────────────────────────────

describe('resetIdentity', () => {
  it('apaga identidade do SQLite e master key', async () => {
    await resetIdentity()

    const sql = runMock.mock.calls[0]![0] as string
    expect(sql).toContain('DELETE FROM identity')
    expect(resetMasterKeyMock).toHaveBeenCalledTimes(1)
  })

  it('limpa cache — próxima chamada gera identidade nova', async () => {
    getMock.mockResolvedValue(null)

    const id1 = await getOrCreateIdentity()
    await resetIdentity()

    // Limpar mocks pra segunda criação
    getMock.mockResolvedValue(null)
    runMock.mockReset().mockResolvedValue(undefined)
    encryptMock.mockReset().mockResolvedValue('encrypted-blob-2')

    const id2 = await getOrCreateIdentity()

    // Identidade diferente (nova geração)
    expect(id2.nsec).not.toBe(id1.nsec)
    expect(id2.npub).not.toBe(id1.npub)
  })
})

// ─── getCurrentNpub ──────────────────────────────────────────────────

describe('getCurrentNpub', () => {
  it('retorna npub da identidade ativa', async () => {
    getMock.mockResolvedValue(null)

    const npub = await getCurrentNpub()

    expect(npub).toMatch(/^[0-9a-f]{64}$/)
  })

  it('retorna null se getOrCreateIdentity falha', async () => {
    getMock.mockRejectedValue(new Error('db broken'))

    const npub = await getCurrentNpub()

    expect(npub).toBeNull()
  })
})

// ─── clearIdentityCache ──────────────────────────────────────────────

describe('clearIdentityCache', () => {
  it('força re-fetch do banco na próxima chamada', async () => {
    getMock.mockResolvedValue(null)

    await getOrCreateIdentity()
    expect(getMock).toHaveBeenCalledTimes(1)

    clearIdentityCache()

    // Agora getMock é chamado de novo
    getMock.mockResolvedValue(null)
    await getOrCreateIdentity()
    expect(getMock).toHaveBeenCalledTimes(2)
  })
})

// ─── nsecHexToBytes ──────────────────────────────────────────────────

describe('nsecHexToBytes', () => {
  it('converte hex string para Uint8Array', () => {
    const hex = 'aabbccdd'
    const bytes = nsecHexToBytes(hex)
    expect(bytes).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]))
  })

  it('converte 32 bytes hex (64 chars)', () => {
    const hex = 'ff'.repeat(32)
    const bytes = nsecHexToBytes(hex)
    expect(bytes.length).toBe(32)
    expect(bytes.every((b) => b === 0xff)).toBe(true)
  })

  it('rejeita hex string com comprimento ímpar', () => {
    expect(() => nsecHexToBytes('abc')).toThrow(/invalid hex/)
  })
})

// ─── Invariantes de segurança (manifesto §8) ─────────────────────────

describe('segurança — nsec nunca em claro no SQLite', () => {
  it('getOrCreateIdentity sempre chama encrypt antes de INSERT', async () => {
    getMock.mockResolvedValue(null)

    await getOrCreateIdentity()

    // encrypt chamado antes (ou durante) o INSERT
    expect(encryptMock).toHaveBeenCalledTimes(1)

    const insertCalls = runMock.mock.calls.filter((c) => {
      const sql = c[0] as string
      return sql.includes('INSERT INTO identity')
    })
    expect(insertCalls).toHaveLength(1)

    // O segundo param (nsec_encrypted) é o resultado do encrypt, não o hex
    expect(insertCalls[0]![1]![1]).toBe('encrypted-blob')
  })

  it('setIdentityFromNsec encripta antes de persistir', async () => {
    const key = makeTestKey()

    await setIdentityFromNsec(key.nsec1)

    // Verifica que encrypt foi chamado com o nsec hex
    expect(encryptMock).toHaveBeenCalledWith(key.skHex)

    // E que o INSERT usa o resultado encriptado
    const insertCalls = runMock.mock.calls.filter((c) => {
      const sql = c[0] as string
      return sql.includes('INSERT INTO identity')
    })
    for (const call of insertCalls) {
      // nsec_encrypted param jamais é o hex claro
      expect(call[1]![1]).not.toBe(key.skHex)
    }
  })

  it('identidade carregada do banco usa decrypt, não raw read', async () => {
    const key = makeTestKey()

    getMock.mockResolvedValue({
      npub: key.npub,
      nsec_encrypted: 'opaque-ciphertext',
      created_at: 1000,
    })
    decryptMock.mockResolvedValue(key.skHex)

    await getOrCreateIdentity()

    expect(decryptMock).toHaveBeenCalledWith('opaque-ciphertext')
  })
})

// ─── Derivação correta npub ← nsec ──────────────────────────────────

describe('derivação criptográfica', () => {
  it('npub derivado é consistente com nostr-tools getPublicKey', async () => {
    getMock.mockResolvedValue(null)

    const id = await getOrCreateIdentity()

    // Decodifica nsecBech32 de volta pra bytes
    const decoded = nip19.decode(id.nsecBech32)
    const expectedNpub = getPublicKey(decoded.data as Uint8Array)

    expect(id.npub).toBe(expectedNpub)
  })

  it('setIdentityFromNsec deriva npub correto', async () => {
    const key = makeTestKey()

    const id = await setIdentityFromNsec(key.nsec1)

    expect(id.npub).toBe(key.npub)
    expect(id.npub).toBe(getPublicKey(key.sk))
  })
})
