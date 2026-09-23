/**
 * 纯逻辑自测。不调用模型，只验证分片改写、事实核对、审改轮次这三件事。
 * 用法：node scripts/test-guard.mjs
 */
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { collect, preservesFacts, replaceText } from '../lib/guard.js'
import { improve } from '../lib/improve.js'
import { riskySentences, splitSentences } from '../lib/textdiff.js'
import { parseCritiqueJson, salvageProblems } from '../lib/critic.js'
import { lastUserQuestion } from '../lib/voice.js'

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' | ' + detail))
}

const ORIGINAL = '看了代码。base 里存的是名次。有效值 5089 个，见 /nas197/a/b.h5 和 `tail_v3.py`。'

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '想一下' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: '想一下' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: text.slice(0, 10) },
    { type: 'text-delta', index: 1, text: text.slice(10) },
    { type: 'block-end', index: 1, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'stop' }, replayState: { raw: 'x' } },
  ]
}

function assemble(chunks) {
  const assembler = new BlockAssembler()
  for (const chunk of chunks) assembler.push(chunk)
  return { blocks: assembler.blocks(), finish: assembler.finish, replayState: assembler.replayState }
}

// 1. 读正文
const chunks = textChunks(ORIGINAL)
const collected = collect(chunks)
check('读出完整正文', collected.text === ORIGINAL, collected.text.length + ' 字')
check('没有工具调用时不误判', collected.hasToolCall === false)

// 2. 替换正文后整封流仍能装回一条正常消息
const REWRITTEN = '这段代码我看过了。base 里存的是名次。有效值 5089 个，见 /nas197/a/b.h5 和 `tail_v3.py`。'
const replaced = replaceText(chunks, REWRITTEN)
const assembled = assemble(replaced)
const textBlocks = assembled.blocks.filter(block => block.type === 'text')
check('改写后只剩一个正文块', textBlocks.length === 1, '实际 ' + textBlocks.length)
check('正文块内容是改写版', textBlocks[0]?.text === REWRITTEN)
check('原始正文没有残留在流里', !replaced.some(c => c.type === 'text-delta' && c.text.includes('看了代码。')))
check('思考块原样保留', replaced.some(c => c.type === 'reasoning-delta'))
check('用量与结束分片保留', assembled.finish.kind === 'stop' && assembled.blocks.length === 2)
check('改写后不再带重放状态', assembled.replayState === undefined)

// 3. 调用工具的那一轮不动
const toolChunks = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: '我来查一下' },
  { type: 'block-end', index: 0, block: { type: 'text', text: '我来查一下' } },
  { type: 'tool-call-delta', index: 1, id: 'c1', name: 'bash', argumentsDelta: '{}' },
]
check('有工具调用时能被识别', collect(toolChunks).hasToolCall === true)

// 4. 事实核对：只挡正文里的数量，路径与文件名只记账
check('数字变了一个就作废', preservesFacts(ORIGINAL, REWRITTEN.replace('5089', '5088')).ok === false)
check('数字丢了就作废', JSON.stringify(preservesFacts('值是 5089。', '值是这个数。').hard) === '["5089"]')
check('只是换说法时通过', preservesFacts(ORIGINAL, REWRITTEN).ok === true)
const pathLost = preservesFacts('见 /nas197/a.h5。', '见那个文件。')
check('路径丢了不挡路', pathLost.ok === true)
check('但会记账', JSON.stringify(pathLost.soft) === '["/nas197/a.h5"]')
const fileLost = preservesFacts('叫 `tail_v3.py`。', '叫那个脚本。')
check('文件名丢了不挡路', fileLost.ok === true)
check('但会记账', JSON.stringify(fileLost.soft) === '["tail_v3.py"]')
const soft = preservesFacts('看 `main` 这一段和 `session-` 这个前缀。', '看这一段和这个前缀。')
check('代码里的代号丢了不挡路', soft.ok === true)
check('但会记下来', JSON.stringify(soft.soft) === '["main","session-"]')
check('夹在名字里的数字不算数量', preservesFacts('改 tail_v3.py 那一行。', '改那个脚本那一行。').ok === true)
check('句子里的数字仍然算数量', JSON.stringify(preservesFacts('改 tail_v3.py 第 609 行。', '改那个脚本那一行。').hard) === '["609"]')

// 5. 审改轮次与失败路径
const seen = []
const twoRounds = await improve(ORIGINAL, 2, Date.now() + 60000, {
  now: () => Date.now(),
  critique: async text => { seen.push(text); return { problems: ['第 1 句太长'], verdict: '还行' } },
  rewrite: async (text, critique) => text + '（改' + critique.problems.length + '）',
})
check('两轮会审两次', seen.length === 2, '实际 ' + seen.length)
check('第二轮审的是第一轮改完的', seen[1]?.includes('（改1）') === true)
check('两轮都改成功', twoRounds.roundsRun === 2 && twoRounds.text.endsWith('（改1）（改1）'))

const rejected = await improve(ORIGINAL, 2, Date.now() + 60000, {
  now: () => Date.now(),
  critique: async () => ({ problems: ['有毛病'], verdict: '' }),
  rewrite: async () => '完全换掉的一段话，数字全丢了。',
})
check('改了事实就退回原文', rejected.text === ORIGINAL && rejected.roundsRun === 0)
check('退回时记下丢了什么', Array.isArray(rejected.rejected?.missing) && rejected.rejected.missing.length > 0)
check('被驳回的那一版也留下来', rejected.rejectedText === '完全换掉的一段话，数字全丢了。')

// 只丢了代码名字的改写照常采用，但要记账
const SOFT_SOURCE = '看 `main` 这一段。值是 5089。'
const softLost = await improve(SOFT_SOURCE, 1, Date.now() + 60000, {
  now: () => Date.now(),
  critique: async () => ({ problems: ['有毛病'], verdict: '' }),
  rewrite: async () => '看这一段。值是 5089。',
})
check('只丢代码名字时按采用处理', softLost.roundsRun === 1 && softLost.text === '看这一段。值是 5089。')
check('采纳时记下丢了哪个名字', JSON.stringify(softLost.softMissing) === '["main"]')
check('采纳时说明里提到这件事', softLost.notes.some(item => item.includes('代码里的名字')))

// 数字被改动时整段作废
const numberChanged = await improve(SOFT_SOURCE, 1, Date.now() + 60000, {
  now: () => Date.now(),
  critique: async () => ({ problems: ['有毛病'], verdict: '' }),
  rewrite: async () => '看这一段。值是 5088。',
})
check('数字被改动就作废', numberChanged.roundsRun === 0 && numberChanged.rejected?.missing.includes('5089') === true)

// 6. 检查那一步的返回解析：模型常在 JSON 前后带一句说明，不能因此丢掉整段审查
check('整段就是 JSON 时读得出来', parseCritiqueJson('{"problems":["a"],"verdict":"b"}')?.verdict === 'b')
check('套着代码围栏也读得出来', parseCritiqueJson('\u0060\u0060\u0060json\n{"problems":[],"verdict":"ok"}\n\u0060\u0060\u0060')?.verdict === 'ok')
check('前后带说明也读得出来', parseCritiqueJson('好的，结果如下：\n{"problems":["x"],"verdict":"y"}\n希望有帮助。')?.verdict === 'y')
check('确实不是 JSON 时返回空', parseCritiqueJson('我读了一遍，感觉还行。') === undefined)

// 截断的返回：最后那个大括号永远等不到，但已经写完的问题要抠出来
const CUT = '{"problems":["第一条意见","第二条意见","第三条被切掉'
check('截断时能抠出完整的问题', JSON.stringify(salvageProblems(CUT)) === '["第一条意见","第二条意见"]')
const CUT_ESCAPED = '{"problems":["带引号\\"和逗号, 的意见","第二条"]}'
check('带转义字符也读得对', JSON.stringify(salvageProblems(CUT_ESCAPED)) === '["带引号\\"和逗号, 的意见","第二条"]')
check('完全读不出问题时给空', JSON.stringify(salvageProblems('没有数组结构')) === '[]')
check('完整 JSON 也走得通', JSON.stringify(salvageProblems('{"problems":["a","b"],"verdict":"c"}')) === '["a","b"]')

// 7. 逐句比对：用来标出改写版里要和原文核对的句子
const BASE = '第一句给结论。第二句讲原因。第三句给出 5089 这个数。'
check('断句按句号切开', splitSentences(BASE).length === 3)
check('原样不动时一句都不标', riskySentences(BASE, BASE).length === 0)
check('凭空多出来的一句会被标', JSON.stringify(riskySentences(BASE, '第一句给结论。第二句讲原因。这里凭空多了一句。第三句给出 5089 这个数。')) === '[2]')
check('换了说法的句子会被标', JSON.stringify(riskySentences(BASE, '先说结论。再说原因。最后给出 5089 这个数。')) === '[0,1]')
check('保留了数字的那句不标', riskySentences(BASE, '第一句给结论。第二句讲原因。第三句给出 5089 这个数。').length === 0)

const timeout = await improve(ORIGINAL, 2, Date.now() - 1, {
  now: () => Date.now(),
  critique: async () => { throw new Error('不该被调用') },
  rewrite: async () => undefined,
})
check('时间到了就不检查', timeout.roundsRun === 0 && timeout.text === ORIGINAL)

const noProblem = await improve(ORIGINAL, 2, Date.now() + 60000, {
  now: () => Date.now(),
  critique: async () => ({ problems: [], verdict: '很好' }),
  rewrite: async () => { throw new Error('不该被调用') },
})
check('没问题就不改写', noProblem.roundsRun === 0 && noProblem.notes.includes('没有发现问题'))

// 找用户这一轮说的话：规范、运行环境说明、自动续跑都挂在用户这一侧，要跳过
const say = (text, kind) => ({ role: 'user', content: [{ type: 'text', text }], ...(kind ? { source: { kind } } : {}) })
const question = lastUserQuestion([
  say('更早的问题', 'user'),
  { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
  say('设置一下，只对 deepseek 生效', 'user'),
  say('<system-reminder>\n规范</system-reminder>', 'agent-instructions'),
  say('本环境装有……', 'runtime-context'),
  say('Continue (The previous tool may not have completed.)', 'user'),
])
check('跳过规范和续跑，取到用户的问题', question === '设置一下，只对 deepseek 生效', question)
check('太长的问题会截断', lastUserQuestion([say('字'.repeat(900), 'user')]).length < 700)

console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
process.exit(failed === 0 ? 0 : 1)
