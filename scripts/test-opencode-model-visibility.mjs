import assert from 'node:assert/strict'
import { shownOpenCodeModelIds, visibleOpenCodeModels } from '../server/opencode-model-visibility.mjs'

const user = [
  { providerID: 'nvidia', modelID: 'shared', visibility: 'show' },
  { providerID: 'openrouter', modelID: 'shared', visibility: 'hide' },
  { providerID: 'openrouter', modelID: 'vendor/model', visibility: 'show' },
  { providerID: 'opencode', modelID: 'hidden', visibility: 'hide' },
]
const models = [
  { id: 'nvidia/shared', providerID: 'nvidia' },
  { id: 'openrouter/shared', providerID: 'openrouter' },
  { id: 'openrouter/vendor/model', providerID: 'openrouter' },
  { id: 'opencode/hidden', providerID: 'opencode' },
  { id: 'opencode/unconfigured', providerID: 'opencode' },
]
const expected = ['nvidia/shared', 'openrouter/vendor/model']
const raw = JSON.stringify({ model: JSON.stringify({ user, recent: [{ providerID: 'opencode', modelID: 'hidden' }] }), server: 'not consulted' })
assert.deepEqual([...shownOpenCodeModelIds(raw)], expected)
assert.deepEqual([...shownOpenCodeModelIds({ model: { user } })], expected)
const visible = await visibleOpenCodeModels(models, { read: async () => raw })
assert.deepEqual(visible.map(model => model.id), expected)
assert.equal(models.length, 5, 'must not mutate the full catalog used elsewhere')
assert.deepEqual(await visibleOpenCodeModels(models, { read: async () => JSON.stringify({ model: { user: [] } }) }), [], 'showing none must not show everything')
for (const source of ['{invalid', '{}', '{"model":"bad json"}']) {
  await assert.rejects(visibleOpenCodeModels(models, { read: async () => source }), error => error.status === 503)
}
await assert.rejects(visibleOpenCodeModels(models, { read: async () => { throw new Error('missing file') } }), error => error.status === 503)
assert.deepEqual([...shownOpenCodeModelIds({ model: { user: [...user, { providerID: 'nvidia', modelID: 'shared', visibility: 'hide' }] } })], ['openrouter/vendor/model'])
console.log('Passed: explicit shown-only models, provider identity, nested model IDs, string/object Desktop state, no recent/full-catalog fallback, empty selection, malformed/missing preferences, immutable catalog and latest visibility override. Synthetic reads only.')
