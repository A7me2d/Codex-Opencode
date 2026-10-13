import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { projectPreviewFiles } from '../server/project-preview.mjs'

const parent = path.resolve(os.tmpdir()), root = await mkdtemp(path.join(parent, 'openzero-preview-test-'))
try {
  for (const dir of ['src', 'node_modules', 'dist', '.hidden']) await mkdir(path.join(root, dir))
  for (const name of ['src/main.ts', 'README.md', 'node_modules/generated.ts', 'dist/output.js', '.hidden/a.ts', '.env', 'tokens.ts', 'credentials.yml', 'photo.png']) await writeFile(path.join(root, name), 'fixture')
  await writeFile(path.join(root, 'large.ts'), 'x'.repeat(512 * 1024 + 1))
  const result = await projectPreviewFiles(root)
  assert.deepEqual(result.files.sort(), ['README.md', 'src/main.ts'])
  assert.equal((await projectPreviewFiles(root, { maxResults: 1 })).files.length, 1)
  assert.equal((await projectPreviewFiles(root, { maxEntries: 0 })).files.length, 0)
  console.log('Passed: source discovery, generated/hidden/sensitive/oversized exclusions and scan bounds. Only temporary fixtures were used.')
} finally {
  if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith('openzero-preview-test-')) throw new Error('Unsafe fixture cleanup path')
  await rm(root, { recursive: true, force: true })
}
