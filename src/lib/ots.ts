/**
 * OpenTimestamps (OTS) — formato de prova + verificação. Módulo PURO:
 * sem rede, sem relógio, sem DB. Só bytes in → bytes/estruturas out.
 *
 * Por que existe:
 *  - A "antiguidade" de uma identidade (peso anti-Sybil) hoje confia no
 *    `created_at` do evento Nostr, que o signatário escolhe livremente —
 *    uma chave criada hoje pode se dizer de 2019. NIP-03 (kind 1040)
 *    resolve isso: o conteúdo é uma prova OTS (base64) de que o id do
 *    evento existia ANTES de um bloco Bitcoin. Retroagir exigiria
 *    reescrever a chain.
 *  - Este módulo só entende o formato e calcula os "messages" ao longo da
 *    árvore. Quem fala com calendários/exploradores é `ots-client.ts`;
 *    quem decide peso é o ingest. Separação deliberada: tudo aqui é
 *    determinístico e testável sem rede.
 *
 * Formato (espelha python-opentimestamps, a implementação de referência):
 *  - Arquivo = MAGIC (31 bytes) ‖ major version (uint8 = 1) ‖ tag do hash
 *    do arquivo (só 0x08 sha256 aceito) ‖ digest (32 bytes) ‖ Timestamp.
 *  - Timestamp = árvore. Cada nó tem attestations (folhas) e ops (arestas
 *    que transformam o message do nó no message do filho). Serializado
 *    como lista de itens; todos menos o último prefixados com 0xff.
 *    Item 0x00 = attestation (tag 8 bytes + varbytes payload); qualquer
 *    outro byte = tag de op, seguido (se binária) do argumento varbytes e
 *    do Timestamp do resultado.
 *  - varuint = LEB128 sem sinal; varbytes = varuint length ‖ bytes.
 *
 * Endurecimento do parser (a prova vem de evento Nostr = input hostil):
 *  - profundidade máx 256 (igual ao `_recursion_limit` do python);
 *  - payload de attestation ≤ 8192, argumento de op ≤ 4096 e ≥ 1;
 *  - URI de pending ≤ 1000 bytes e só charset `[A-Za-z0-9-._/:]`;
 *  - tag de op desconhecida, op repetida no mesmo nó, lixo no fim,
 *    varuint não-mínimo ou > 9 bytes → `OtsParseError`.
 *  Varuint não-mínimo é REJEITADO (python aceita): nenhum cliente real o
 *  emite e aceitá-lo quebraria o round-trip byte-exato (maleabilidade).
 *
 * Os messages NÃO são calculados no parse (sha256 via WebCrypto é async e
 * o parse precisa ser síncrono). Limites de tamanho de message
 * (≤ 4096, hexlify ≤ 2048) são aplicados em `applyOp`, ou seja, em
 * `collectLeaves`/`mergeUpgradeAsync`.
 */

export class OtsParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OtsParseError'
  }
}

export type OtsOp =
  | { op: 'sha256' }
  | { op: 'sha1' }
  | { op: 'ripemd160' }
  | { op: 'keccak256' }
  | { op: 'append'; arg: Uint8Array }
  | { op: 'prepend'; arg: Uint8Array }
  | { op: 'reverse' }
  | { op: 'hexlify' }

export type OtsAttestation =
  | { type: 'bitcoin'; height: number }
  | { type: 'pending'; uri: string }
  | { type: 'unknown'; tag: Uint8Array; payload: Uint8Array }

export interface OtsTimestamp {
  attestations: OtsAttestation[]
  ops: Array<{ op: OtsOp; next: OtsTimestamp }>
}

export interface OtsFile {
  hashOp: 'sha256'
  digest: Uint8Array
  timestamp: OtsTimestamp
}

export type OtsLeaf = { attestation: OtsAttestation; msg: Uint8Array }

// ─── constantes do formato ──────────────────────────────────────────

const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
])
const MAJOR_VERSION = 1
const TAG_ATTESTATION = 0x00
const TAG_CONTINUE = 0xff
const BITCOIN_TAG = new Uint8Array([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01])
const PENDING_TAG = new Uint8Array([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e])

/** Profundidade máxima de Timestamps aninhados (python: _recursion_limit=256). */
export const OTS_MAX_DEPTH = 256
const MAX_ATTESTATION_PAYLOAD = 8192
const MAX_OP_LENGTH = 4096 // python Op.MAX_RESULT_LENGTH == MAX_MSG_LENGTH
const MAX_HEXLIFY_MSG = MAX_OP_LENGTH / 2
const MAX_URI_LENGTH = 1000
const MAX_HEIGHT = 2 ** 32 - 1
const MAX_VARUINT_BYTES = 9
const URI_CHARSET = /^[A-Za-z0-9\-._/:]*$/

const UNARY_TAGS: Record<number, OtsOp['op']> = {
  0x02: 'sha1',
  0x03: 'ripemd160',
  0x08: 'sha256',
  0x67: 'keccak256',
  0xf2: 'reverse',
  0xf3: 'hexlify',
}
const OP_TAG: Record<OtsOp['op'], number> = {
  sha1: 0x02,
  ripemd160: 0x03,
  sha256: 0x08,
  keccak256: 0x67,
  append: 0xf0,
  prepend: 0xf1,
  reverse: 0xf2,
  hexlify: 0xf3,
}

// ─── leitura ────────────────────────────────────────────────────────

class Reader {
  pos = 0
  constructor(private readonly buf: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.buf.length) throw new OtsParseError('truncated: unexpected end of data')
    return this.buf[this.pos++]!
  }

  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) {
      throw new OtsParseError(`truncated: wanted ${n} bytes, have ${this.buf.length - this.pos}`)
    }
    const out = this.buf.slice(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  varuint(): number {
    let value = 0
    for (let i = 0; i < MAX_VARUINT_BYTES; i++) {
      const b = this.byte()
      value += (b & 0x7f) * 2 ** (7 * i)
      if ((b & 0x80) === 0) {
        // Forma mínima: o último byte só pode ser 0 se for o único byte.
        if (b === 0 && i > 0) throw new OtsParseError('non-canonical varuint')
        if (!Number.isSafeInteger(value)) throw new OtsParseError('varuint too large')
        return value
      }
    }
    throw new OtsParseError(`varuint exceeds ${MAX_VARUINT_BYTES} bytes`)
  }

  varbytes(maxLen: number, minLen = 0): Uint8Array {
    const len = this.varuint()
    if (len > maxLen) throw new OtsParseError(`varbytes too long: ${len} > ${maxLen}`)
    if (len < minLen) throw new OtsParseError(`varbytes too short: ${len} < ${minLen}`)
    return this.bytes(len)
  }

  assertEof(what: string): void {
    if (this.pos !== this.buf.length) {
      throw new OtsParseError(`trailing garbage after ${what} (${this.buf.length - this.pos} bytes)`)
    }
  }
}

function parseAttestation(r: Reader): OtsAttestation {
  const tag = r.bytes(8)
  const payload = r.varbytes(MAX_ATTESTATION_PAYLOAD)
  if (bytesEqual(tag, BITCOIN_TAG)) {
    const pr = new Reader(payload)
    const height = pr.varuint()
    if (height > MAX_HEIGHT) throw new OtsParseError(`block height too large: ${height}`)
    pr.assertEof('bitcoin attestation')
    return { type: 'bitcoin', height }
  }
  if (bytesEqual(tag, PENDING_TAG)) {
    const pr = new Reader(payload)
    const uriBytes = pr.varbytes(MAX_URI_LENGTH)
    pr.assertEof('pending attestation')
    // Charset restrito (sem query/fragment/@/%): impede que uma prova
    // hostil carregue URLs que façam o cliente vazar algo ao "atualizar".
    let uri = ''
    for (const c of uriBytes) uri += String.fromCharCode(c)
    if (!URI_CHARSET.test(uri)) throw new OtsParseError('invalid character in pending URI')
    return { type: 'pending', uri }
  }
  // Litecoin/Ethereum/futuros: preservados opacos (round-trip), ignorados
  // na verificação.
  return { type: 'unknown', tag, payload }
}

function parseOp(tag: number, r: Reader): OtsOp {
  if (tag === 0xf0) return { op: 'append', arg: r.varbytes(MAX_OP_LENGTH, 1) }
  if (tag === 0xf1) return { op: 'prepend', arg: r.varbytes(MAX_OP_LENGTH, 1) }
  const name = UNARY_TAGS[tag]
  if (name === undefined) {
    throw new OtsParseError(`unknown op tag 0x${tag.toString(16).padStart(2, '0')}`)
  }
  return { op: name } as OtsOp
}

function parseTimestamp(r: Reader, depth: number): OtsTimestamp {
  if (depth > OTS_MAX_DEPTH) throw new OtsParseError(`timestamp nesting exceeds ${OTS_MAX_DEPTH}`)
  const ts: OtsTimestamp = { attestations: [], ops: [] }

  const handle = (tag: number): void => {
    if (tag === TAG_ATTESTATION) {
      const att = parseAttestation(r)
      // python guarda attestations num set → duplicata colapsa em silêncio.
      if (!ts.attestations.some((a) => compareAttestations(a, att) === 0)) {
        ts.attestations.push(att)
      }
      return
    }
    const op = parseOp(tag, r)
    // python guarda ops num dict e rejeita repetição explicitamente.
    if (ts.ops.some((o) => compareOps(o.op, op) === 0)) {
      throw new OtsParseError(`op ${op.op} repeated in the same node`)
    }
    const next = parseTimestamp(r, depth + 1)
    ts.ops.push({ op, next })
  }

  let tag = r.byte()
  while (tag === TAG_CONTINUE) {
    handle(r.byte())
    tag = r.byte()
  }
  handle(tag)
  return ts
}

/**
 * Parse de um arquivo `.ots` completo (header + digest + Timestamp).
 * Lança `OtsParseError` para qualquer desvio do formato — o chamador
 * trata prova inválida como "sem prova", nunca como "prova parcial".
 */
export function parseOtsFile(bytes: Uint8Array): OtsFile {
  const r = new Reader(bytes)
  if (bytes.length < HEADER_MAGIC.length || !bytesEqual(r.bytes(HEADER_MAGIC.length), HEADER_MAGIC)) {
    throw new OtsParseError('bad magic: not an OpenTimestamps proof')
  }
  const major = r.byte()
  if (major !== MAJOR_VERSION) throw new OtsParseError(`unsupported major version ${major}`)
  const hashTag = r.byte()
  // Só sha256: é o que NIP-03 usa (id do evento) e sha1/ripemd160 como
  // hash de ARQUIVO não fazem sentido aqui.
  if (hashTag !== OP_TAG.sha256) {
    throw new OtsParseError(`unsupported file hash op 0x${hashTag.toString(16).padStart(2, '0')}`)
  }
  const digest = r.bytes(32)
  const timestamp = parseTimestamp(r, 1)
  r.assertEof('timestamp')
  return { hashOp: 'sha256', digest, timestamp }
}

/**
 * Parse de um Timestamp "nu" — formato das respostas de calendário
 * (`POST /digest`, `GET /timestamp/<hex>`): sem header e sem op de hash
 * do arquivo; o message inicial é o commitment enviado/consultado.
 */
export function parseTimestampBytes(bytes: Uint8Array): OtsTimestamp {
  const r = new Reader(bytes)
  const ts = parseTimestamp(r, 1)
  r.assertEof('timestamp')
  return ts
}

// ─── ordenação canônica (idêntica ao python) ────────────────────────

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!
    if (d !== 0) return d
  }
  return a.length - b.length
}

function attestationTag(a: OtsAttestation): Uint8Array {
  return a.type === 'bitcoin' ? BITCOIN_TAG : a.type === 'pending' ? PENDING_TAG : a.tag
}

/**
 * python ordena attestations com `sorted(set)` usando `__lt__`: classes
 * diferentes → pela TAG de 8 bytes; Bitcoin → altura (numérica, NÃO pelo
 * LEB128 serializado); Pending → URI; Unknown → (tag, payload).
 */
function compareAttestations(a: OtsAttestation, b: OtsAttestation): number {
  if (a.type !== b.type) return compareBytes(attestationTag(a), attestationTag(b))
  if (a.type === 'bitcoin' && b.type === 'bitcoin') return a.height - b.height
  if (a.type === 'pending' && b.type === 'pending') return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0
  if (a.type === 'unknown' && b.type === 'unknown') {
    return compareBytes(a.tag, b.tag) || compareBytes(a.payload, b.payload)
  }
  return 0
}

/** python `Op.__lt__`: pela tag; mesma tag → pelo argumento (bytes). */
function compareOps(a: OtsOp, b: OtsOp): number {
  const d = OP_TAG[a.op] - OP_TAG[b.op]
  if (d !== 0) return d
  if ('arg' in a && 'arg' in b) return compareBytes(a.arg, b.arg)
  return 0
}

// ─── escrita ────────────────────────────────────────────────────────

class Writer {
  private chunks: number[] = []
  byte(b: number): void {
    this.chunks.push(b & 0xff)
  }
  bytes(b: Uint8Array): void {
    for (const x of b) this.chunks.push(x)
  }
  varuint(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new OtsParseError(`invalid varuint ${n}`)
    let v = n
    while (v >= 0x80) {
      this.chunks.push((v % 0x80) | 0x80)
      v = Math.floor(v / 0x80)
    }
    this.chunks.push(v)
  }
  varbytes(b: Uint8Array): void {
    this.varuint(b.length)
    this.bytes(b)
  }
  result(): Uint8Array {
    return Uint8Array.from(this.chunks)
  }
}

function writeAttestation(w: Writer, a: OtsAttestation): void {
  w.bytes(attestationTag(a))
  const p = new Writer()
  if (a.type === 'bitcoin') p.varuint(a.height)
  else if (a.type === 'pending') {
    const enc = new Uint8Array(a.uri.length)
    for (let i = 0; i < a.uri.length; i++) enc[i] = a.uri.charCodeAt(i)
    p.varbytes(enc)
  } else p.bytes(a.payload)
  w.varbytes(p.result())
}

function writeOp(w: Writer, op: OtsOp): void {
  w.byte(OP_TAG[op.op])
  if (op.op === 'append' || op.op === 'prepend') w.varbytes(op.arg)
}

function writeTimestamp(w: Writer, ts: OtsTimestamp, depth: number): void {
  if (depth > OTS_MAX_DEPTH) {
    // Nunca emitir algo que o próprio parser (e o python) recusariam.
    throw new OtsParseError(`timestamp nesting exceeds ${OTS_MAX_DEPTH}`)
  }
  // Duplicatas de attestation colapsam (python usa set); op repetida é
  // erro (python usa dict e a recusa no parse).
  const atts = [...ts.attestations]
    .sort(compareAttestations)
    .filter((a, i, arr) => i === 0 || compareAttestations(arr[i - 1]!, a) !== 0)
  const ops = [...ts.ops].sort((x, y) => compareOps(x.op, y.op))
  for (let i = 1; i < ops.length; i++) {
    if (compareOps(ops[i - 1]!.op, ops[i]!.op) === 0) {
      throw new OtsParseError(`op ${ops[i]!.op.op} repeated in the same node`)
    }
  }
  const total = atts.length + ops.length
  if (total === 0) throw new OtsParseError("an empty timestamp can't be serialized")
  let item = 0
  for (const att of atts) {
    if (item++ < total - 1) w.byte(TAG_CONTINUE)
    w.byte(TAG_ATTESTATION)
    writeAttestation(w, att)
  }
  for (const { op, next } of ops) {
    if (item++ < total - 1) w.byte(TAG_CONTINUE)
    writeOp(w, op)
    writeTimestamp(w, next, depth + 1)
  }
}

/**
 * Serialização canônica (ordem do python: attestations ordenadas, depois
 * ops ordenadas; todos menos o último item com prefixo 0xff). Para
 * qualquer arquivo aceito por `parseOtsFile` e já canônico (todo arquivo
 * emitido pelo cliente oficial), `serializeOtsFile(parseOtsFile(b))`
 * reproduz `b` byte a byte.
 *
 * Lança `OtsParseError` se a árvore estiver vazia em algum nó (python
 * também recusa) ou passar da profundidade máxima.
 */
export function serializeOtsFile(file: OtsFile): Uint8Array {
  if (file.hashOp !== 'sha256' || file.digest.length !== 32) {
    throw new OtsParseError('only sha256 file digests (32 bytes) are supported')
  }
  const w = new Writer()
  w.bytes(HEADER_MAGIC)
  w.byte(MAJOR_VERSION)
  w.byte(OP_TAG.sha256)
  w.bytes(file.digest)
  writeTimestamp(w, file.timestamp, 1)
  return w.result()
}

/** Serializa um Timestamp nu (formato de resposta de calendário). */
export function serializeTimestampBytes(ts: OtsTimestamp): Uint8Array {
  const w = new Writer()
  writeTimestamp(w, ts, 1)
  return w.result()
}

/** Arquivo vazio para um digest sha256 — ponto de partida de `stampDigest`. */
export function newOtsFile(digest32: Uint8Array): OtsFile {
  if (digest32.length !== 32) throw new OtsParseError('digest must be 32 bytes')
  return { hashOp: 'sha256', digest: digest32.slice(), timestamp: { attestations: [], ops: [] } }
}

// ─── aplicação de ops ───────────────────────────────────────────────

async function subtleDigest(alg: 'SHA-256' | 'SHA-1', msg: Uint8Array): Promise<Uint8Array> {
  // Cópia p/ ArrayBuffer dedicado: subtle.digest recusa (no TS) views
  // sobre SharedArrayBuffer — mesmo padrão de nip94.ts:sha256Hex.
  const buf = new ArrayBuffer(msg.byteLength)
  new Uint8Array(buf).set(msg)
  return new Uint8Array(await globalThis.crypto.subtle.digest(alg, buf))
}

/**
 * Aplica uma op a um message. Impõe os limites do python
 * (`MsgValueError`): message ≤ 4096 (hexlify ≤ 2048), reverse/hexlify
 * exigem message não vazio, resultado entre 1 e 4096 bytes. Violação →
 * `OtsParseError` (python recusaria o arquivo no parse).
 */
export async function applyOp(op: OtsOp, msg: Uint8Array): Promise<Uint8Array> {
  const maxMsg = op.op === 'hexlify' ? MAX_HEXLIFY_MSG : MAX_OP_LENGTH
  if (msg.length > maxMsg) throw new OtsParseError(`message too long for ${op.op}: ${msg.length}`)
  let out: Uint8Array
  switch (op.op) {
    case 'sha256':
      out = await subtleDigest('SHA-256', msg)
      break
    case 'sha1':
      out = await subtleDigest('SHA-1', msg)
      break
    case 'ripemd160':
      out = ripemd160(msg)
      break
    case 'keccak256':
      out = keccak256(msg)
      break
    case 'append':
      out = concatBytes(msg, op.arg)
      break
    case 'prepend':
      out = concatBytes(op.arg, msg)
      break
    case 'reverse':
      if (msg.length === 0) throw new OtsParseError("can't reverse an empty message")
      out = msg.slice().reverse()
      break
    case 'hexlify': {
      if (msg.length === 0) throw new OtsParseError("can't hexlify an empty message")
      const hex = bytesToHex(msg)
      out = new Uint8Array(hex.length)
      for (let i = 0; i < hex.length; i++) out[i] = hex.charCodeAt(i)
      break
    }
  }
  if (out.length === 0 || out.length > MAX_OP_LENGTH) {
    throw new OtsParseError(`op ${op.op} result length out of range: ${out.length}`)
  }
  return out
}

/**
 * Percorre a árvore a partir de `file.digest` aplicando as ops; devolve
 * cada attestation junto com o message que ela atesta. Para Bitcoin, esse
 * message é a merkle root do bloco (ordem interna de bytes). Lança
 * `OtsParseError` se alguma op for inaplicável (limites de tamanho).
 */
export async function collectLeaves(file: OtsFile): Promise<OtsLeaf[]> {
  const out: OtsLeaf[] = []
  // Iterativo (pilha explícita) em vez de recursão: a profundidade já é
  // limitada, mas assim não dependemos do tamanho de pilha do engine.
  const stack: Array<[OtsTimestamp, Uint8Array]> = [[file.timestamp, file.digest]]
  while (stack.length > 0) {
    const [ts, msg] = stack.pop()!
    for (const attestation of ts.attestations) out.push({ attestation, msg })
    for (const { op, next } of ts.ops) stack.push([next, await applyOp(op, msg)])
  }
  return out
}

// ─── merge ──────────────────────────────────────────────────────────

function cloneOp(op: OtsOp): OtsOp {
  return 'arg' in op ? { op: op.op, arg: op.arg.slice() } : { op: op.op }
}

function cloneAttestation(a: OtsAttestation): OtsAttestation {
  return a.type === 'unknown' ? { type: 'unknown', tag: a.tag.slice(), payload: a.payload.slice() } : { ...a }
}

/** Cópia profunda — os tipos são mutáveis; evita aliasing entre versões. */
export function cloneTimestamp(ts: OtsTimestamp): OtsTimestamp {
  return {
    attestations: ts.attestations.map(cloneAttestation),
    ops: ts.ops.map(({ op, next }) => ({ op: cloneOp(op), next: cloneTimestamp(next) })),
  }
}

/**
 * União estrutural de dois Timestamps PARA O MESMO MESSAGE (python
 * `Timestamp.merge`): attestations sem duplicata; ops iguais têm os
 * filhos fundidos recursivamente (mesma op sobre o mesmo message gera o
 * mesmo resultado, então não precisamos dos messages aqui). Não muta.
 */
export function mergeTimestamps(a: OtsTimestamp, b: OtsTimestamp): OtsTimestamp {
  const out = cloneTimestamp(a)
  for (const att of b.attestations) {
    if (!out.attestations.some((x) => compareAttestations(x, att) === 0)) {
      out.attestations.push(cloneAttestation(att))
    }
  }
  for (const { op, next } of b.ops) {
    const idx = out.ops.findIndex((x) => compareOps(x.op, op) === 0)
    if (idx === -1) out.ops.push({ op: cloneOp(op), next: cloneTimestamp(next) })
    else out.ops[idx] = { op: out.ops[idx]!.op, next: mergeTimestamps(out.ops[idx]!.next, next) }
  }
  return out
}

/**
 * Versão async de `mergeUpgrade` (o nome do contrato original): achar o
 * nó cujo message é `commitment` exige recalcular os messages (sha256 via
 * WebCrypto = async). Devolve um arquivo NOVO onde todo nó com message ==
 * `commitment` (normalmente um só: o que segura a attestation pending)
 * recebe também as ops/attestations de `upgrade`.
 *
 * Lança `OtsParseError` se nenhum nó tiver esse message — sinal de que a
 * resposta do calendário não corresponde a esta prova.
 */
export async function mergeUpgradeAsync(
  file: OtsFile,
  commitment: Uint8Array,
  upgrade: OtsTimestamp,
): Promise<OtsFile> {
  let found = false
  const rebuild = async (ts: OtsTimestamp, msg: Uint8Array): Promise<OtsTimestamp> => {
    let node: OtsTimestamp = {
      attestations: ts.attestations.map(cloneAttestation),
      ops: [],
    }
    for (const { op, next } of ts.ops) {
      node.ops.push({ op: cloneOp(op), next: await rebuild(next, await applyOp(op, msg)) })
    }
    if (bytesEqual(msg, commitment)) {
      found = true
      node = mergeTimestamps(node, upgrade)
    }
    return node
  }
  const timestamp = await rebuild(file.timestamp, file.digest)
  if (!found) throw new OtsParseError('commitment not found in timestamp')
  return { hashOp: 'sha256', digest: file.digest.slice(), timestamp }
}

/**
 * Remove attestations pending e poda ramos que ficaram vazios. NIP-03
 * exige que a prova publicada não carregue pending (só Bitcoin). Se nada
 * sobrar, o timestamp raiz fica vazio — `serializeOtsFile` então recusa,
 * o que é o comportamento certo (não há prova a publicar).
 */
export function stripPending(file: OtsFile): OtsFile {
  const prune = (ts: OtsTimestamp): OtsTimestamp | null => {
    const attestations = ts.attestations.filter((a) => a.type !== 'pending').map(cloneAttestation)
    const ops: OtsTimestamp['ops'] = []
    for (const { op, next } of ts.ops) {
      const n = prune(next)
      if (n) ops.push({ op: cloneOp(op), next: n })
    }
    return attestations.length === 0 && ops.length === 0 ? null : { attestations, ops }
  }
  return {
    hashOp: 'sha256',
    digest: file.digest.slice(),
    timestamp: prune(file.timestamp) ?? { attestations: [], ops: [] },
  }
}

/**
 * O message de uma attestation Bitcoin é a merkle root em ordem INTERNA;
 * exploradores (Esplora `merkle_root`) mostram a ordem de EXIBIÇÃO, que é
 * o reverso byte a byte. Comparação case-insensitive no hex.
 */
export function bitcoinMsgMatchesMerkleRoot(msg: Uint8Array, merkleRootDisplayHex: string): boolean {
  if (msg.length !== 32 || !/^[0-9a-fA-F]{64}$/.test(merkleRootDisplayHex)) return false
  return bytesToHex(msg.slice().reverse()) === merkleRootDisplayHex.toLowerCase()
}

// ─── utilitários de bytes ───────────────────────────────────────────

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

const HEX = '0123456789abcdef'

export function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += HEX[x >> 4]! + HEX[x & 15]!
  return s
}

/** Hex estrito (comprimento par, só [0-9a-fA-F]); senão `OtsParseError`. */
export function hexToBytes(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new OtsParseError('invalid hex')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX: Record<string, number> = {}
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]!] = i

/**
 * Base64 padrão (RFC 4648 §4). Padding opcional; qualquer caractere fora
 * do alfabeto (inclusive espaço) → `OtsParseError`. Implementação própria
 * em vez de `atob`: `atob` ignora whitespace e trabalha com "binary
 * strings", e queremos rejeição explícita de conteúdo malformado.
 */
export function base64ToBytes(s: string): Uint8Array {
  let str = s
  if (str.length % 4 === 0 && str.endsWith('==')) str = str.slice(0, -2)
  else if (str.length % 4 === 0 && str.endsWith('=')) str = str.slice(0, -1)
  if (str.length % 4 === 1) throw new OtsParseError('invalid base64 length')
  const out = new Uint8Array(Math.floor((str.length * 3) / 4))
  let o = 0
  for (let i = 0; i < str.length; i += 4) {
    const chunk = str.slice(i, i + 4)
    let v = 0
    for (let j = 0; j < 4; j++) {
      const c = chunk[j]
      if (c === undefined) {
        v <<= 6
        continue
      }
      const idx = B64_INDEX[c]
      if (idx === undefined) throw new OtsParseError('invalid base64 character')
      v = (v << 6) | idx
    }
    out[o++] = (v >> 16) & 0xff
    if (chunk.length > 2) out[o++] = (v >> 8) & 0xff
    if (chunk.length > 3) out[o++] = v & 0xff
  }
  return out
}

export function bytesToBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = b.length - i
    const v = (b[i]! << 16) | ((n > 1 ? b[i + 1]! : 0) << 8) | (n > 2 ? b[i + 2]! : 0)
    s += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]!
    s += n > 1 ? B64[(v >> 6) & 63]! : '='
    s += n > 2 ? B64[v & 63]! : '='
  }
  return s
}

// ─── RIPEMD-160 (puro) ──────────────────────────────────────────────
// WebCrypto não tem ripemd160, e provas reais o usam: o caminho da tx
// Bitcoin no exemplo oficial começa com `ripemd160`. Implementação direta
// da especificação (Dobbertin/Bosselaers/Preneel 1996).

const RMD_R = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3,
  10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0,
  5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
]
const RMD_RP = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15,
  5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15,
  10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
]
const RMD_S = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
]
const RMD_SP = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
]
const RMD_K = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e]
const RMD_KP = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000]

function rmdF(j: number, x: number, y: number, z: number): number {
  if (j < 16) return x ^ y ^ z
  if (j < 32) return (x & y) | (~x & z)
  if (j < 48) return (x | ~y) ^ z
  if (j < 64) return (x & z) | (y & ~z)
  return x ^ (y | ~z)
}

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n))

export function ripemd160(msg: Uint8Array): Uint8Array {
  // Padding MD4-style: 0x80, zeros, comprimento em bits little-endian (64 bits).
  const bitLen = msg.length * 8
  const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64)
  padded.set(msg)
  padded[msg.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, bitLen >>> 0, true)
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const X = new Array<number>(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true)
    let al = h0, bl = h1, cl = h2, dl = h3, el = h4
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4
    for (let j = 0; j < 80; j++) {
      const round = j >> 4
      let t = (rotl((al + rmdF(j, bl, cl, dl) + X[RMD_R[j]!]! + RMD_K[round]!) | 0, RMD_S[j]!) + el) | 0
      al = el
      el = dl
      dl = rotl(cl, 10)
      cl = bl
      bl = t
      t = (rotl((ar + rmdF(79 - j, br, cr, dr) + X[RMD_RP[j]!]! + RMD_KP[round]!) | 0, RMD_SP[j]!) + er) | 0
      ar = er
      er = dr
      dr = rotl(cr, 10)
      cr = br
      br = t
    }
    const t = (h1 + cl + dr) | 0
    h1 = (h2 + dl + er) | 0
    h2 = (h3 + el + ar) | 0
    h3 = (h4 + al + br) | 0
    h4 = (h0 + bl + cr) | 0
    h0 = t
  }
  const out = new Uint8Array(20)
  const odv = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => odv.setUint32(i * 4, h >>> 0, true))
  return out
}

// ─── Keccak-256 (puro, padding original 0x01 — NÃO é SHA3-256) ──────
// Só aparece em attestations Ethereum (que ignoramos na verificação),
// mas implementar evita que um ramo Ethereum inofensivo derrube a
// verificação inteira de uma prova que TAMBÉM tem ramo Bitcoin.

const KECCAK_RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]
// KECCAK_ROT[x][y]
const KECCAK_ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
]
const MASK64 = (1n << 64n) - 1n
const rotl64 = (x: bigint, n: number): bigint =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64

function keccakF(A: bigint[]): void {
  const C = new Array<bigint>(5)
  const B = new Array<bigint>(25)
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x]! ^ A[x + 5]! ^ A[x + 10]! ^ A[x + 15]! ^ A[x + 20]!
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5]! ^ rotl64(C[(x + 1) % 5]!, 1)
      for (let y = 0; y < 5; y++) A[x + 5 * y] = A[x + 5 * y]! ^ D
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(A[x + 5 * y]!, KECCAK_ROT[x]![y]!)
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y]! ^ (~B[((x + 1) % 5) + 5 * y]! & MASK64 & B[((x + 2) % 5) + 5 * y]!)
      }
    }
    A[0] = A[0]! ^ KECCAK_RC[round]!
  }
}

export function keccak256(msg: Uint8Array): Uint8Array {
  const rate = 136
  const padLen = rate - (msg.length % rate)
  const padded = new Uint8Array(msg.length + padLen)
  padded.set(msg)
  padded[msg.length] = 0x01
  padded[padded.length - 1] = padded[padded.length - 1]! | 0x80
  const A = new Array<bigint>(25).fill(0n)
  const dv = new DataView(padded.buffer)
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) A[i] = A[i]! ^ dv.getBigUint64(off + i * 8, true)
    keccakF(A)
  }
  const out = new Uint8Array(32)
  const odv = new DataView(out.buffer)
  for (let i = 0; i < 4; i++) odv.setBigUint64(i * 8, A[i]!, true)
  return out
}
