import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip44 } from 'nostr-tools'
// V9.33: encryptDM/decryptDM movidos pra nostr-dm.ts. Submodule
// path em vez do barrel pra evitar pull do nip44 inteiro no test.
import { encryptDM, decryptDM } from '../src/lib/nostr-dm'

// fixtures: Alice / Bob / Charlie
function pair() {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  return { sk, pk }
}

describe('encryptDM / decryptDM — round-trip', () => {
  it('cifra Alice→Bob e Bob decifra de volta', () => {
    const alice = pair()
    const bob = pair()
    const plain = 'hello bob'
    const ct = encryptDM(plain, bob.pk, alice.sk)
    const out = decryptDM(ct, alice.pk, bob.sk)
    expect(out).toBe(plain)
  })

  it('UTF-8 com acentos e emojis sobrevive', () => {
    const alice = pair()
    const bob = pair()
    const plain = 'olá mundo — açaí, ção, 🌊 ⚡ 中文'
    const ct = encryptDM(plain, bob.pk, alice.sk)
    expect(decryptDM(ct, alice.pk, bob.sk)).toBe(plain)
  })

  it('JSON longo (~5KB) sobrevive', () => {
    const alice = pair()
    const bob = pair()
    const big = { items: Array.from({ length: 200 }, (_, i) => ({ i, v: 'x'.repeat(20) })) }
    const plain = JSON.stringify(big)
    expect(plain.length).toBeGreaterThan(4000)
    const ct = encryptDM(plain, bob.pk, alice.sk)
    expect(decryptDM(ct, alice.pk, bob.sk)).toBe(plain)
  })

  it('string mínima de 1 byte sobrevive (NIP-44 v2 proíbe payload vazio)', () => {
    const alice = pair()
    const bob = pair()
    const ct = encryptDM('x', bob.pk, alice.sk)
    expect(decryptDM(ct, alice.pk, bob.sk)).toBe('x')
    // sanity: spec NIP-44 v2 exige 1..65535 bytes
    expect(() => encryptDM('', bob.pk, alice.sk)).toThrow()
  })

  it('payload muda a cada chamada (nonce aleatório)', () => {
    const alice = pair()
    const bob = pair()
    const a = encryptDM('same', bob.pk, alice.sk)
    const b = encryptDM('same', bob.pk, alice.sk)
    expect(a).not.toBe(b)
  })
})

describe('encryptDM / decryptDM — segurança', () => {
  it('Charlie não consegue decifrar mensagem Alice→Bob', () => {
    const alice = pair()
    const bob = pair()
    const charlie = pair()
    const ct = encryptDM('top secret', bob.pk, alice.sk)
    // charlie usa a própria nsec — derivação ECDH não bate com par (alice, bob)
    expect(() => decryptDM(ct, alice.pk, charlie.sk)).toThrow()
  })

  it('decifrar com pubkey errada (Charlie em vez de Alice) lança', () => {
    const alice = pair()
    const bob = pair()
    const charlie = pair()
    const ct = encryptDM('top secret', bob.pk, alice.sk)
    expect(() => decryptDM(ct, charlie.pk, bob.sk)).toThrow()
  })

  it('payload corrompido (1 byte flipped) lança', () => {
    const alice = pair()
    const bob = pair()
    const ct = encryptDM('intact', bob.pk, alice.sk)
    // base64 — flip um char próximo ao final (na região do MAC) garante falha
    const idx = ct.length - 5
    const orig = ct[idx]
    const swap = orig === 'A' ? 'B' : 'A'
    const corrupted = ct.slice(0, idx) + swap + ct.slice(idx + 1)
    expect(() => decryptDM(corrupted, alice.pk, bob.sk)).toThrow()
  })

  it('payload vazio lança', () => {
    const alice = pair()
    const bob = pair()
    expect(() => decryptDM('', alice.pk, bob.sk)).toThrow()
  })
})

describe('compatibilidade com nip44 cru de nostr-tools', () => {
  // sanity: facade é fininha mesmo — encrypt aqui decifra com nip44.decrypt + getConversationKey
  it('encryptDM produz payload que nip44.decrypt + getConversationKey decifram', () => {
    const alice = pair()
    const bob = pair()
    const plain = 'cross-check'
    const ct = encryptDM(plain, bob.pk, alice.sk)
    const key = nip44.getConversationKey(bob.sk, alice.pk)
    expect(nip44.decrypt(ct, key)).toBe(plain)
  })

  it('decryptDM consome payload produzido por nip44.encrypt direto', () => {
    const alice = pair()
    const bob = pair()
    const plain = 'reverse cross-check'
    const key = nip44.getConversationKey(alice.sk, bob.pk)
    const ct = nip44.encrypt(plain, key)
    expect(decryptDM(ct, alice.pk, bob.sk)).toBe(plain)
  })
})
