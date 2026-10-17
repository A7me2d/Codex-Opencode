import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { findClineExecutable, clineCredentials } from '../cline-bridge.mjs'

const accounts = new Set(['cline', 'openrouter', 'anthropic'])
const unavailable = () => Object.assign(new Error('Cline text inference is unavailable. Check the installed Cline SDK and sign in to the selected Cline provider.'), { status: 503 })

/** Load the provider SDK shipped with the installed CLI, without starting an agent. */
export async function loadClineTextSdk(executable = findClineExecutable()) {
  if (!executable) throw unavailable()
  let directory = path.dirname(executable)
  for (let depth = 0; depth < 8; depth++) {
    let manifest
    try { manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) } catch { /* ancestor search */ }
    if (manifest?.name === 'cline') {
      const sdk = await import(pathToFileURL(path.join(directory, 'node_modules', '@cline', 'llms', 'dist', 'index.js')).href)
      if (typeof sdk.createHandlerAsync !== 'function') throw unavailable()
      return sdk
    }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw unavailable()
}

/** Stateless, one-turn provider call. No agent runtime, sessions or tool executors. */
export class MochiClineText {
  constructor({ loadSdk = loadClineTextSdk, credentials = clineCredentials, fetchImpl = fetch, timeoutMs = 28000 } = {}) {
    this.loadSdk = loadSdk; this.credentials = credentials; this.fetch = fetchImpl; this.timeoutMs = timeoutMs
    this.sdk = null
  }
  async ready(provider = 'cline') {
    if (!accounts.has(provider) || !this.credentials(provider)?.key) throw unavailable()
    if (!this.sdk) this.sdk = Promise.resolve().then(() => this.loadSdk()).catch(error => { this.sdk = null; throw error })
    return this.sdk
  }
  async availability(provider = 'cline') {
    try { await this.ready(provider); return { available: true, toolFree: true, stateless: true, dedicatedContext: true, reason: null } }
    catch { return { available: false, toolFree: false, stateless: false, reason: unavailable().message } }
  }
  async generate({ provider = 'cline', model, prompt, maxOutputChars = 8000 }) {
    if (!accounts.has(provider) || typeof model !== 'string' || !model || model.length > 200 || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 40000) throw new Error('Invalid Cline text request.')
    const sdk = await this.ready(provider)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let handler, requests = 0
    try {
      const guardedFetch = async (input, init = {}) => {
        // Exactly one outbound inference request; no SDK retry or tool roundtrip.
        if (++requests !== 1) throw new Error('Cline text inference permits one request only.')
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        if (!body || (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length)) || body.functions !== undefined || (body.tool_choice !== undefined && body.tool_choice !== 'none')) throw new Error('Cline attempted a non-text request.')
        if (controller.signal.aborted) throw new Error('Cline text request stopped.')
        return this.fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal })
      }
      const key = this.credentials(provider)?.key
      if (!key) throw unavailable()
      handler = await sdk.createHandlerAsync({
        providerId: provider, modelId: model, apiKey: key,
        maxOutputTokens: 2048, abortSignal: controller.signal, fetch: guardedFetch,
        modelCatalog: { loadLatestOnInit: false, loadPrivateOnAuth: false },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      })
      let text = '', completed = false, chunks = 0
      const stream = handler.createMessage('Return only the requested JSON decision. You have no tools.', [{ role: 'user', content: [{ type: 'text', text: prompt }] }], [])
      for await (const chunk of stream) {
        if (++chunks > 10000 || controller.signal.aborted) throw new Error('Cline text response limit reached.')
        if (chunk.type === 'tool_calls' || chunk.type === 'media') throw new Error('Cline returned a non-text response.')
        if (chunk.type === 'text') {
          text += chunk.text
          if (text.length > maxOutputChars) throw new Error('Cline text response exceeded its size limit.')
        }
        if (chunk.type === 'done') {
          if (chunk.success !== true || chunk.incompleteReason) throw new Error('Cline did not complete the text response. Check its model, login and quota.')
          completed = true
        }
      }
      if (!completed || !text.trim()) throw new Error('Cline returned no confirmed text response.')
      return { text }
    } catch {
      // Never expose SDK errors, credential-bearing URLs, headers or payloads.
      throw new Error(controller.signal.aborted ? 'Cline text inference timed out; nothing was applied.' : 'Cline text inference failed or returned an unsupported response. Check the selected model, provider login and quota; nothing was applied.')
    } finally {
      clearTimeout(timer)
      controller.abort()
      try { handler?.abort?.() } catch { /* no background turn survives this request */ }
    }
  }
}
