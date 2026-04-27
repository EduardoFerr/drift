import { describe, expect, it } from 'vitest'
import {
  deriveNostrKeyFromMnemonic,
  generateBip39Mnemonic,
  isValidMnemonic,
} from '../src/lib/bip39'

describe('generateBip39Mnemonic', () => {
  it('gera 12 palavras', () => {
    const m = generateBip39Mnemonic()
    expect(m.split(/\s+/)).toHaveLength(12)
  })

  it('gera frases distintas em chamadas sucessivas (entropia real)', () => {
    const a = generateBip39Mnemonic()
    const b = generateBip39Mnemonic()
    expect(a).not.toBe(b)
  })

  it('frase gerada passa em isValidMnemonic', () => {
    expect(isValidMnemonic(generateBip39Mnemonic())).toBe(true)
  })
})

describe('isValidMnemonic', () => {
  it('rejeita frase vazia', () => {
    expect(isValidMnemonic('')).toBe(false)
  })

  it('rejeita palavra fora da wordlist', () => {
    expect(isValidMnemonic('zzz banana banana banana banana banana banana banana banana banana banana banana')).toBe(
      false,
    )
  })

  it('rejeita checksum inválido (12 palavras válidas mas última quebrada)', () => {
    // 11 palavras OK + uma 12ª errada
    expect(
      isValidMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'),
    ).toBe(false) // checksum errado
  })

  it('aceita frase de teste BIP39 oficial (12 palavras)', () => {
    // BIP39 official test vector
    expect(
      isValidMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    ).toBe(true)
  })

  it('é case-insensitive (normaliza pra lowercase)', () => {
    expect(
      isValidMnemonic('ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABOUT'),
    ).toBe(true)
  })
})

describe('deriveNostrKeyFromMnemonic — NIP-06', () => {
  /**
   * Vetor de teste oficial do NIP-06:
   * https://github.com/nostr-protocol/nips/blob/master/06.md
   *
   * Mnemonic: "leader monkey parrot ring guide accident before fence cannon height naive bean"
   * Path: m/44'/1237'/0'/0/0
   * Expected nsec hex: 7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a
   */
  it('vetor oficial NIP-06: leader monkey parrot ring...', async () => {
    const mnemonic = 'leader monkey parrot ring guide accident before fence cannon height naive bean'
    const result = await deriveNostrKeyFromMnemonic(mnemonic)
    expect(result.nsecHex).toBe(
      '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a',
    )
  })

  it('vetor oficial NIP-06: what bleak badge...', async () => {
    /**
     * Outro vetor do NIP-06:
     * "what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade"
     * Expected: c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add
     */
    const mnemonic =
      'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade'
    const result = await deriveNostrKeyFromMnemonic(mnemonic)
    expect(result.nsecHex).toBe(
      'c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add',
    )
  })

  it('mesma mnemonic + mesma passphrase → mesma chave (determinístico)', async () => {
    const m = 'leader monkey parrot ring guide accident before fence cannon height naive bean'
    const a = await deriveNostrKeyFromMnemonic(m, '')
    const b = await deriveNostrKeyFromMnemonic(m, '')
    expect(a.nsecHex).toBe(b.nsecHex)
    expect(a.npubHex).toBe(b.npubHex)
  })

  it('passphrase muda a chave derivada (BIP39 standard)', async () => {
    const m = 'leader monkey parrot ring guide accident before fence cannon height naive bean'
    const noPass = await deriveNostrKeyFromMnemonic(m, '')
    const withPass = await deriveNostrKeyFromMnemonic(m, 'minha passphrase')
    expect(noPass.nsecHex).not.toBe(withPass.nsecHex)
  })

  it('throw em mnemonic inválida', async () => {
    await expect(deriveNostrKeyFromMnemonic('not a valid mnemonic at all')).rejects.toThrow()
  })

  it('retorna formatos bech32 corretos (nsec1.../npub1...)', async () => {
    const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const result = await deriveNostrKeyFromMnemonic(m)
    expect(result.nsecBech32).toMatch(/^nsec1/)
    expect(result.npubBech32).toMatch(/^npub1/)
    expect(result.nsecBytes.length).toBe(32)
  })
})
