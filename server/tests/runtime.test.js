import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('Firebase JWKS resolves RSA keys without CommonJS require(esm) support', () => {
  const script = `
    const jwks = require('jwks-rsa');
    const { generateKeyPairSync } = require('node:crypto');
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fixture = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', use: 'sig', alg: 'RS256' };
    const client = jwks({ jwksUri: 'https://unused.invalid', getKeysInterceptor: async () => [fixture] });
    client.getSigningKey('fixture').then(key => {
      if (!key.getPublicKey().includes('PUBLIC KEY')) throw new Error('Key export failed');
      console.log('JWKS_OK');
    }).catch(() => { process.exitCode = 1 });
  `
  const output = execFileSync(process.execPath, ['--no-experimental-require-module', '-e', script], { encoding: 'utf8', timeout: 15000 })
  assert.match(output, /JWKS_OK/)
})
