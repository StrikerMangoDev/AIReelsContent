import { setTimeout } from 'node:timers/promises'
export async function retry(operation, { attempts = 3, shouldRetry = () => true } = {}) {
  for (let index = 0; index < attempts; index++) {
    try { return await operation() }
    catch (error) {
      if (index === attempts - 1 || !shouldRetry(error)) throw error
      await setTimeout(500 * 2 ** index + Math.random() * 250)
    }
  }
}
