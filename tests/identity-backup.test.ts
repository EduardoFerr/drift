/**
 * Track C.3 — testes das funções puras de identity-backup.
 */

import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupParseError,
  buildBackup,
  parseBackup,
  serializeBackup,
  suggestBackupFilename,
} from '../src/lib/identity-backup'

const SAMPLE_NPUB = 'npub1xdaffcxlggd9s9anmlfrn8kcmu4gq5umpjkrrzucym3vcpc2m4ws0v34'
const SAMPLE_NSEC = 'nsec1abc123def456789012345678901234567890123456789012345678901234'
const FIXED_NOW = new Date('2026-05-07T03:14:15.926Z')

describe('buildBackup', () => {
  it('monta backup completo com timestamp', () => {
    const backup = buildBackup(
      { npub: SAMPLE_NPUB, nsec: SAMPLE_NSEC, appVersion: '0.6.0-alpha.5' },
      FIXED_NOW,
    )
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.createdAt).toBe('2026-05-07T03:14:15.926Z')
    expect(backup.appVersion).toBe('0.6.0-alpha.5')
    expect(backup.npub).toBe(SAMPLE_NPUB)
    expect(backup.nsec).toBe(SAMPLE_NSEC)
  })

  it('rejeita npub que não começa com npub1', () => {
    expect(() =>
      buildBackup(
        { npub: 'pub1invalid', nsec: SAMPLE_NSEC, appVersion: '0.6.0' },
        FIXED_NOW,
      ),
    ).toThrow(/npub inválida/)
  })

  it('rejeita nsec que não começa com nsec1', () => {
    expect(() =>
      buildBackup(
        { npub: SAMPLE_NPUB, nsec: 'sec1invalid', appVersion: '0.6.0' },
        FIXED_NOW,
      ),
    ).toThrow(/nsec inválida/)
  })
})

describe('serializeBackup', () => {
  it('produz JSON pretty-print com newline final', () => {
    const backup = buildBackup(
      { npub: SAMPLE_NPUB, nsec: SAMPLE_NSEC, appVersion: '0.6.0' },
      FIXED_NOW,
    )
    const text = serializeBackup(backup)
    expect(text).toContain('"format": "drift-identity-backup"')
    expect(text).toContain('"version": 1')
    expect(text.endsWith('\n')).toBe(true)
    // Pretty-print usa 2 espaços de indent
    expect(text).toContain('\n  "format"')
  })
})

describe('parseBackup', () => {
  it('round-trip: build → serialize → parse preserva campos', () => {
    const backup = buildBackup(
      { npub: SAMPLE_NPUB, nsec: SAMPLE_NSEC, appVersion: '0.6.0' },
      FIXED_NOW,
    )
    const text = serializeBackup(backup)
    const parsed = parseBackup(text)
    expect(parsed).toEqual(backup)
  })

  it('aceita JSON sem newline final', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.6.0',
      npub: SAMPLE_NPUB,
      nsec: SAMPLE_NSEC,
    })
    expect(() => parseBackup(text)).not.toThrow()
  })

  it('rejeita JSON malformado', () => {
    expect(() => parseBackup('not json {')).toThrow(BackupParseError)
    try {
      parseBackup('not json {')
    } catch (err) {
      expect(err).toBeInstanceOf(BackupParseError)
      expect((err as BackupParseError).cause).toBe('invalid-json')
    }
  })

  it('rejeita formato errado (algum outro JSON)', () => {
    const text = JSON.stringify({ format: 'not-drift-backup', version: 1 })
    expect(() => parseBackup(text)).toThrow(/formato desconhecido/)
    try {
      parseBackup(text)
    } catch (err) {
      expect((err as BackupParseError).cause).toBe('wrong-format')
    }
  })

  it('rejeita versão futura desconhecida', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 999,
      createdAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.6.0',
      npub: SAMPLE_NPUB,
      nsec: SAMPLE_NSEC,
    })
    expect(() => parseBackup(text)).toThrow(/versão de backup 999/)
    try {
      parseBackup(text)
    } catch (err) {
      expect((err as BackupParseError).cause).toBe('wrong-version')
    }
  })

  it('rejeita campo obrigatório ausente', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.6.0',
      npub: SAMPLE_NPUB,
      // nsec ausente
    })
    expect(() => parseBackup(text)).toThrow(/nsec/)
    try {
      parseBackup(text)
    } catch (err) {
      expect((err as BackupParseError).cause).toBe('missing-fields')
    }
  })

  it('rejeita npub malformada', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.6.0',
      npub: 'wrongprefix1xxxxx',
      nsec: SAMPLE_NSEC,
    })
    expect(() => parseBackup(text)).toThrow(/npub deve começar/)
    try {
      parseBackup(text)
    } catch (err) {
      expect((err as BackupParseError).cause).toBe('malformed-keys')
    }
  })

  it('rejeita não-objeto (array, primitivo)', () => {
    expect(() => parseBackup('[]')).toThrow(/não é objeto/)
    expect(() => parseBackup('"string"')).toThrow(/não é objeto/)
    expect(() => parseBackup('null')).toThrow(/não é objeto/)
  })
})

describe('suggestBackupFilename', () => {
  it('inclui prefixo do npub e data ISO', () => {
    const name = suggestBackupFilename(SAMPLE_NPUB, FIXED_NOW)
    expect(name).toBe('drift-backup-npub1xdaff-2026-05-07.json')
  })

  it('formato consistente entre identidades', () => {
    const a = suggestBackupFilename('npub1aaaaa1234567890abcdef', FIXED_NOW)
    const b = suggestBackupFilename('npub1bbbbb1234567890abcdef', FIXED_NOW)
    expect(a).toMatch(/^drift-backup-npub1[a-z0-9]+-\d{4}-\d{2}-\d{2}\.json$/)
    expect(b).toMatch(/^drift-backup-npub1[a-z0-9]+-\d{4}-\d{2}-\d{2}\.json$/)
    expect(a).not.toBe(b)
  })
})
