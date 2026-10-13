import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Decimal rollover for the two trailing version components, starting at 1.0.1. */
export function releaseVersion(runNumber) {
  if (!/^[0-9]+$/.test(String(runNumber))) throw new Error('Release run number must be a positive integer.')
  const counter = Number(runNumber)
  if (!Number.isSafeInteger(counter) || counter < 1) throw new Error('Release run number must be a positive safe integer.')
  return `${1 + Math.floor(counter / 100)}.${Math.floor(counter % 100 / 10)}.${counter % 10}`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(releaseVersion(process.argv[2])) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
