import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { parseDeepLinkSearch } from '../src/lib/deep-link'

describe('parseDeepLinkSearch', () => {
  it('string vazia → tudo null', () => {
    const r = parseDeepLinkSearch('')
    expect(r.action).toBeNull()
    expect(r.postEventId).toBeNull()
  })

  it('?action=compose → action="compose"', () => {
    const r = parseDeepLinkSearch('?action=compose')
    expect(r.action).toBe('compose')
    expect(r.postEventId).toBeNull()
  })

  it('?action=settings → action="settings"', () => {
    const r = parseDeepLinkSearch('?action=settings')
    expect(r.action).toBe('settings')
  })

  it('?action=invalid → action=null (rejeita valores fora do whitelist)', () => {
    const r = parseDeepLinkSearch('?action=hack')
    expect(r.action).toBeNull()
  })

  it('?p=<nevent válido> → postEventId em hex 64-char', () => {
    const fakeId = 'a'.repeat(64)
    const nevent = nip19.neventEncode({ id: fakeId, kind: 9078 })
    const r = parseDeepLinkSearch(`?p=${nevent}`)
    expect(r.postEventId).toBe(fakeId)
  })

  it('?p=<nevent inclui author> → postEventId é só o id', () => {
    const fakeId = 'b'.repeat(64)
    const fakeAuthor = 'c'.repeat(64)
    const nevent = nip19.neventEncode({
      id: fakeId,
      author: fakeAuthor,
      kind: 9078,
    })
    const r = parseDeepLinkSearch(`?p=${nevent}`)
    expect(r.postEventId).toBe(fakeId)
  })

  it('?p=<malformado> → postEventId=null (catch silencioso)', () => {
    const r = parseDeepLinkSearch('?p=lixoaleatorio123')
    expect(r.postEventId).toBeNull()
  })

  it('?p=<npub1 — tipo errado> → postEventId=null', () => {
    const fakePubkey = 'd'.repeat(64)
    const npub = nip19.npubEncode(fakePubkey)
    const r = parseDeepLinkSearch(`?p=${npub}`)
    expect(r.postEventId).toBeNull()
  })

  it('?p=<note1 — tipo errado> → postEventId=null', () => {
    const fakeId = 'e'.repeat(64)
    const note = nip19.noteEncode(fakeId)
    const r = parseDeepLinkSearch(`?p=${note}`)
    expect(r.postEventId).toBeNull()
  })

  it('?action=compose&p=<nevent> → ambos populados', () => {
    const fakeId = 'f'.repeat(64)
    const nevent = nip19.neventEncode({ id: fakeId, kind: 9078 })
    const r = parseDeepLinkSearch(`?action=compose&p=${nevent}`)
    expect(r.action).toBe('compose')
    expect(r.postEventId).toBe(fakeId)
  })

  it('determinístico — mesma input gera mesmo output', () => {
    const fakeId = '0'.repeat(64)
    const nevent = nip19.neventEncode({ id: fakeId, kind: 9078 })
    const a = parseDeepLinkSearch(`?p=${nevent}`)
    const b = parseDeepLinkSearch(`?p=${nevent}`)
    expect(a).toEqual(b)
  })

  it('nevent sem relay hints → relayHints=[]', () => {
    const fakeId = 'a'.repeat(64)
    const nevent = nip19.neventEncode({ id: fakeId, kind: 9078 })
    const r = parseDeepLinkSearch(`?p=${nevent}`)
    expect(r.relayHints).toEqual([])
  })

  it('nevent com relay hints → relayHints preservados', () => {
    const fakeId = 'b'.repeat(64)
    const relays = ['wss://relay1.example.com', 'wss://relay2.example.com']
    const nevent = nip19.neventEncode({ id: fakeId, kind: 9078, relays })
    const r = parseDeepLinkSearch(`?p=${nevent}`)
    expect(r.postEventId).toBe(fakeId)
    expect(r.relayHints).toEqual(relays)
  })

  it('string vazia → relayHints=[]', () => {
    const r = parseDeepLinkSearch('')
    expect(r.relayHints).toEqual([])
  })

  it('?p=<malformado> → relayHints=[]', () => {
    const r = parseDeepLinkSearch('?p=lixoaleatorio123')
    expect(r.relayHints).toEqual([])
  })
})
