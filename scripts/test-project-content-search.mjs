import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { searchProjectContents } from '../server/project-content-search.mjs'

// Search only temporary fixtures. No real project files, shells or user data.
const fixture = await mkdtemp(path.join(tmpdir(), 'openzero-search-'))
const root = path.join(fixture, 'project')
try {
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'example.ts'), 'class MyClass {}\r\nconst value = new MyClass(); // MYCLASS\r\nconst literal = "a.b[0]";\r\nconst other = "🙂 MyClass";')
  await writeFile(path.join(root, 'src', 'arabic.ts'), 'const كلاس = 1;')
  await writeFile(path.join(root, 'bom.ts'), '\ufeffclass MyClass {}')
  for (const directory of ['node_modules', '.git', 'dist', '.relay-state']) {
    await mkdir(path.join(root, directory), { recursive: true })
    await writeFile(path.join(root, directory, 'ignored.ts'), 'MyClass')
  }
  await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 77, 121, 67, 108, 97, 115, 115]))
  await writeFile(path.join(root, 'invalid.txt'), Buffer.from([255, 254, 99]))
  await writeFile(path.join(root, 'large.txt'), 'MyClass'.repeat(100))
  await writeFile(path.join(fixture, 'outside.ts'), 'MyClass')
  let linked = false
  try { await symlink(path.join(fixture, 'outside.ts'), path.join(root, 'outside-link.ts')); linked = true } catch { /* Windows may disallow symlink creation. */ }
  const result = await searchProjectContents(root, 'myclass', { maxFileBytes: 256 })
  assert.equal(result.matches.length, 5)
  assert.equal(result.skippedFiles, 3)
  assert.equal(result.truncated, false)
  assert.equal(result.matches.every(match => ['src/example.ts', 'bom.ts'].includes(match.path)), true, 'generated folders, binary files and external links are excluded')
  const matches = result.matches.filter(match => match.path === 'src/example.ts')
  assert.deepEqual(matches.map(({ line, column }) => [line, column]), [[1, 7], [2, 19], [2, 33], [4, 19]])
  assert.equal(result.matches.find(match => match.path === 'bom.ts').column, 8, 'BOM remains part of editor offsets')
  for (const match of result.matches) assert.equal(match.text.slice(match.matchStart, match.matchStart + match.matchLength).toLowerCase(), 'myclass')
  assert.equal((await searchProjectContents(root, 'a.b[0]')).matches.length, 1, 'search is literal, not a regular expression')
  assert.equal((await searchProjectContents(root, 'كلاس')).matches.length, 1)
  const limited = await searchProjectContents(root, 'myclass', { maxResults: 2 })
  assert.equal(limited.matches.length, 2); assert.equal(limited.truncated, true)
  const controller = new AbortController(); controller.abort()
  assert.equal((await searchProjectContents(root, 'myclass', { signal: controller.signal })).matches.length, 0)
  assert.equal((await searchProjectContents(root, 'myclass', { timeoutMs: 0 })).truncated, true)
  await assert.rejects(searchProjectContents(root, 'x\ny'), /single-line/)
  assert.deepEqual(await searchProjectContents(root, ''), { matches: [], truncated: false, skippedFiles: 0 })
  console.log(`Passed: literal content search, exact CRLF/Unicode/BOM locations, binary/large exclusions, limits and cancellation.${linked ? ' External symlink skipped.' : ' Symlink fixture unavailable on this machine.'}`)
} finally {
  const resolved = path.resolve(fixture)
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()))
  assert.equal(path.basename(resolved).startsWith('openzero-search-'), true)
  await rm(resolved, { recursive: true, force: true })
}
