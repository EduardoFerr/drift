/**
 * Tests for src/lib/crypto.ts — AES-GCM encryption/decryption of nsec keys.
 *
 * crypto.ts depends on IndexedDB (master key storage) and Web Crypto API
 * (AES-GCM operations). Node 20+ provides crypto.subtle natively; IndexedDB
 * is not available in Node so we mock it via a minimal in-memory shim.
 *
 * Coverage:
 *  - encrypt → decrypt round-trip
 *  - decrypt with wrong key (different master key) should fail
 *  - IV uniqueness (two encryptions produce different ciphertext)
 *  - resetMasterKey clears state, new key generated after
 *  - Edge cases: empty string, large input, unicode
 *  - Base64 output is well-formed (IV prefix + ciphertext)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── IndexedDB in-memory shim ──────────────────────────────────────────
// crypto.ts calls indexedDB.open() to store the master CryptoKey.
// We shim just enough of the IDB API for the module to work.

interface FakeStore {
  data: Map<string, unknown>
}

let fakeStore: FakeStore

function createFakeIDB() {
  fakeStore = { data: new Map() }

  const objectStore = {
    get(key: string) {
      const result = fakeStore.data.get(key) ?? undefined
      const req = { result, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
    put(value: unknown, key: string) {
      fakeStore.data.set(key, value)
      const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
    delete(key: string) {
      fakeStore.data.delete(key)
      const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
  }

  const fakeDb = {
    transaction(_store: string, _mode?: string) {
      const tx = {
        objectStore: () => objectStore,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
      }
      // Transactions complete asynchronously after the put/delete resolves
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()))
      return tx
    },
    createObjectStore: vi.fn(),
  }

  const fakeIndexedDB = {
    open(_name: string, _version?: number) {
      const req = {
        result: fakeDb,
        error: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      }
      queueMicrotask(() => {
        // First open triggers upgrade
        if (fakeStore.data.size === 0 && !fakeStore.data.has('__opened')) {
          req.onupgradeneeded?.()
          fakeStore.data.set('__opened', true)
        }
        req.onsuccess?.()
      })
      return req
    },
  }

  return fakeIndexedDB
}

// Install shim before importing the module
const fakeIDB = createFakeIDB()
vi.stubGlobal('indexedDB', fakeIDB)

// btoa/atob are available in Node 20+ but just in case
if (typeof globalThis.btoa === 'undefined') {
  vi.stubGlobal('btoa', (s: string) => Buffer.from(s, 'binary').toString('base64'))
  vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'))
}

import { encrypt, decrypt, resetMasterKey } from '../src/lib/crypto'

// ─── Tests ──────────────────────────────────────────────────────────────

describe('crypto.ts — AES-GCM encryption', () => {
  beforeEach(() => {
    // Reset the IndexedDB store between tests so each test gets a fresh
    // master key (generated on first encrypt/decrypt call).
    fakeStore.data.clear()
  })

  describe('round-trip', () => {
    it('encrypt then decrypt returns original plaintext', async () => {
      const plaintext = 'nsec1abc123def456'
      const ciphertext = await encrypt(plaintext)
      const result = await decrypt(ciphertext)
      expect(result).toBe(plaintext)
    })

    it('works with empty string', async () => {
      const ciphertext = await encrypt('')
      const result = await decrypt(ciphertext)
      expect(result).toBe('')
    })

    it('works with unicode content', async () => {
      const plaintext = 'chave-secreta-unicode-éàü-\u{1F511}'
      const ciphertext = await encrypt(plaintext)
      const result = await decrypt(ciphertext)
      expect(result).toBe(plaintext)
    })

    it('works with large input (10 KB)', async () => {
      const plaintext = 'A'.repeat(10_000)
      const ciphertext = await encrypt(plaintext)
      const result = await decrypt(ciphertext)
      expect(result).toBe(plaintext)
    })

    it('preserves exact 64-char hex nsec format', async () => {
      const nsecHex = 'a'.repeat(64)
      const ciphertext = await encrypt(nsecHex)
      const result = await decrypt(ciphertext)
      expect(result).toBe(nsecHex)
    })
  })

  describe('IV uniqueness', () => {
    it('two encryptions of the same data produce different ciphertext', async () => {
      const plaintext = 'same-data-encrypted-twice'
      const c1 = await encrypt(plaintext)
      const c2 = await encrypt(plaintext)
      expect(c1).not.toBe(c2)
    })

    it('both different ciphertexts decrypt to the same plaintext', async () => {
      const plaintext = 'verify-both-decrypt'
      const c1 = await encrypt(plaintext)
      const c2 = await encrypt(plaintext)
      expect(await decrypt(c1)).toBe(plaintext)
      expect(await decrypt(c2)).toBe(plaintext)
    })
  })

  describe('output format', () => {
    it('produces valid base64 output', async () => {
      const ciphertext = await encrypt('test')
      // Valid base64 characters only
      expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/)
    })

    it('ciphertext is longer than plaintext (IV prefix + auth tag)', async () => {
      const plaintext = 'short'
      const ciphertext = await encrypt(plaintext)
      // base64 decoded must be at least 12 (IV) + plaintext.length + 16 (GCM tag)
      const decoded = Buffer.from(ciphertext, 'base64')
      expect(decoded.length).toBeGreaterThanOrEqual(12 + plaintext.length + 16)
    })

    it('first 12 bytes of decoded ciphertext are the IV', async () => {
      const ciphertext = await encrypt('test-iv-prefix')
      const decoded = new Uint8Array(Buffer.from(ciphertext, 'base64'))
      const iv = decoded.slice(0, 12)
      // IV should be 12 bytes (standard AES-GCM nonce)
      expect(iv.length).toBe(12)
      // IV should not be all zeros (crypto.getRandomValues should produce entropy)
      expect(iv.some((b) => b !== 0)).toBe(true)
    })
  })

  describe('wrong key / tampered ciphertext', () => {
    it('decrypt fails when master key changes (resetMasterKey)', async () => {
      const plaintext = 'secret-that-will-be-lost'
      const ciphertext = await encrypt(plaintext)

      // Reset master key — next decrypt generates a NEW key
      await resetMasterKey()

      // Decrypt with new key should fail
      await expect(decrypt(ciphertext)).rejects.toThrow()
    })

    it('decrypt fails on corrupted ciphertext', async () => {
      const ciphertext = await encrypt('data-to-corrupt')
      // Decode, flip a byte in the ciphertext portion (after IV), re-encode
      const decoded = Buffer.from(ciphertext, 'base64')
      // Flip byte at position 15 (safely past the 12-byte IV)
      decoded[15] = decoded[15]! ^ 0xff
      const corrupted = decoded.toString('base64')

      await expect(decrypt(corrupted)).rejects.toThrow()
    })

    it('decrypt fails on truncated ciphertext', async () => {
      const ciphertext = await encrypt('data-to-truncate')
      // Truncate to just the IV (12 bytes encoded in base64 = 16 chars)
      const truncated = ciphertext.slice(0, 16)

      await expect(decrypt(truncated)).rejects.toThrow()
    })

    it('decrypt fails on empty string input', async () => {
      // Empty base64 decodes to empty Uint8Array — no IV, no ciphertext
      await expect(decrypt('')).rejects.toThrow()
    })

    it('decrypt fails on random base64 string', async () => {
      // Random data that was never encrypted with our key
      const randomB64 = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64')
      await expect(decrypt(randomB64)).rejects.toThrow()
    })
  })

  describe('resetMasterKey', () => {
    it('clears the stored key (next call generates fresh)', async () => {
      // Encrypt with first key
      const c1 = await encrypt('before-reset')
      expect(await decrypt(c1)).toBe('before-reset')

      await resetMasterKey()

      // Encrypt with new key should work
      const c2 = await encrypt('after-reset')
      expect(await decrypt(c2)).toBe('after-reset')

      // But old ciphertext is undecipherable
      await expect(decrypt(c1)).rejects.toThrow()
    })

    it('can be called multiple times without error', async () => {
      await resetMasterKey()
      await resetMasterKey()
      await resetMasterKey()
      // Should still be able to encrypt/decrypt afterwards
      const ct = await encrypt('still-works')
      expect(await decrypt(ct)).toBe('still-works')
    })

    it('can be called before any encrypt/decrypt', async () => {
      // No key exists yet — reset should be a no-op
      await expect(resetMasterKey()).resolves.toBeUndefined()
    })
  })

  describe('master key reuse within session', () => {
    it('multiple encryptions use the same master key (all decrypt correctly)', async () => {
      const items = ['secret-1', 'secret-2', 'secret-3']
      // Sequential — master key init isn't safe for concurrent calls
      const encrypted: string[] = []
      for (const item of items) encrypted.push(await encrypt(item))
      const decrypted: string[] = []
      for (const ct of encrypted) decrypted.push(await decrypt(ct))
      expect(decrypted).toEqual(items)
    })
  })
})
