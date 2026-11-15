import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const format = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/
const dummy = `scrypt$32768$8$3$${'0'.repeat(32)}$${'0'.repeat(128)}`

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Use a password of 12 to 256 characters.')
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt, 64, options)
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`
}

export async function verifyPassword(password, encoded) {
  const match = format.exec(encoded || '')
  const [, salt, expected] = match || format.exec(dummy)
  const actual = await derive(password, salt, 64, options)
  return timingSafeEqual(actual, Buffer.from(expected, 'hex')) && Boolean(match)
}
