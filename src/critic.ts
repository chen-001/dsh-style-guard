/**
 * 两次独立的模型调用。检查那一次只给它一段回复和几条规范，
 * 不带代码也不带上下文，这正是它在单独面对一段文字时判断更准的原因。
 */
import type { Context } from 'cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Critique } from './improve.js'

const PLUGIN = '@dsh-external/dsh-style-guard'

const CRITIC_SYSTEM = [
  '你在审一份中文写作。读者是只会一点 Python 的量化研究者，不懂 Rust。',
  '下面会给你这份写作规范，以及一段 AI 写给他的回复。',
  '你的任务只是找出这段话读起来费劲的地方，理由必须落在规范上，',
  '不要评价技术内容对不对，不要提规范之外的意见。',
  '只输出 JSON，形如 {"problems":["具体位置加一句为什么难读"],"verdict":"一句话总体判断"}。',
  'problems 最多六条，按严重程度排序，没有问题时是空数组。不要输出别的字。',
].join('')

const REWRITE_SYSTEM = [
  '你是中文写作编辑，把一段 AI 回复改写成更好读的版本。',
  '硬性约束，数字、百分比、文件名、路径、反引号里的名字、代码块内容、表格内容必须原样保留，',
  '一个字符都不能改也不能删。只改措辞、断句和段落组织。',
  '不要添加原文没有的信息，不要删掉原文有的事实，不要写任何说明。',
  '只输出改写后的正文本身。',
].join('')

const FENCE = '\u0060\u0060\u0060'

function userMessage(text: string): GenerateOptions['messages'][number] {
  return {
    id: 'style-guard-' + Math.random().toString(36).slice(2, 12),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN },
  } as GenerateOptions['messages'][number]
}

/**
 * 本插件自己发出去的那几次调用。记录在案，免得检查器去检查自己写的东西。
 * 用自己模块里的弱集合，不依赖外部模块，避免同一份依赖被加载成两个实例。
 */
const OWN_CALLS = new WeakSet<object>()

/** 这次调用是不是本插件自己发的。 */
export function isOwnCall(options: object): boolean {
  return OWN_CALLS.has(options)
}

export interface Route {
  provider: string
  model: string
}

async function callText(ctx: Context, req: {
  route: Route
  system: string
  prompt: string
  maxTokens: number
  signal?: AbortSignal
}): Promise<string | undefined> {
  let text = ''
  const options = {
    provider: req.route.provider,
    model: req.route.model,
    system: req.system,
    messages: [userMessage(req.prompt)],
    temperature: 0,
    maxTokens: req.maxTokens,
    // 关掉思考。这类模型把思考也计入输出上限，开着的话长文本会被截断成空。
    reasoningEffort: 'off' as GenerateOptions['reasoningEffort'],
    signal: req.signal,
  }
  OWN_CALLS.add(options)
  const stream = ctx.llm.stream(options)
  let reason = 'no-finish'
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'finish') {
      reason = chunk.reason.kind
      if (chunk.reason.kind === 'error') {
        const failure = chunk.reason.failure as { message?: string; code?: string }
        throw new Error('模型调用失败 ' + String(failure?.code) + ' ' + String(failure?.message))
      }
      if (chunk.reason.kind === 'aborted') throw new Error('模型调用被中断')
    }
  }
  const trimmed = text.trim()
  if (!trimmed) throw new Error('模型没有输出正文，结束原因是 ' + reason)
  return trimmed
}

/** 去掉模型习惯性套上的整篇代码围栏。 */
function stripFence(body: string): string {
  const lines = body.trim().split('\n')
  if (lines.length > 1 && lines[0]?.trim().startsWith(FENCE)) lines.shift()
  if (lines.length > 1 && lines[lines.length - 1]?.trim().startsWith(FENCE)) lines.pop()
  return lines.join('\n').trim()
}

function asObject(body: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/**
 * 从模型返回里挖出那个 JSON。
 * 先当整段就是 JSON；不是的话，退一步取第一个大括号到最后一个大括号之间的部分，
 * 模型常在 JSON 前后带一句说明，卡在整段解析上会把好好的审查结果丢掉。
 */
export function parseCritiqueJson(raw: string): Record<string, unknown> | undefined {
  const body = stripFence(raw)
  const whole = asObject(body)
  if (whole) return whole
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  return asObject(body.slice(start, end + 1))
}

/** 审一遍。返回 undefined 表示这次审查没能得到可用结果。 */
export async function critiqueReply(
  ctx: Context,
  route: Route,
  rubric: string,
  text: string,
  signal?: AbortSignal,
): Promise<Critique | undefined> {
  const raw = await callText(ctx, {
    route,
    system: CRITIC_SYSTEM,
    maxTokens: 3000,
    signal,
    prompt: '规范如下。\n\n' + rubric + '\n\n=== 待审回复 ===\n' + text + '\n\n只输出 JSON。',
  })
  if (!raw) return undefined
  const parsed = parseCritiqueJson(raw)
  // 读不出来时把开头带回去留档，下一次遇到就不用猜它到底返回了什么
  if (!parsed) return { problems: [], verdict: '', unreadable: raw.slice(0, 400) }
  const problems = Array.isArray(parsed.problems)
    ? parsed.problems.filter((item): item is string => typeof item === 'string').slice(0, 6)
    : []
  const verdict = typeof parsed.verdict === 'string' ? parsed.verdict : ''
  return { problems, verdict }
}

/** 按意见改一遍。返回 undefined 表示这次改写不可用。 */
export async function rewriteReply(
  ctx: Context,
  route: Route,
  rubric: string,
  text: string,
  critique: Critique,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const raw = await callText(ctx, {
    route,
    system: REWRITE_SYSTEM,
    maxTokens: 8000,
    signal,
    prompt: [
      '规范如下。',
      '',
      rubric,
      '',
      '已经有人的意见如下。',
      '',
      critique.problems.map((item, index) => (index + 1) + '. ' + item).join('\n'),
      '',
      '=== 待改写的回复 ===',
      '',
      text,
      '',
      '只输出改写后的正文。',
    ].join('\n'),
  })
  if (!raw) return undefined
  const body = stripFence(raw)
  return body || undefined
}
