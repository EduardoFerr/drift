/**
 * OpenTimestamps — formato, verificação e cliente de rede (com fetch
 * falso). Nenhum teste toca a rede: o header do bloco 358391 foi buscado
 * UMA vez (mempool.space + blockstream.info, ambos concordaram) ao
 * escrever este arquivo e está fixado abaixo.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  OtsParseError,
  applyOp,
  base64ToBytes,
  bitcoinMsgMatchesMerkleRoot,
  bytesToBase64,
  bytesToHex,
  collectLeaves,
  hexToBytes,
  keccak256,
  mergeUpgradeAsync,
  newOtsFile,
  parseOtsFile,
  parseTimestampBytes,
  ripemd160,
  serializeOtsFile,
  serializeTimestampBytes,
  type OtsFile,
  type OtsTimestamp,
} from '../src/lib/ots'
import {
  DEFAULT_CALENDARS,
  fetchBitcoinBlockHeader,
  stampDigest,
  stripPending,
  upgradeOtsFile,
  verifyOtsBitcoin,
} from '../src/lib/ots-client'

const FIXTURES = new URL('./fixtures/ots/', import.meta.url)
const HELLO_OTS = new Uint8Array(readFileSync(new URL('hello-world.txt.ots', FIXTURES)))
const HELLO_TXT = new Uint8Array(readFileSync(new URL('hello-world.txt', FIXTURES)))

// Bloco 358391 — https://mempool.space/api/block/000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319
// (idêntico em https://blockstream.info/api/block/<mesmo hash>), consultado em 2026-11-03.
const BLOCK_358391 = {
  merkleRoot: '8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00',
  time: 1432827678,
}

const MAGIC = hexToBytes('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294')
const BITCOIN_TAG = hexToBytes('0588960d73d71901')
const PENDING_TAG = hexToBytes('83dfe30d2ef90c8e')

function sha256(b: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(b).digest())
}
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const u8 = (...xs: number[]): Uint8Array => new Uint8Array(xs)
/** header + versão + sha256 + digest zero + corpo do Timestamp */
const fileWith = (body: Uint8Array): Uint8Array => cat(MAGIC, u8(1, 0x08), new Uint8Array(32), body)
const BITCOIN_ATT_1 = cat(u8(0x00), BITCOIN_TAG, u8(1, 1)) // attestation bitcoin altura 1

// ─── fetch falso ─────────────────────────────────────────────────────

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
function fakeFetch(handler: Handler): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    return handler(url, init)
  }
  return { fetch: f as typeof fetch, calls }
}
const bin = (b: Uint8Array, status = 200): Response => new Response(b.slice().buffer as ArrayBuffer, { status })

/** Timestamp que um calendário devolveria: append(salt) → sha256 → pending(uri). */
function pendingResponse(uri: string, salt: number): OtsTimestamp {
  return {
    attestations: [],
    ops: [
      {
        op: { op: 'append', arg: u8(salt, salt, salt) },
        next: { attestations: [], ops: [{ op: { op: 'sha256' }, next: { attestations: [{ type: 'pending', uri }], ops: [] } }] },
      },
    ],
  }
}

// ─── prova real (exemplo oficial do opentimestamps-client) ───────────

describe('hello-world.txt.ots (prova real)', () => {
  it('faz parse, digest = sha256(arquivo) e round-trip byte-exato', () => {
    const file = parseOtsFile(HELLO_OTS)
    expect(file.hashOp).toBe('sha256')
    expect(bytesToHex(file.digest)).toBe(bytesToHex(sha256(HELLO_TXT)))
    expect(bytesToHex(file.digest)).toBe('03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340')
    expect(bytesToHex(serializeOtsFile(file))).toBe(bytesToHex(HELLO_OTS))
  })

  it('round-trip via base64 (formato do content NIP-03)', () => {
    const b64 = bytesToBase64(HELLO_OTS)
    expect(b64).toBe(Buffer.from(HELLO_OTS).toString('base64'))
    expect(bytesToHex(base64ToBytes(b64))).toBe(bytesToHex(HELLO_OTS))
  })

  it('collectLeaves encontra a attestation Bitcoin do bloco 358391 com a merkle root certa', async () => {
    const leaves = await collectLeaves(parseOtsFile(HELLO_OTS))
    const btc = leaves.filter((l) => l.attestation.type === 'bitcoin')
    expect(btc).toHaveLength(1)
    expect(btc[0]!.attestation).toEqual({ type: 'bitcoin', height: 358391 })
    expect(bitcoinMsgMatchesMerkleRoot(btc[0]!.msg, BLOCK_358391.merkleRoot)).toBe(true)
    expect(bitcoinMsgMatchesMerkleRoot(btc[0]!.msg, BLOCK_358391.merkleRoot.toUpperCase())).toBe(true)
    // ordem interna ≠ ordem de exibição
    expect(bytesToHex(btc[0]!.msg)).not.toBe(BLOCK_358391.merkleRoot)
  })

  it('verifyOtsBitcoin com header injetado devolve altura e horário do bloco', async () => {
    const file = parseOtsFile(HELLO_OTS)
    const asked: number[] = []
    const res = await verifyOtsBitcoin(file, sha256(HELLO_TXT), {
      getHeader: async (h) => {
        asked.push(h)
        return BLOCK_358391
      },
    })
    expect(res).toEqual({ height: 358391, time: 1432827678 })
    expect(asked).toEqual([358391])
  })

  it('merkle root errada → null', async () => {
    const res = await verifyOtsBitcoin(parseOtsFile(HELLO_OTS), sha256(HELLO_TXT), {
      getHeader: async () => ({ merkleRoot: '00'.repeat(32), time: 1 }),
    })
    expect(res).toBeNull()
  })

  it('expectedDigest diferente → null (sem nem consultar header)', async () => {
    let asked = false
    const res = await verifyOtsBitcoin(parseOtsFile(HELLO_OTS), sha256(u8(1, 2, 3)), {
      getHeader: async () => {
        asked = true
        return BLOCK_358391
      },
    })
    expect(res).toBeNull()
    expect(asked).toBe(false)
  })

  it('erro do getHeader sem nenhuma folha válida → relança (não confunde com "inválida")', async () => {
    await expect(
      verifyOtsBitcoin(parseOtsFile(HELLO_OTS), sha256(HELLO_TXT), {
        getHeader: async () => {
          throw new Error('offline')
        },
      }),
    ).rejects.toThrow('offline')
  })
})

// ─── endurecimento do parser ─────────────────────────────────────────

describe('parseOtsFile — entradas hostis', () => {
  const bad = (b: Uint8Array): void => {
    expect(() => parseOtsFile(b)).toThrow(OtsParseError)
  }

  it('arquivo truncado (em vários pontos)', () => {
    for (const n of [0, 10, 31, 32, 33, 60, 65, 100, HELLO_OTS.length - 1]) bad(HELLO_OTS.slice(0, n))
  })
  it('magic errado', () => {
    const b = HELLO_OTS.slice()
    b[1] = 0x50
    bad(b)
  })
  it('versão ≠ 1', () => {
    const b = HELLO_OTS.slice()
    b[31] = 2
    bad(b)
  })
  it('hash de arquivo ≠ sha256', () => {
    const b = HELLO_OTS.slice()
    b[32] = 0x02
    bad(b)
  })
  it('lixo no fim', () => {
    bad(cat(HELLO_OTS, u8(0)))
  })
  it('varbytes enorme: argumento de op > 4096', () => {
    bad(fileWith(cat(u8(0xf0, 0x89, 0x20), new Uint8Array(4097), BITCOIN_ATT_1))) // 4105
  })
  it('varbytes enorme: payload de attestation > 8192', () => {
    bad(fileWith(cat(u8(0x00), PENDING_TAG, u8(0x81, 0x40), new Uint8Array(8193))))
  })
  it('varbytes declarando mais bytes do que existem', () => {
    bad(fileWith(cat(u8(0xf0, 0x7f), u8(1, 2, 3))))
  })
  it('argumento de append vazio', () => {
    bad(fileWith(cat(u8(0xf0, 0x00), BITCOIN_ATT_1)))
  })
  it('op desconhecida', () => {
    bad(fileWith(cat(u8(0x04), BITCOIN_ATT_1)))
    bad(fileWith(cat(u8(0xff, 0xff), BITCOIN_ATT_1)))
  })
  it('op repetida no mesmo nó', () => {
    bad(fileWith(cat(u8(0xff, 0x08), BITCOIN_ATT_1, u8(0x08), BITCOIN_ATT_1)))
  })
  it('varuint não-canônico', () => {
    bad(fileWith(cat(u8(0x00), BITCOIN_TAG, u8(2, 0x81, 0x00))))
  })
  it('varuint com mais de 9 bytes', () => {
    bad(fileWith(cat(u8(0x00), BITCOIN_TAG, new Uint8Array(10).fill(0x80))))
  })
  it('payload bitcoin com sobra', () => {
    bad(fileWith(cat(u8(0x00), BITCOIN_TAG, u8(2, 1, 1))))
  })
  it('URI pending com caractere fora do charset', () => {
    const uri = new TextEncoder().encode('https://x.com/?a=1')
    bad(fileWith(cat(u8(0x00), PENDING_TAG, u8(uri.length + 1, uri.length), uri)))
  })
  it('profundidade: 255 ops aninhadas ok, 256 → erro', () => {
    const ok = fileWith(cat(new Uint8Array(255).fill(0x08), BITCOIN_ATT_1))
    expect(parseOtsFile(ok).timestamp.ops).toHaveLength(1)
    expect(bytesToHex(serializeOtsFile(parseOtsFile(ok)))).toBe(bytesToHex(ok))
    bad(fileWith(cat(new Uint8Array(256).fill(0x08), BITCOIN_ATT_1)))
  })
  it('attestation desconhecida (ex. litecoin) é preservada no round-trip', () => {
    const b = fileWith(cat(u8(0xff, 0x00), hexToBytes('06869a0d73d71b45'), u8(3, 1, 2, 3), BITCOIN_ATT_1))
    // ordenação canônica: bitcoin (05..) antes de litecoin (06..)
    const canonical = fileWith(cat(u8(0xff), BITCOIN_ATT_1, u8(0x00), hexToBytes('06869a0d73d71b45'), u8(3, 1, 2, 3)))
    const f = parseOtsFile(b)
    expect(f.timestamp.attestations.map((a) => a.type).sort()).toEqual(['bitcoin', 'unknown'])
    expect(bytesToHex(serializeOtsFile(f))).toBe(bytesToHex(canonical))
    expect(bytesToHex(serializeOtsFile(parseOtsFile(canonical)))).toBe(bytesToHex(canonical))
  })
  it('parseTimestampBytes rejeita lixo e vazio', () => {
    expect(() => parseTimestampBytes(new Uint8Array(0))).toThrow(OtsParseError)
    expect(() => parseTimestampBytes(cat(BITCOIN_ATT_1, u8(0)))).toThrow(OtsParseError)
  })
  it('serializar timestamp vazio lança', () => {
    expect(() => serializeOtsFile(newOtsFile(new Uint8Array(32)))).toThrow(OtsParseError)
  })
})

// ─── hashes e helpers ────────────────────────────────────────────────

describe('hashes e codecs', () => {
  const ascii = (s: string): Uint8Array => new TextEncoder().encode(s)

  it('ripemd160 — vetores oficiais', () => {
    expect(bytesToHex(ripemd160(ascii('')))).toBe('9c1185a5c5e9fc54612808977ee8f548b2258d31')
    expect(bytesToHex(ripemd160(ascii('abc')))).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc')
    expect(bytesToHex(ripemd160(ascii('message digest')))).toBe('5d0689ef49d2fae572b881b123a85ffa21595f36')
    expect(bytesToHex(ripemd160(ascii('a'.repeat(1000000))))).toBe('52783243c1697bdbe16d37f97f68f08325dc1528')
    // fronteira de bloco (55/56/64 bytes) contra o node:crypto
    for (const n of [55, 56, 63, 64, 65, 119, 120]) {
      const m = new Uint8Array(n).map((_, i) => i * 7)
      expect(bytesToHex(ripemd160(m))).toBe(createHash('ripemd160').update(m).digest('hex'))
    }
  })

  it('keccak256 (Ethereum, não SHA3)', () => {
    expect(bytesToHex(keccak256(ascii('')))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    expect(bytesToHex(keccak256(ascii('abc')))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')
    expect(bytesToHex(keccak256(new Uint8Array(136)))).toHaveLength(64)
  })

  it('applyOp — sha1/sha256/append/prepend/reverse/hexlify e limites', async () => {
    expect(bytesToHex(await applyOp({ op: 'sha1' }, ascii('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(bytesToHex(await applyOp({ op: 'sha256' }, ascii('abc')))).toBe(bytesToHex(sha256(ascii('abc'))))
    expect(await applyOp({ op: 'append', arg: u8(3) }, u8(1, 2))).toEqual(u8(1, 2, 3))
    expect(await applyOp({ op: 'prepend', arg: u8(0) }, u8(1, 2))).toEqual(u8(0, 1, 2))
    expect(await applyOp({ op: 'reverse' }, u8(1, 2))).toEqual(u8(2, 1))
    expect(new TextDecoder().decode(await applyOp({ op: 'hexlify' }, u8(0xab, 0x01)))).toBe('ab01')
    await expect(applyOp({ op: 'hexlify' }, new Uint8Array(2049))).rejects.toThrow(OtsParseError)
    await expect(applyOp({ op: 'reverse' }, new Uint8Array(0))).rejects.toThrow(OtsParseError)
    await expect(applyOp({ op: 'append', arg: u8(1) }, new Uint8Array(4096))).rejects.toThrow(OtsParseError)
  })

  it('hex/base64 estritos', () => {
    expect(() => hexToBytes('abc')).toThrow(OtsParseError)
    expect(() => hexToBytes('zz')).toThrow(OtsParseError)
    for (const n of [0, 1, 2, 3, 4, 5]) {
      const b = new Uint8Array(n).map((_, i) => 250 - i)
      const s = bytesToBase64(b)
      expect(s).toBe(Buffer.from(b).toString('base64'))
      expect(base64ToBytes(s)).toEqual(b)
      expect(base64ToBytes(s.replace(/=+$/, ''))).toEqual(b) // padding opcional
    }
    expect(() => base64ToBytes('AAA A')).toThrow(OtsParseError)
    expect(() => base64ToBytes('A')).toThrow(OtsParseError)
    expect(() => base64ToBytes('A===')).toThrow(OtsParseError)
  })

  it('bitcoinMsgMatchesMerkleRoot rejeita tamanhos errados', () => {
    expect(bitcoinMsgMatchesMerkleRoot(new Uint8Array(31), '00'.repeat(32))).toBe(false)
    expect(bitcoinMsgMatchesMerkleRoot(new Uint8Array(32), 'zz')).toBe(false)
  })
})

// ─── mergeUpgradeAsync ───────────────────────────────────────────────

describe('mergeUpgradeAsync', () => {
  it('funde a resposta do calendário sob o nó pending; collectLeaves passa a ver o bitcoin', async () => {
    const digest = sha256(u8(42))
    const file: OtsFile = { ...newOtsFile(digest), timestamp: pendingResponse('https://alice.btc.calendar.opentimestamps.org', 7) }
    const [pending] = await collectLeaves(file)
    expect(pending!.attestation.type).toBe('pending')

    const upgrade: OtsTimestamp = {
      attestations: [],
      ops: [{ op: { op: 'prepend', arg: u8(9) }, next: { attestations: [], ops: [{ op: { op: 'sha256' }, next: { attestations: [{ type: 'bitcoin', height: 800000 }], ops: [] } }] } }],
    }
    const merged = await mergeUpgradeAsync(file, pending!.msg, upgrade)
    const leaves = await collectLeaves(merged)
    const btc = leaves.find((l) => l.attestation.type === 'bitcoin')
    expect(btc).toBeDefined()
    expect(bytesToHex(btc!.msg)).toBe(bytesToHex(sha256(cat(u8(9), pending!.msg))))
    expect(leaves.filter((l) => l.attestation.type === 'pending')).toHaveLength(1)
    // original intacto (função não muta)
    expect((await collectLeaves(file)).map((l) => l.attestation.type)).toEqual(['pending'])
    // round-trip do arquivo fundido
    const bytes = serializeOtsFile(merged)
    expect(bytesToHex(serializeOtsFile(parseOtsFile(bytes)))).toBe(bytesToHex(bytes))
  })

  it('commitment ausente → OtsParseError', async () => {
    const file: OtsFile = { ...newOtsFile(sha256(u8(1))), timestamp: pendingResponse('https://a.pool.opentimestamps.org', 1) }
    await expect(mergeUpgradeAsync(file, new Uint8Array(32), { attestations: [{ type: 'bitcoin', height: 1 }], ops: [] })).rejects.toThrow(
      OtsParseError,
    )
  })
})

// ─── cliente de rede (fetch falso) ───────────────────────────────────

describe('stampDigest', () => {
  const digest = sha256(new TextEncoder().encode('evento nostr'))
  const nonce = new Uint8Array(16).fill(0xaa)
  const commitment = sha256(cat(digest, nonce))

  it('POSTa sha256(digest‖nonce) em cada calendário e funde as respostas', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      const i = DEFAULT_CALENDARS.findIndex((c) => url === `${c}/digest`)
      if (i < 0) return new Response('', { status: 500 })
      return bin(serializeTimestampBytes(pendingResponse(`https://cal${i}.example`, i + 1)))
    })
    const file = await stampDigest(digest, { fetch, nonce })
    expect(calls.map((c) => c.url).sort()).toEqual(DEFAULT_CALENDARS.map((c) => `${c}/digest`).sort())
    for (const c of calls) {
      expect(c.init?.method).toBe('POST')
      const h = c.init?.headers as Record<string, string>
      expect(h.Accept).toBe('application/vnd.opentimestamps.v1')
      expect(h['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(bytesToHex(new Uint8Array(c.init?.body as ArrayBuffer))).toBe(bytesToHex(commitment))
    }
    expect(file.digest).toEqual(digest)
    const leaves = await collectLeaves(file)
    expect(leaves.map((l) => (l.attestation.type === 'pending' ? l.attestation.uri : '')).sort()).toEqual(
      [0, 1, 2, 3].map((i) => `https://cal${i}.example`),
    )
    // serializável e estável
    const bytes = serializeOtsFile(file)
    expect(bytesToHex(serializeOtsFile(parseOtsFile(bytes)))).toBe(bytesToHex(bytes))
  })

  it('aceita falhas parciais desde que ≥ minCalendars respondam', async () => {
    // a.pool.opentimestamps.org e a.pool.eternitywall.com respondem; os outros 2 caem.
    const { fetch } = fakeFetch((url) =>
      url.includes('a.pool.') ? bin(serializeTimestampBytes(pendingResponse(`https://${new URL(url).hostname}`, 1))) : new Response('', { status: 503 }),
    )
    const two = await stampDigest(digest, { fetch, nonce })
    expect((await collectLeaves(two)).length).toBe(2)
    await expect(stampDigest(digest, { fetch, nonce, minCalendars: 3 })).rejects.toThrow(/only 2\/4 .*need 3/)
    const one = await stampDigest(digest, { fetch, nonce, minCalendars: 1, calendars: ['https://a.pool.opentimestamps.org'] })
    expect((await collectLeaves(one)).length).toBe(1)
  })

  it('menos que minCalendars → lança; resposta sem attestation não conta', async () => {
    const { fetch } = fakeFetch((url) => {
      if (url.startsWith('https://a.pool.opentimestamps.org')) return bin(serializeTimestampBytes(pendingResponse('https://x.example', 1)))
      if (url.startsWith('https://b.pool.opentimestamps.org')) return bin(u8(0xf0)) // lixo
      throw new Error('network down')
    })
    await expect(stampDigest(digest, { fetch, nonce })).rejects.toThrow(/need 2/)
  })
})

describe('upgradeOtsFile', () => {
  const ALICE = 'https://alice.btc.calendar.opentimestamps.org'

  async function pendingFile(): Promise<OtsFile> {
    const digest = sha256(u8(5))
    const ts: OtsTimestamp = {
      attestations: [],
      ops: [
        { op: { op: 'append', arg: u8(1) }, next: pendingResponse(ALICE, 1) },
        { op: { op: 'append', arg: u8(2) }, next: pendingResponse('https://evil.example.com', 2) },
        { op: { op: 'append', arg: u8(3) }, next: pendingResponse('http://bob.btc.calendar.opentimestamps.org', 3) },
        { op: { op: 'append', arg: u8(4) }, next: pendingResponse('https://alice.btc.calendar.opentimestamps.org.evil.com', 4) },
      ],
    }
    return { ...newOtsFile(digest), timestamp: ts }
  }

  it('200 → funde; URIs fora da whitelist/sem https nunca são contactadas', async () => {
    const file = await pendingFile()
    const aliceLeaf = (await collectLeaves(file)).find((l) => l.attestation.type === 'pending' && l.attestation.uri === ALICE)!
    const upgrade: OtsTimestamp = {
      attestations: [],
      ops: [{ op: { op: 'sha256' }, next: { attestations: [{ type: 'bitcoin', height: 900000 }], ops: [] } }],
    }
    const { fetch, calls } = fakeFetch((url) =>
      url === `${ALICE}/timestamp/${bytesToHex(aliceLeaf.msg)}` ? bin(serializeTimestampBytes(upgrade)) : new Response('', { status: 404 }),
    )
    const { file: up, changed } = await upgradeOtsFile(file, { fetch })
    expect(changed).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([`${ALICE}/timestamp/${bytesToHex(aliceLeaf.msg)}`])
    expect((calls[0]!.init?.headers as Record<string, string>).Accept).toBe('application/vnd.opentimestamps.v1')
    const btc = (await collectLeaves(up)).filter((l) => l.attestation.type === 'bitcoin')
    expect(btc).toHaveLength(1)
    expect(bytesToHex(btc[0]!.msg)).toBe(bytesToHex(sha256(aliceLeaf.msg)))

    // verificação ponta a ponta com header falso coerente
    const root = bytesToHex(btc[0]!.msg.slice().reverse())
    expect(await verifyOtsBitcoin(up, file.digest, { getHeader: async () => ({ merkleRoot: root, time: 1700000000 }) })).toEqual({
      height: 900000,
      time: 1700000000,
    })

    // stripPending: só o ramo bitcoin sobrevive, e serializa
    const stripped = stripPending(up)
    const sl = await collectLeaves(stripped)
    expect(sl.map((l) => l.attestation.type)).toEqual(['bitcoin'])
    expect(stripped.timestamp.ops).toHaveLength(1)
    const bytes = serializeOtsFile(stripped)
    expect(bytesToHex(serializeOtsFile(parseOtsFile(bytes)))).toBe(bytesToHex(bytes))
  })

  it('404 → continua pending, changed=false; erro de rede não lança', async () => {
    const file = await pendingFile()
    const r404 = await upgradeOtsFile(file, { fetch: fakeFetch(() => new Response('', { status: 404 })).fetch })
    expect(r404.changed).toBe(false)
    expect(r404.file).toBe(file)
    const rErr = await upgradeOtsFile(file, {
      fetch: fakeFetch(() => {
        throw new Error('offline')
      }).fetch,
    })
    expect(rErr.changed).toBe(false)
  })

  it('stripPending de prova só-pending deixa timestamp vazio (não publicável)', async () => {
    const stripped = stripPending(await pendingFile())
    expect(stripped.timestamp).toEqual({ attestations: [], ops: [] })
    expect(() => serializeOtsFile(stripped)).toThrow(OtsParseError)
  })
})

describe('fetchBitcoinBlockHeader', () => {
  const HASH = '000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319'
  const block = (root: string, time: number): string =>
    JSON.stringify({ id: HASH, height: 358391, merkle_root: root, timestamp: time })

  function explorers(answers: Record<string, string | null>): typeof fetch {
    return fakeFetch((url) => {
      for (const [api, body] of Object.entries(answers)) {
        if (!url.startsWith(api)) continue
        if (body === null) return new Response('down', { status: 502 })
        if (url === `${api}/block-height/358391`) return new Response(HASH)
        if (url === `${api}/block/${HASH}`) return new Response(body)
      }
      return new Response('nope', { status: 404 })
    }).fetch
  }

  it('dois exploradores concordando → header', async () => {
    const fetch = explorers({
      'https://mempool.space/api': block(BLOCK_358391.merkleRoot, BLOCK_358391.time),
      'https://blockstream.info/api': block(BLOCK_358391.merkleRoot, BLOCK_358391.time),
    })
    expect(await fetchBitcoinBlockHeader(358391, { fetch })).toEqual(BLOCK_358391)
  })

  it('exploradores divergindo → lança', async () => {
    const fetch = explorers({
      'https://mempool.space/api': block(BLOCK_358391.merkleRoot, BLOCK_358391.time),
      'https://blockstream.info/api': block('11'.repeat(32), BLOCK_358391.time),
    })
    await expect(fetchBitcoinBlockHeader(358391, { fetch })).rejects.toThrow(/disagree/)
  })

  it('menos de 2 respostas → lança; 2 de 3 concordando → ok', async () => {
    const one = explorers({
      'https://mempool.space/api': block(BLOCK_358391.merkleRoot, BLOCK_358391.time),
      'https://blockstream.info/api': null,
    })
    await expect(fetchBitcoinBlockHeader(358391, { fetch: one })).rejects.toThrow(/>= 2/)
    const three = explorers({
      'https://a.example/api': block(BLOCK_358391.merkleRoot, BLOCK_358391.time),
      'https://b.example/api': null,
      'https://c.example/api': block(BLOCK_358391.merkleRoot, BLOCK_358391.time),
    })
    expect(
      await fetchBitcoinBlockHeader(358391, {
        fetch: three,
        explorers: ['https://a.example/api', 'https://b.example/api', 'https://c.example/api'],
      }),
    ).toEqual(BLOCK_358391)
  })

  it('JSON malformado ou altura/id incoerentes não contam como resposta', async () => {
    const fetch = explorers({
      'https://mempool.space/api': JSON.stringify({ id: HASH, height: 1, merkle_root: BLOCK_358391.merkleRoot, timestamp: 5 }),
      'https://blockstream.info/api': block(BLOCK_358391.merkleRoot, BLOCK_358391.time),
    })
    await expect(fetchBitcoinBlockHeader(358391, { fetch })).rejects.toThrow(/>= 2/)
  })
})
