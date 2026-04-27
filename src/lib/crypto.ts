/**
 * Cripto local para o nsec.
 *
 * O dispositivo é a fronteira de confiança. Esta cripto é defesa em
 * profundidade — protege contra exposição casual em logs, dumps de
 * banco e backups, mas não contra atacante com acesso físico ao
 * browser.
 *
 * Master key:
 *   - AES-GCM 256
 *   - gerada uma vez no primeiro uso
 *   - armazenada em IndexedDB como CryptoKey não-exportável
 *   - separada do OPFS (SQLite WASM nunca vê a chave)
 */

const KEY_DB_NAME = 'drift-keys'
const KEY_STORE = 'keys'
const MASTER_KEY_NAME = 'drift-master-key'
const KEY_DB_VERSION = 1

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(KEY_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getOrCreateMasterKey(): Promise<CryptoKey> {
  const idb = await openKeyDb()

  const existing = await new Promise<CryptoKey | null>((resolve, reject) => {
    const tx = idb.transaction(KEY_STORE, 'readonly')
    const req = tx.objectStore(KEY_STORE).get(MASTER_KEY_NAME)
    req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })

  if (existing) return existing

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // não exportável
    ['encrypt', 'decrypt'],
  )

  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(KEY_STORE, 'readwrite')
    tx.objectStore(KEY_STORE).put(key, MASTER_KEY_NAME)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  return key
}

/**
 * Apaga a master key do IndexedDB. Próxima chamada a encrypt/decrypt
 * vai gerar uma chave nova.
 *
 * Use APENAS quando explicitamente for resetar a identidade — todo
 * ciphertext encriptado com a chave anterior fica indecifrável depois
 * disso.
 */
export async function resetMasterKey(): Promise<void> {
  const idb = await openKeyDb()
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(KEY_STORE, 'readwrite')
    tx.objectStore(KEY_STORE).delete(MASTER_KEY_NAME)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getOrCreateMasterKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)

  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return bytesToBase64(combined)
}

export async function decrypt(b64: string): Promise<string> {
  const key = await getOrCreateMasterKey()
  const combined = base64ToBytes(b64)
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}
