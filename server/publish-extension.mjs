import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export const installationMarker = '.openzero-installing'
const transientCodes = new Set(['EPERM', 'EACCES', 'EBUSY'])

export async function retryFileOperation(operation, { sleep = delay, retries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() }
    catch (error) {
      if (!transientCodes.has(error.code) || attempt >= retries) throw error
      await sleep(Math.min(100 * 2 ** attempt, 1000))
    }
  }
}

/** A locked directory can still allow file copies. Never expose a partial package. */
export async function publishExtension(staging, destination, {
  extensionDirectory, move = rename, copy = cp, makeDirectory = mkdir, read = readFile, write = writeFile, remove = rm, sleep = delay,
} = {}) {
  if (!extensionDirectory || path.dirname(path.resolve(destination)) !== path.resolve(extensionDirectory)) throw new Error('Invalid extension publication directory.')
  const retry = operation => retryFileOperation(operation, { sleep })
  try { await retry(() => move(staging, destination)); return }
  catch (error) { if (!transientCodes.has(error.code) && error.code !== 'EXDEV') throw error }
  // Exclusive creation means rollback can only remove the directory created here.
  await makeDirectory(destination)
  let published = false
  try {
    const marker = path.join(destination, installationMarker)
    await write(marker, '')
    const manifest = path.resolve(staging, 'package.json')
    await retry(() => copy(staging, destination, { recursive: true, force: true,
      filter: source => path.resolve(source) !== manifest }))
    // The scanner ignores the marker; manifest publication alone does not reveal the package.
    const readFileContent = await read(manifest)
    await retry(() => write(path.join(destination, 'package.json'), readFileContent))
    await retry(() => remove(marker, { force: true }))
    published = true
  } finally {
    if (!published) {
      const absolute = path.resolve(destination)
      if (path.dirname(absolute) === path.resolve(extensionDirectory)) {
        await remove(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
      }
    }
  }
}
