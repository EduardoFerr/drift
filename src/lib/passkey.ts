/**
 * Passkey opt-in — WebAuthn como gate de autenticação local.
 *
 * Manifesto §4 (Anonimato por Design — sub-feature de Fase 5).
 *
 * **O que faz:**
 *   - User registra um Passkey (biometria, security key, hardware token)
 *     que fica vinculado ao device.
 *   - Após registrar, ao reabrir o app, cliente pede pra validar o
 *     Passkey antes de liberar a master key (que descriptografa o nsec).
 *   - Se passkey falha/cancela, app não consegue acessar identidade
 *     ativa — user vê tela de erro com opção de remover passkey
 *     (precisa do nsec1 backup pra recuperar).
 *
 * **O que NÃO faz:**
 *   - Não é identidade. nsec continua sendo identidade. Passkey só é
 *     unlock local — outro device ou cliente Nostr usa o nsec direto.
 *   - Não vincula sua identidade a hardware. nsec exportado em outro
 *     device funciona normalmente, sem passkey nenhum.
 *   - Não substitui backup do nsec. Perdeu o device + nunca exportou
 *     o nsec1 = perdeu identidade.
 *
 * **Trade-off:** Passkey opt-in adiciona barreira contra acesso casual
 * por outra pessoa que pega o device desbloqueado. Não protege contra
 * adversário com tempo + acesso ao device (pode dump do IndexedDB).
 *
 * **Persistência do estado de habilitação:** `user_prefs.passkey_id` —
 * armazena o credential ID do passkey registrado. Vazio/null = passkey
 * desabilitado.
 *
 * Manifesto §28: tudo local, nada vai pra rede.
 */

import { db } from './db'

const RP_NAME = 'Drift'
const RP_ID = window.location.hostname
const PASSKEY_PREF_KEY = 'passkey_id'

// ─── Disponibilidade ─────────────────────────────────────────────────

/**
 * Indica se WebAuthn está disponível no browser atual. Retorna `false`
 * em contextos não-secure ou browsers muito antigos (IE, Safari < 14).
 */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator?.credentials?.create === 'function' &&
    typeof navigator?.credentials?.get === 'function'
  )
}

// ─── Estado persistido ───────────────────────────────────────────────

interface PasskeyState {
  credentialId: string // base64url
}

async function loadState(): Promise<PasskeyState | null> {
  const row = await db.get<{ value: string }>(
    `SELECT value FROM user_prefs WHERE key = ?`,
    [PASSKEY_PREF_KEY],
  )
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as PasskeyState
  } catch {
    return null
  }
}

async function saveState(state: PasskeyState): Promise<void> {
  await db.run(
    `INSERT INTO user_prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [PASSKEY_PREF_KEY, JSON.stringify(state)],
  )
}

async function clearState(): Promise<void> {
  await db.run(`DELETE FROM user_prefs WHERE key = ?`, [PASSKEY_PREF_KEY])
}

export async function isPasskeyEnabled(): Promise<boolean> {
  const state = await loadState()
  return state !== null
}

// ─── Registro / unregister ───────────────────────────────────────────

/**
 * Registra um Passkey — chama o prompt nativo do browser/OS pra
 * biometria ou security key. User confirma; credentialId é salvo
 * localmente.
 *
 * Idempotente: se já existe passkey, retorna o existente sem reregistrar.
 *
 * @returns credentialId em base64url (informativo — UI mostra hash truncado)
 * @throws Se WebAuthn não suportado, ou user cancelar, ou erro WebAuthn.
 */
export async function enablePasskey(npubHex: string): Promise<string> {
  if (!isPasskeySupported()) {
    throw new Error('WebAuthn não suportado neste browser')
  }
  const existing = await loadState()
  if (existing) return existing.credentialId

  // user.id é hash do npub — não-correlatable mas estável pro mesmo user
  const userIdBytes = await sha256Bytes(npubHex)
  const challenge = crypto.getRandomValues(new Uint8Array(32))

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: RP_NAME, id: RP_ID },
      user: {
        id: userIdBytes,
        name: `drift-${npubHex.slice(0, 8)}`,
        displayName: 'Drift identity',
      },
      challenge,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Registro de Passkey cancelado')
  }

  const credentialId = bufferToBase64Url(credential.rawId)
  await saveState({ credentialId })
  return credentialId
}

/**
 * Verifica o Passkey: pede ao user pra autenticar (biometria, etc.).
 * Sucesso = libera o app. Falha = throw.
 *
 * Chamado em `bootstrap.ts` após initDb se passkey está habilitado.
 */
export async function verifyPasskey(): Promise<void> {
  const state = await loadState()
  if (!state) {
    throw new Error('Passkey não está habilitado — não há nada pra verificar')
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: base64UrlToBuffer(state.credentialId),
          type: 'public-key',
        },
      ],
      userVerification: 'required',
      timeout: 60_000,
      rpId: RP_ID,
    },
  })

  if (!credential) {
    throw new Error('Verificação de Passkey falhou ou foi cancelada')
  }
  // Validamos só que o user passou no prompt nativo. Não validamos a
  // assinatura criptograficamente porque não temos backend — não há
  // nada pra validar contra. O gate é o prompt do OS, não cripto-prova.
}

/**
 * Remove o passkey. Idempotente.
 *
 * Atenção: NÃO remove o credential armazenado no autenticador (touch
 * id/yubikey/etc.). User precisa fazer isso manualmente nas settings
 * do OS se quiser limpeza completa.
 */
export async function disablePasskey(): Promise<void> {
  await clearState()
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function sha256Bytes(hex: string): Promise<Uint8Array<ArrayBuffer>> {
  const data = new TextEncoder().encode(hex)
  const digest = await crypto.subtle.digest('SHA-256', data)
  // Garante ArrayBuffer (não SharedArrayBuffer) — WebAuthn requer.
  const buf = new ArrayBuffer(digest.byteLength)
  new Uint8Array(buf).set(new Uint8Array(digest))
  return new Uint8Array(buf)
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
