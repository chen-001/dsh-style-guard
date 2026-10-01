// 思考边生成边流出去，正文留在手里等检查和改写。
// 用宿主自己的 Cordis 跑，注入检查与运行时一致。
// node scripts/test-streaming.mjs /path/to/@deepseek-ai/cordis/lib/index.js
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 插件装载时读 ~/.dsh/style-guard/config.json。换一个空 HOME，读不到就落回内置
// 默认值（minChars 500），这条测试不受本机设置影响，短回复也不会真的去调模型。
process.env.HOME = mkdtempSync(join(tmpdir(), 'style-guard-stream-'))
const plugin = await import('../lib/index.js')
const { Context } = await import(pathToFileURL(process.argv[2]).href)

const reasoning = [
  { type: 'block-start', index: 0, blockType: 'reasoning' },
  { type: 'reasoning-delta', index: 0, text: '先想' },
  { type: 'reasoning-delta', index: 0, text: '一下' },
  { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先想一下' } },
]
const body = [
  { type: 'block-start', index: 1, blockType: 'text' },
  { type: 'text-delta', index: 1, text: '短答' },
  { type: 'block-end', index: 1, block: { type: 'text', text: '短答' } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const options = Object.freeze({ provider: 'test', model: 'deepseek-v4.1-flash', messages: [] })

function isReasoning(chunk) {
  return chunk.type === 'reasoning-delta'
    || (chunk.type === 'block-start' && chunk.blockType === 'reasoning')
    || (chunk.type === 'block-end' && chunk.block.type === 'reasoning')
}

async function host() {
  const ctx = new Context()
  const root = {}
  // 服务必须住在兄弟插件里，根上的服务会掩盖漏声明的 inject
  const services = ctx.plugin({
    name: 'style-guard-stream-test-services',
    apply(ctx) {
      ctx.provide('llm', { stream() { throw new Error('No model call expected') } })
      ctx.provide('agents', { currentInitiator() { return root }, roots() { return [root] } })
    },
  })
  const fork = ctx.plugin(plugin, {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fork.state, 2, 'plugin must be active')
  return { ctx, services, fork }
}

// 用例一：模型先想后答。思考要在模型还在生成时就到了页面，正文要整段生成完才到。
{
  const { ctx, services, fork } = await host()
  try {
    let openGate
    const gate = new Promise(resolve => { openGate = resolve })
    let modelKeptGoing = false
    let bodyFullyGenerated = false
    const makeSource = () => (async function* () {
      yield* reasoning
      // 下游收到全部思考才会解这道门；门没解说明思考被正文一起憋住了
      modelKeptGoing = await Promise.race([
        gate.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 3000)),
      ])
      yield* body
      bodyFullyGenerated = true
    })()
    const seen = []
    let bodyBuffered = false
    for await (const chunk of await ctx.waterfall('llm/stream', options, makeSource)) {
      seen.push(chunk)
      if (seen.length === reasoning.length) openGate()
      if (chunk === body[0]) bodyBuffered = bodyFullyGenerated
    }
    assert.equal(modelKeptGoing, true, '思考要在模型还在生成的时候就流出去')
    assert.equal(bodyBuffered, true, '正文要等整段生成完才出去')
    assert.deepEqual(seen, [...reasoning, ...body], '顺序和内容要和模型吐出来的一致')
  } finally {
    await fork.dispose()
    await services.dispose()
  }
}

// 用例二：模型先说话了再想。这时思考不插队，整封按原顺序交出去。
{
  const { ctx, services, fork } = await host()
  try {
    const textFirst = [body[0], body[1], body[2], ...reasoning, body[3]]
    let sourceDone = false
    const makeSource = () => (async function* () {
      yield* textFirst.slice(0, -1)
      sourceDone = true
      yield textFirst.at(-1)
    })()
    const seen = []
    let heldBack = true
    for await (const chunk of await ctx.waterfall('llm/stream', options, makeSource)) {
      if (isReasoning(chunk) && !sourceDone) heldBack = false
      seen.push(chunk)
    }
    assert.equal(heldBack, true, '正文先到时思考不插队')
    assert.deepEqual(seen, textFirst, '顺序和内容要和模型吐出来的一致')
  } finally {
    await fork.dispose()
    await services.dispose()
  }
}

console.log('PASS: 思考边生成边出去，正文等整段生成完，两种顺序都不乱')
