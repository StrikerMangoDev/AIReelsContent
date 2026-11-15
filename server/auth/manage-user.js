import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { z } from 'zod'
import { env } from '../config/env.js'
import { createSupabaseRepository } from '../storage/supabase.js'
import { createRepository } from '../storage/repository.js'
import { hashPassword } from './password.js'

const [action, uid, email, name, role, output] = process.argv.slice(2)
if (!['provision','revoke'].includes(action) || !uid) throw new Error('Usage: node server/auth/manage-user.js provision <existing-uid|new> <email> <name> <user|admin> <private-output-file> OR revoke <uid>')
const repository = env.STORAGE_PROVIDER === 'supabase' ? createSupabaseRepository(env) : createRepository(env.DATABASE_PATH)
try {
  if (action === 'revoke') await repository.authRevoke(uid)
  else {
    const account = z.object({ uid: z.string().min(1).max(128), email: z.email().transform(value => value.trim().toLowerCase()), name: z.string().min(1).max(120), role: z.enum(['user','admin']) }).parse({ uid: uid === 'new' ? randomUUID() : uid, email, name, role })
    if (!output) throw new Error('A private output file is required; credentials are never printed.')
    const password = randomBytes(24).toString('base64url')
    const passwordHash = await hashPassword(password)
    writeFileSync(output, '', { flag: 'wx', mode: 0o600 })
    if (process.platform === 'win32') execFileSync('icacls', [output, '/inheritance:r', '/grant:r', `${userInfo().username}:(F)`], { windowsHide: true, stdio: 'pipe' })
    writeFileSync(output, JSON.stringify({ ...account, password }, null, 2))
    await repository.authProvision({ ...account, passwordHash })
  }
  console.log('Account operation completed. Existing content ownership is unchanged.')
} finally { repository.close() }
