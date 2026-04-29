import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  execMock,
  runMock,
  getMock,
  subscribeManyMock,
  publishToRelaysMock,
  signDriftEventMock,
  getOrCreateIdentityMock,
  activeReadRelaysMock,
} = vi.hoisted(() => ({
  execMock: vi.fn(),
  runMock: vi.fn(),
  getMock: vi.fn(),
  subscribeManyMock: vi.fn(),
  publishToRelaysMock: vi.fn(),
  signDriftEventMock: vi.fn(),
  getOrCreateIdentityMock: vi.fn(),
  activeReadRelaysMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  db: { exec: execMock, run: runMock, get: getMock },
}))

vi.mock('../src/lib/transport/wss', () => ({
  pool: { subscribeMany: subscribeManyMock },
}))

vi.mock('../src/lib/relays', () => ({
  activeReadRelays: () => activeReadRelaysMock(),
}))

vi.mock('../src/lib/identity', () => ({
  getOrCreateIdentity: () => getOrCreateIdentityMock(),
}))

vi.mock('../src/lib/nostr', () => ({
  signDriftEvent: (...args: unknown[]) => signDriftEventMock(...args),
  publishToRelays: (...args: unknown[]) => publishToRelaysMock(...args),
}))

import {
  applyContactList,
  follow,
  unfollow,
  isFollowing,
  syncFollowsFromRelays,
  useFollowsStore,
} from '../src/lib/follows'
import type { SignedEvent } from '../src/types/nostr'

const ME = 'a'.repeat(64)
const PEER1 = 'b'.repeat(64)
const PEER2 = 'c'.repeat(64)

function makeContactEvent(
  pubkey: string,
  pTags: string[],
  createdAt = 1714000000,
): SignedEvent {
  return {
    id: '0'.repeat(64),
    pubkey,
    created_at: createdAt,
    kind: 3,
    tags: pTags.map((p) => ['p', p]),
    content: '',
    sig: '0'.repeat(128),
  }
}

function resetStore() {
  useFollowsStore.setState({
    following: new Set<string>(),
    loaded: false,
    updatedAt: null,
  })
}

describe('applyContactList (NIP-02 kind 3)', () => {
  beforeEach(() => {
    resetStore()
    execMock.mockReset()
    runMock.mockReset().mockResolvedValue(undefined)
    getOrCreateIdentityMock.mockReset().mockResolvedValue({ npub: ME })
  })

  it('ignora eventos com kind != 3', async () => {
    const evt = makeContactEvent(ME, [PEER1])
    evt.kind = 1
    await applyContactList(evt)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('apaga follows antigos do follower e re-insere o snapshot', async () => {
    execMock.mockResolvedValue([{ following_pub: PEER1 }, { following_pub: PEER2 }])
    const evt = makeContactEvent(ME, [PEER1, PEER2])
    await applyContactList(evt)

    // Primeiro deve haver um DELETE
    const sqls = runMock.mock.calls.map((c) => c[0] as string)
    expect(sqls[0]).toContain('DELETE FROM follows')
    // E depois INSERTs
    expect(sqls.filter((s) => s.startsWith('INSERT'))).toHaveLength(2)
  })

  it('descarta tags p com pubkey hex inválido', async () => {
    execMock.mockResolvedValue([])
    const evt = makeContactEvent(ME, [PEER1, 'not-hex', '123'])
    await applyContactList(evt)

    const inserts = runMock.mock.calls.filter((c) =>
      (c[0] as string).startsWith('INSERT'),
    )
    expect(inserts).toHaveLength(1)
    expect((inserts[0]![1] as unknown[])[1]).toBe(PEER1)
  })

  it('atualiza store reativa apenas se o evento é do user atual', async () => {
    execMock.mockResolvedValue([{ following_pub: PEER1 }])
    const evtMine = makeContactEvent(ME, [PEER1])
    await applyContactList(evtMine)
    expect(useFollowsStore.getState().loaded).toBe(true)
    expect(useFollowsStore.getState().following.has(PEER1)).toBe(true)

    // Reset + outro author
    resetStore()
    execMock.mockResolvedValue([{ following_pub: PEER1 }])
    const evtOther = makeContactEvent(PEER2, [PEER1])
    await applyContactList(evtOther)
    expect(useFollowsStore.getState().loaded).toBe(false)
  })
})

describe('follow / unfollow / isFollowing', () => {
  beforeEach(() => {
    resetStore()
    execMock.mockReset().mockResolvedValue([])
    runMock.mockReset().mockResolvedValue(undefined)
    getOrCreateIdentityMock.mockReset().mockResolvedValue({ npub: ME })
    publishToRelaysMock.mockReset().mockResolvedValue(undefined)
    signDriftEventMock.mockReset().mockResolvedValue({ id: 'x' })
  })

  it('isFollowing lê da store', () => {
    useFollowsStore.setState({
      following: new Set([PEER1]),
      loaded: true,
      updatedAt: 1,
    })
    expect(isFollowing(PEER1)).toBe(true)
    expect(isFollowing(PEER2)).toBe(false)
  })

  it('follow não permite seguir a si mesmo', async () => {
    await follow(ME)
    expect(runMock).not.toHaveBeenCalled()
    expect(signDriftEventMock).not.toHaveBeenCalled()
  })

  it('follow insere no DB e publica kind 3 com tag p do alvo', async () => {
    execMock.mockResolvedValue([{ following_pub: PEER1 }])
    await follow(PEER1)
    const inserts = runMock.mock.calls.filter((c) =>
      (c[0] as string).includes('INSERT OR IGNORE INTO follows'),
    )
    expect(inserts).toHaveLength(1)
    expect((inserts[0]![1] as unknown[])[0]).toBe(ME)
    expect((inserts[0]![1] as unknown[])[1]).toBe(PEER1)

    // signDriftEvent chamado com kind 3
    const tpl = signDriftEventMock.mock.calls[0]![0] as {
      kind: number
      tags: string[][]
      content: string
    }
    expect(tpl.kind).toBe(3)
    expect(tpl.content).toBe('')
    expect(tpl.tags).toEqual([['p', PEER1]])
  })

  it('unfollow deleta do DB e republica lista atualizada', async () => {
    execMock.mockResolvedValue([]) // após delete a lista fica vazia
    await unfollow(PEER1)
    const deletes = runMock.mock.calls.filter((c) =>
      (c[0] as string).startsWith('DELETE FROM follows'),
    )
    expect(deletes).toHaveLength(1)
    expect(deletes[0]![1]).toEqual([ME, PEER1])

    // publica snapshot vazio (sem tags p)
    const tpl = signDriftEventMock.mock.calls[0]![0] as { tags: string[][] }
    expect(tpl.tags).toEqual([])
  })
})

describe('syncFollowsFromRelays', () => {
  beforeEach(() => {
    resetStore()
    execMock.mockReset().mockResolvedValue([])
    runMock.mockReset().mockResolvedValue(undefined)
    getOrCreateIdentityMock.mockReset().mockResolvedValue({ npub: ME })
    activeReadRelaysMock.mockReset()
    subscribeManyMock.mockReset()
  })

  it('curto-circuito: sem relays ativos, não chama subscribe', async () => {
    activeReadRelaysMock.mockReturnValue([])
    await syncFollowsFromRelays()
    expect(subscribeManyMock).not.toHaveBeenCalled()
  })
})
