/**
 * Health ping/pong + degraded detection + TURN config parsing — Fase 6.3.
 *
 * Sem RTCPeerConnection real. Usa test-only helpers:
 *   - `_createPeerStateForTest(id, now0?)`
 *   - `_markPing(peer, now)`           — registra ping enviado
 *   - `_handlePong(peer, pingTs, now)` — calcula RTT, atualiza lastPingMs
 *   - `_isPeerDegraded(peer, now)`     → boolean
 *   - `_parseTurnServers(envValue)`    → RTCIceServer[]
 *
 * Especs:
 *   - peer degraded se (now - lastPingSentAt > 30000) OU (lastPingMs > 5000).
 *   - TURN parser: "turn:host:port" ou "turn:host:port?username=...&credential=..."
 *     múltiplos separados por vírgula sem espaço.
 */

import { describe, expect, it } from 'vitest'
import {
  _createPeerStateForTest,
  _markPing,
  _handlePong,
  _isPeerDegraded,
  _parseTurnServers,
} from '../src/lib/transport/webrtc'

describe('health ping/pong (_markPing / _handlePong)', () => {
  it('markPing seta peer.lastPingSentAt para `now`', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-ping', t0)
    _markPing(peer, t0 + 500)
    // Field gravado no peer (assumido pelo contrato Fase 6.3).
    expect((peer as unknown as { lastPingSentAt: number }).lastPingSentAt).toBe(
      t0 + 500,
    )
  })

  it('handlePong com pingTs match calcula RTT corretamente', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-rtt', t0)
    const pingTs = t0 + 100
    _markPing(peer, pingTs)
    // Pong chega 250ms depois.
    _handlePong(peer, pingTs, pingTs + 250)
    expect(peer.lastPingMs).toBe(250)
  })

  it('handlePong com pingTs antigo (>5min) é dropado (não atualiza lastPingMs)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-stale', t0)
    // Ping foi enviado há 6 minutos.
    const oldPingTs = t0
    _markPing(peer, oldPingTs)
    const now = t0 + 6 * 60 * 1000
    // Estado inicial.
    expect(peer.lastPingMs).toBeNull()
    _handlePong(peer, oldPingTs, now)
    // pingTs antigo demais — deve ser ignorado.
    expect(peer.lastPingMs).toBeNull()
  })

  it('atualiza lastPingMs com latência válida (<5min)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-lat', t0)
    const pingTs = t0 + 1000
    _markPing(peer, pingTs)
    _handlePong(peer, pingTs, pingTs + 42)
    expect(peer.lastPingMs).toBe(42)
  })

  it('múltiplos pongs sucessivos atualizam lastPingMs com o mais recente', () => {
    const t0 = 2_000_000
    const peer = _createPeerStateForTest('peer-multi', t0)
    const ts1 = t0 + 100
    const ts2 = t0 + 200
    _markPing(peer, ts1)
    _handlePong(peer, ts1, ts1 + 50)
    expect(peer.lastPingMs).toBe(50)
    _markPing(peer, ts2)
    _handlePong(peer, ts2, ts2 + 80)
    expect(peer.lastPingMs).toBe(80)
  })
})

describe('peer degraded detection (_isPeerDegraded)', () => {
  it('peer recente (ping há <30s) e latência boa → não degraded', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-fresh', t0)
    _markPing(peer, t0)
    _handlePong(peer, t0, t0 + 50)
    // 10s depois.
    expect(_isPeerDegraded(peer, t0 + 10_000)).toBe(false)
  })

  it('peer sem ping há >30s → degraded', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-stale-ping', t0)
    _markPing(peer, t0)
    _handlePong(peer, t0, t0 + 50)
    // 31s depois sem novo ping.
    expect(_isPeerDegraded(peer, t0 + 31_000)).toBe(true)
  })

  it('peer com latência > 5000ms → degraded mesmo se ping recente', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-slow', t0)
    _markPing(peer, t0)
    _handlePong(peer, t0, t0 + 6000) // RTT 6s
    expect(peer.lastPingMs).toBe(6000)
    // Ping recente (1s atrás) mas latência alta.
    expect(_isPeerDegraded(peer, t0 + 6000 + 1000)).toBe(true)
  })

  it('peer com latência exatamente 5000ms → não degraded (boundary)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-edge', t0)
    _markPing(peer, t0)
    _handlePong(peer, t0, t0 + 5000)
    expect(_isPeerDegraded(peer, t0 + 5000 + 1000)).toBe(false)
  })

  it('peer com ping exatamente 30s atrás → não degraded (boundary)', () => {
    const t0 = 1_000_000
    const peer = _createPeerStateForTest('peer-30s', t0)
    _markPing(peer, t0)
    _handlePong(peer, t0, t0 + 50)
    expect(_isPeerDegraded(peer, t0 + 30_000)).toBe(false)
  })
})

describe('parseTurnServers (_parseTurnServers)', () => {
  it('string vazia → []', () => {
    expect(_parseTurnServers('')).toEqual([])
  })

  it('1 server simples (turn:host:port sem auth) → [{ urls }]', () => {
    const out = _parseTurnServers('turn:turn.example.com:3478')
    expect(out.length).toBe(1)
    const s = out[0]!
    expect(s.urls).toBe('turn:turn.example.com:3478')
    expect(s.username).toBeUndefined()
    expect(s.credential).toBeUndefined()
  })

  it('com username + credential → preserva ambos', () => {
    const out = _parseTurnServers(
      'turn:turn.example.com:3478?username=foo&credential=bar',
    )
    expect(out.length).toBe(1)
    const s = out[0]!
    expect(s.urls).toBe('turn:turn.example.com:3478')
    expect(s.username).toBe('foo')
    expect(s.credential).toBe('bar')
  })

  it('múltiplos servers separados por vírgula', () => {
    const out = _parseTurnServers(
      'turn:a.example.com:3478,turn:b.example.com:3478?username=u&credential=c',
    )
    expect(out.length).toBe(2)
    expect(out[0]!.urls).toBe('turn:a.example.com:3478')
    expect(out[0]!.username).toBeUndefined()
    expect(out[1]!.urls).toBe('turn:b.example.com:3478')
    expect(out[1]!.username).toBe('u')
    expect(out[1]!.credential).toBe('c')
  })

  it('formato totalmente inválido → ignora silenciosamente', () => {
    const out = _parseTurnServers('not-a-turn-url')
    // Política contratual: ignora silenciosamente. Resultado pode ser []
    // ou filtrar só o item inválido — aceitamos array vazio.
    expect(Array.isArray(out)).toBe(true)
    expect(out.length).toBe(0)
  })

  it('mistura válido + inválido → mantém só o válido', () => {
    const out = _parseTurnServers(
      'not-a-turn-url,turn:good.example.com:3478',
    )
    expect(out.length).toBe(1)
    expect(out[0]!.urls).toBe('turn:good.example.com:3478')
  })

  it('string só com vírgula / só whitespace → []', () => {
    expect(_parseTurnServers(',').length).toBe(0)
    // Trim safety — implementação pode aceitar input com whitespace ou não.
    // Contrato diz "separados por vírgula sem espaço", então só validamos vazio.
  })
})
