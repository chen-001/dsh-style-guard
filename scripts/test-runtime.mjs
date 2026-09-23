// Use the running host's Cordis module to exercise its injection checks:
// node scripts/test-runtime.mjs /path/to/@deepseek-ai/cordis/lib/index.js
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import * as plugin from '../lib/index.js'

const { Context } = await import(pathToFileURL(process.argv[2]).href)
const ctx = new Context()
const root = {}
let current = root
let registryReads = 0
// Services must live in a sibling plugin. Root-owned services can mask missing inject.
const services = ctx.plugin({
  name: 'style-guard-test-services',
  apply(ctx) {
    ctx.provide('llm', { stream() { throw new Error('No model call expected') } })
    ctx.provide('agents', {
      currentInitiator() { registryReads++; return current },
      roots() { return [root] },
    })
  },
})
const fork = ctx.plugin(plugin, {})
await new Promise(resolve => setImmediate(resolve))
assert.equal(fork.state, 2, 'plugin must be active')
const chunks = [{ type: 'text-delta', index: 0, text: 'OK' }, { type: 'finish', reason: { kind: 'stop' } }]
// 模型名字里要带 deepseek，否则插件按设置跳过
const options = Object.freeze({ provider: 'test', model: 'deepseek-v4.1-flash', messages: [] })
const source = () => (async function* () { yield* chunks })()

try {
  const guarded = ctx.waterfall('llm/stream', options, source)
  assert.deepEqual(await Array.fromAsync(guarded), chunks)
  assert.ok(registryReads > 0, 'root-agent check must execute through Cordis')

  current = {}
  const childStream = source()
  assert.equal(ctx.waterfall('llm/stream', options, () => childStream), childStream)

  const titleStream = source()
  assert.equal(ctx.waterfall('llm/stream', { ...options, purpose: 'title' }, () => titleStream), titleStream)

  // 名字里缺一个词就整条放过去，连 agents 都不用查
  const beforeOthers = registryReads
  for (const model of ['gpt-4o', 'deepseek-v4.1', 'claude-4.6-flash']) {
    const otherStream = source()
    const otherOptions = Object.freeze({ provider: 'test', model, messages: [] })
    assert.equal(ctx.waterfall('llm/stream', otherOptions, () => otherStream), otherStream, model + ' must pass through')
  }
  assert.equal(registryReads, beforeOthers, 'unmatched models must not even reach the agent check')
  console.log('PASS: root reply, child bypass, auxiliary-call bypass, other-model bypass under host injection checks')
} finally {
  await fork.dispose()
  await services.dispose()
}
