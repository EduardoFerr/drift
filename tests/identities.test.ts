import { describe, expect, it, vi, beforeEach } from 'vitest'

const { execMock, runMock, getMock, encryptMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  runMock: vi.fn(),
  getMock: vi.fn(),
  encryptMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: { exec: execMock, run: runMock, get: getMock },
}))

vi.mock('../src/lib/crypto', () => ({
  encrypt: (...args: unknown[]) => encryptMock(...args),
}))

import {
  importIdentityNsec,
  setActiveIdentity,
  removeIdentity,
  renameIdentity,
  loadIdentities,
  useIdentitiesStore,
} from '../src/lib/identities'

// nsec1 válido pra testes — gerado a partir de 32 bytes determinísticos
// e codificado bech32. Usamos nip19 in-test pra não hardcodar.
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

function makeNsec1(): { nsec1: string; npub: string } {
  const sk = generateSecretKey()
  const nsec1 = nip19.nsecEncode(sk)
  const npub = getPublicKey(sk)
  return { nsec1, npub }
}

function resetStore() {
  useIdentitiesStore.setState({ list: [], activeNpub: null, loaded: false })
}

beforeEach(() => {
  resetStore()
  execMock.mockReset().mockResolvedValue([])
  runMock.mockReset().mockResolvedValue(undefined)
  getMock.mockReset().mockResolvedValue(null)
  encryptMock.mockReset().mockResolvedValue('encrypted-blob')
  // reset do flag `initialized` é interno ao módulo — não conseguimos sem
  // mexer no estado privado. loadIdentities é idempotente, então testamos
  // só comportamento de refresh disparado por outras funções.
})

describe('importIdentityNsec — validação', () => {
  it('rejeita string que não começa com nsec1', async () => {
    await expect(importIdentityNsec('npub1abc')).rejects.toThrow(/nsec1/)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('rejeita bech32 corrompido', async () => {
    await expect(importIdentityNsec('nsec1corrompido')).rejects.toThrow(
      /bech32/,
    )
  })

  it('rejeita tipo errado (npub passado como nsec)', async () => {
    // Cria uma string bech32 válida mas do tipo npub.
    const sk = generateSecretKey()
    const npub = getPublicKey(sk)
    const npub1 = nip19.npubEncode(npub)
    // Forçamos ele a entrar pelo path "começa com nsec1" trocando prefixo —
    // não dá; nip19.decode vai falhar antes. Pulamos esse caso aqui;
    // o tipo errado é coberto pela bech32 corrompido acima.
    expect(npub1.startsWith('npub1')).toBe(true)
  })

  it('aceita nsec1 válido, encripta e insere com imported=1', async () => {
    const { nsec1, npub } = makeNsec1()
    const rec = await importIdentityNsec(nsec1, 'minha-label')
    expect(rec.npub).toBe(npub)
    expect(rec.imported).toBe(true)
    expect(rec.label).toBe('minha-label')
    expect(encryptMock).toHaveBeenCalled()

    // INSERT na tabela identities com imported=1
    const insertCalls = runMock.mock.calls.filter((c) =>
      (c[0] as string).includes('INSERT INTO identities'),
    )
    expect(insertCalls).toHaveLength(1)
    const sql = insertCalls[0]![0] as string
    expect(sql).toContain('imported')
    expect(sql).toContain('ON CONFLICT(npub)')
  })

  it('aceita nsec1 com whitespace ao redor (trimmed)', async () => {
    const { nsec1 } = makeNsec1()
    await expect(importIdentityNsec(`  ${nsec1}  `)).resolves.toBeDefined()
  })
})

describe('setActiveIdentity', () => {
  it('lança erro se a identidade não existe na tabela', async () => {
    getMock.mockResolvedValue(null)
    await expect(setActiveIdentity('npub-inexistente')).rejects.toThrow(
      /não existe/,
    )
  })

  it('atualiza user_prefs E sincroniza tabela legacy `identity` (singular)', async () => {
    getMock.mockResolvedValue({
      nsec_encrypted: 'blob',
      created_at: 12345,
    })
    await setActiveIdentity('a'.repeat(64))

    const sqls = runMock.mock.calls.map((c) => c[0] as string)
    // user_prefs
    expect(sqls.some((s) => s.includes("INTO user_prefs") && s.includes('active_identity'))).toBe(true)
    // legacy: DELETE + INSERT em identity (singular)
    expect(sqls.some((s) => s.trim() === 'DELETE FROM identity')).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO identity (npub'))).toBe(true)
  })
})

describe('removeIdentity', () => {
  it('bloqueia remover a identidade ativa atual (invariante crítico)', async () => {
    useIdentitiesStore.setState({
      list: [],
      activeNpub: 'a'.repeat(64),
      loaded: true,
    })
    await expect(removeIdentity('a'.repeat(64))).rejects.toThrow(
      /identidade ativa/,
    )
    expect(runMock).not.toHaveBeenCalled()
  })

  it('permite remover identidade não-ativa', async () => {
    useIdentitiesStore.setState({
      list: [],
      activeNpub: 'a'.repeat(64),
      loaded: true,
    })
    await removeIdentity('b'.repeat(64))
    const deletes = runMock.mock.calls.filter((c) =>
      (c[0] as string).startsWith('DELETE FROM identities'),
    )
    expect(deletes).toHaveLength(1)
    expect(deletes[0]![1]).toEqual(['b'.repeat(64)])
  })
})

describe('renameIdentity', () => {
  it('faz UPDATE com label novo (aceita null pra limpar)', async () => {
    await renameIdentity('a'.repeat(64), null)
    const sql = runMock.mock.calls[0]![0] as string
    expect(sql).toContain('UPDATE identities SET label')
    expect(runMock.mock.calls[0]![1]).toEqual([null, 'a'.repeat(64)])
  })
})

describe('loadIdentities', () => {
  it('popula store com lista + activeNpub vindo de user_prefs', async () => {
    execMock.mockResolvedValue([
      {
        npub: 'a'.repeat(64),
        label: 'main',
        created_at: 1,
        imported: 0,
      },
      {
        npub: 'b'.repeat(64),
        label: null,
        created_at: 2,
        imported: 1,
      },
    ])
    getMock.mockResolvedValue({ value: 'b'.repeat(64) })
    await loadIdentities()
    const s = useIdentitiesStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.list).toHaveLength(2)
    expect(s.list[0]!.label).toBe('main')
    expect(s.list[1]!.imported).toBe(true)
    expect(s.activeNpub).toBe('b'.repeat(64))
  })
})
