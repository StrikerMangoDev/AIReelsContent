import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { env } from '../config/env.js'

const maxBytes = 32 * 1024 * 1024
const validId = /^[a-f0-9-]{36}$/
const directory = resolve('server/data/media')
function storageUrl(id) {
  return `${env.SUPABASE_URL}/storage/v1/object/${encodeURIComponent(process.env.STUDIO_MEDIA_BUCKET)}/${id}`
}
function headers() { return { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } }
export async function saveMediaFile(id, bytes, mime) {
  if (!validId.test(id) || !bytes.length || bytes.length > maxBytes) throw new Error('Media exceeds 32 MB storage limit')
  if (env.STORAGE_PROVIDER === 'supabase') {
    const response = await fetch(storageUrl(id), { method: 'POST', headers: { ...headers(), 'Content-Type': mime, 'x-upsert': 'true' }, body: bytes, signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error('Media storage unavailable')
  } else {
    await mkdir(directory, { recursive: true })
    await writeFile(resolve(directory, id), bytes)
  }
}
export async function readMediaFile(id) {
  if (!validId.test(id)) throw new Error('Invalid asset identifier')
  if (env.STORAGE_PROVIDER !== 'supabase') return readFile(resolve(directory, id))
  const response = await fetch(storageUrl(id), { headers: headers(), signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error('Media storage unavailable')
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Media too large')
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > maxBytes) throw new Error('Media too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function signedMediaUrl(id) {
  if (env.STORAGE_PROVIDER !== 'supabase') return null
  if (!validId.test(id)) throw new Error('Invalid asset identifier')
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(process.env.STUDIO_MEDIA_BUCKET)}/${id}`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }), signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('Media storage unavailable')
  const result = await response.json()
  if (typeof result.signedURL !== 'string' || !result.signedURL.startsWith('/object/sign/')) throw new Error('Invalid signed asset URL')
  return `${env.SUPABASE_URL}/storage/v1${result.signedURL}`
}
