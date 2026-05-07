/**
 * Identity backup — JSON file format pra export/import de identidade
 * Drift (Track C.3, manifesto §3 — identidade portável).
 *
 * Formato simples, plain text, sem cifragem (MVP). Usuário é
 * responsável por guardar o arquivo em local seguro — mesma
 * semântica que escrever a nsec1 num pedaço de papel ou colar num
 * password manager.
 *
 * Por que JSON em vez de só `nsec1...` puro:
 *   - Inclui metadata útil (npub público, data de criação, versão do
 *     app que gerou) — facilita debug e rastreabilidade.
 *   - Estrutura validável — `parseBackup` rejeita arquivo malformado
 *     antes de tentar setIdentityFromNsec, dando erro mais claro que
 *     "decode bech32 falhou".
 *   - Forward-compat: campo `version` permite evolução do formato
 *     (v2 com cifra password-based opcional, p.ex.).
 *
 * Wire format v1:
 *   {
 *     "format": "drift-identity-backup",
 *     "version": 1,
 *     "createdAt": "2026-05-07T03:14:15.926Z",
 *     "appVersion": "0.6.0-alpha.5",
 *     "npub": "npub1...",
 *     "nsec": "nsec1..."
 *   }
 *
 * **NÃO** cifrado. **NÃO** envia pra server nenhum. **NÃO** deve ser
 * commitado em git. Manifesto §3 — usuário detém a chave; cliente só
 * facilita o trânsito.
 *
 * Pure functions — sem side effects. UI invoca via download blob /
 * file picker. Testes Vitest (Node) cobrem build + parse + validação.
 */

export const BACKUP_FORMAT = 'drift-identity-backup'
export const BACKUP_VERSION = 1

export interface IdentityBackup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  /** ISO 8601 UTC, ex.: "2026-05-07T03:14:15.926Z". */
  createdAt: string
  /** Versão do cliente que gerou (do package.json). */
  appVersion: string
  /** npub bech32 público — redundante (derivável de nsec) mas útil pra
   *  validação cruzada e display antes de importar. */
  npub: string
  /** nsec1 bech32 privado — A CHAVE. Trate este arquivo como segredo. */
  nsec: string
}

/**
 * Constrói um objeto de backup a partir da identidade ativa.
 *
 * @param input identidade pronta (npub + nsec bech32) + appVersion
 * @param now data atual (passar explicit pra testes determinísticos)
 */
export function buildBackup(
  input: { npub: string; nsec: string; appVersion: string },
  now: Date = new Date(),
): IdentityBackup {
  if (!input.npub.startsWith('npub1')) {
    throw new Error('npub inválida — deve começar com npub1')
  }
  if (!input.nsec.startsWith('nsec1')) {
    throw new Error('nsec inválida — deve começar com nsec1')
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    appVersion: input.appVersion,
    npub: input.npub,
    nsec: input.nsec,
  }
}

/**
 * Serializa pra string JSON pretty-print (2 espaços) — facilita
 * inspeção visual antes de salvar. Newline final pra unix-friendly.
 */
export function serializeBackup(backup: IdentityBackup): string {
  return JSON.stringify(backup, null, 2) + '\n'
}

export class BackupParseError extends Error {
  constructor(
    message: string,
    public readonly cause:
      | 'invalid-json'
      | 'wrong-format'
      | 'wrong-version'
      | 'missing-fields'
      | 'malformed-keys',
  ) {
    super(message)
    this.name = 'BackupParseError'
  }
}

/**
 * Parseia uma string JSON e valida shape de backup. Retorna o
 * `IdentityBackup` se válido; throw `BackupParseError` com causa
 * específica se inválido.
 *
 * Validações:
 *   1. JSON parse OK
 *   2. `format === BACKUP_FORMAT`
 *   3. `version === BACKUP_VERSION` (futuro: aceitar versões anteriores
 *      conhecidas e migrar)
 *   4. Campos obrigatórios presentes e tipos corretos
 *   5. npub começa com `npub1`, nsec começa com `nsec1`
 *
 * **NÃO** valida cripto da nsec — `setIdentityFromNsec` faz isso.
 * Aqui é só sanity check de shape.
 */
export function parseBackup(text: string): IdentityBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new BackupParseError(
      `JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
      'invalid-json',
    )
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    // Arrays e null são `typeof 'object'` mas não são o shape que esperamos.
    throw new BackupParseError('arquivo não é objeto JSON', 'invalid-json')
  }

  const obj = raw as Record<string, unknown>

  if (obj.format !== BACKUP_FORMAT) {
    throw new BackupParseError(
      `formato desconhecido: esperado "${BACKUP_FORMAT}", encontrado "${String(obj.format)}"`,
      'wrong-format',
    )
  }

  if (obj.version !== BACKUP_VERSION) {
    throw new BackupParseError(
      `versão de backup ${String(obj.version)} não suportada (esperado ${BACKUP_VERSION})`,
      'wrong-version',
    )
  }

  for (const field of ['createdAt', 'appVersion', 'npub', 'nsec'] as const) {
    if (typeof obj[field] !== 'string' || !obj[field]) {
      throw new BackupParseError(
        `campo obrigatório ausente ou inválido: ${field}`,
        'missing-fields',
      )
    }
  }

  const npub = obj.npub as string
  const nsec = obj.nsec as string

  if (!npub.startsWith('npub1')) {
    throw new BackupParseError('npub deve começar com npub1', 'malformed-keys')
  }
  if (!nsec.startsWith('nsec1')) {
    throw new BackupParseError('nsec deve começar com nsec1', 'malformed-keys')
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: obj.createdAt as string,
    appVersion: obj.appVersion as string,
    npub,
    nsec,
  }
}

/**
 * Sugere um filename pra o download. Inclui prefixo do npub + data —
 * facilita user identificar o arquivo entre múltiplos backups (ex.:
 * uma identidade pública + uma anônima).
 *
 * Ex.: `drift-backup-npub1xdaff-2026-05-07.json`
 */
export function suggestBackupFilename(npub: string, now: Date = new Date()): string {
  const npubPrefix = npub.slice(0, 10) // npub1xxxxxx
  const date = now.toISOString().slice(0, 10) // YYYY-MM-DD
  return `drift-backup-${npubPrefix}-${date}.json`
}
