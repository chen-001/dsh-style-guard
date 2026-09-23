/**
 * @dsh-external/dsh-style-guard
 *
 * 拦在模型的输出流中间。整段话先落进这里，检查并改写之后才交给上层，
 * 所以页面上显示的和写进对话记录的都是改写后的版本，不会先出现一版难读的。
 *
 * 三件必须做的事（这个插件站在每次回复的必经之路上）：
 * 1. 只拦够长的回复，要调用工具的那几轮原样放过去；
 * 2. 改写的前后核对数字，改错、多出，或者用户问数量时删了，就整段作废用原文；
 * 3. 自己任何一步失败或超时都放行原文，不能让用户的对话卡住。
 */
import type { Context } from 'cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from 'schemastery'
import { appendAudit, DEFAULT_AUDIT_PATH } from './audit.js'
import { critiqueReply, isOwnCall, rewriteReply } from './critic.js'
import { collect, replaceText } from './guard.js'
import { improve } from './improve.js'
import { readRecentReviews } from './records.js'
import { DEFAULT_RUBRIC_PATH, loadRubric } from './rubric.js'
import { lastUserQuestion } from './voice.js'

export const name = '@dsh-external/dsh-style-guard'
export const inject = ['llm', 'agents']

/** 侧边栏面板读取记录的地址前缀。 */
export const API_PATH = '/dsh-style-guard/api'

export interface Config {
  /** 总开关。 */
  enabled: boolean
  /** true 时只检查、记录，不真的替换页面上的文字。 */
  dryRun: boolean
  /** 正文短于这个字数就不检查。 */
  minChars: number
  /** 检查加改写做几轮，上限 2。 */
  rounds: number
  /** 检查和改写总共允许多花多少毫秒，超了用手上已有的版本。 */
  maxExtraMs: number
  /** 只处理这些会话，留空表示全部。 */
  sessions: string[]
  /** 只处理主 agent，跳过子 agent。 */
  onlyRootAgents: boolean
  /**
   * 只处理模型名字里都带这些字的请求。空格分开，写几个就要几个都在。
   * 例如 deepseek flash 表示名字里既要有 deepseek 又要有 flash。留空表示不按模型筛。
   */
  modelFilter: string
  /** 检查与改写用哪个服务商，留空表示跟主模型一致。 */
  provider: string
  /** 检查与改写用哪个模型，留空表示跟主模型一致。 */
  model: string
  /**
   * 改写那一步的思考档位，留空表示不思考。
   * 不思考时改写器只肯换词；开了思考它才会重新组织句子，代价是每条回复多等十几到几十秒。
   * 档位名字要是这个模型在配置里认的那几个，例如 low、medium。
   */
  rewriteEffort: string
  /** 是否把跳过的原因也记进日志。 */
  verbose: boolean
  /** 是否把每一次模型调用都记进日志，用来排查插件有没有收到事件。 */
  trace: boolean
  /** 审查记录写到哪。 */
  auditPath: string
  /** 规范从哪读。 */
  rubricPath: string
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  dryRun: z.boolean().default(true),
  minChars: z.number().default(500),
  rounds: z.number().default(1),
  maxExtraMs: z.number().default(90000),
  sessions: z.array(z.string()).default([]),
  onlyRootAgents: z.boolean().default(true),
  modelFilter: z.string().default('deepseek flash'),
  provider: z.string().default(''),
  model: z.string().default(''),
  rewriteEffort: z.string().default(''),
  verbose: z.boolean().default(false),
  trace: z.boolean().default(false),
  auditPath: z.string().default(DEFAULT_AUDIT_PATH),
  rubricPath: z.string().default(DEFAULT_RUBRIC_PATH),
})

/** 插件配置文件。改这里的值之后重载插件即可生效，不用重新构建。 */
export const CONFIG_PATH = join(homedir(), '.dsh', 'style-guard', 'config.json')

/** 把配置文件里的字段盖在内置默认值上面。读不到或格式不对就用默认值。 */
function withFileOverrides(config: Config): Config {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<Config>
    return { ...config, ...parsed }
  } catch {
    return config
  }
}

/**
 * 取 agent 服务。用 reflect.get 而不是直接读 ctx.agents。
 * 直接读一个没声明的服务会当场抛错，而这里位于每次模型调用的必经之路上，
 * 一旦抛错整轮对话都起不来，所以宁可拿不到也不要抛。
 */
function agentRegistry(ctx: Context): AgentRegistryLike | undefined {
  const reflect = (ctx as unknown as { reflect?: { get: (name: string, strict?: boolean) => unknown } }).reflect
  return reflect?.get('agents', false) as AgentRegistryLike | undefined
}

interface AgentRegistryLike {
  currentInitiator?: () => unknown
  roots?: () => unknown[]
}

function note(config: Config, options: GenerateOptions, reason: string): void {
  if (!config.verbose) return
  appendAudit(config.auditPath, {
    kind: 'skip',
    reason,
    sessionId: String(options.sessionId ?? ''),
    provider: options.provider,
    model: options.model,
  })
}

/**
 * 判断这次模型调用是不是主 agent 写回复的那一次。
 *
 * 不用框架里的 isAgentLoopRequest。那个判断依据是一个按对象身份记录的弱集合，
 * 而插件构建时链接的那份 dsh-llm 和运行中宿主加载的那份是两个模块实例，
 * 弱集合不共享，判断永远是假。改用两条能直接看见的线索：
 * 主 agent 的请求是深度冻结的，而且不带 purpose（压缩、起标题这类附带调用会带）。
 */
function looksLikeAgentCall(options: GenerateOptions): boolean {
  if (isOwnCall(options)) return false
  if (options.purpose !== undefined) return false
  return Object.isFrozen(options)
}

/** 判断这次调用是否归本插件管。返回空串表示管，返回原因表示跳过。 */
function skipReason(ctx: Context, config: Config, options: GenerateOptions): string {
  // 按模型名字筛。写成空格分开的几个词，就得每个都出现在名字里。
  if (config.modelFilter.trim().length > 0) {
    const wanted = config.modelFilter.toLowerCase().split(/\s+/).filter(word => word.length > 0)
    const name = String(options.model ?? '').toLowerCase()
    const missing = wanted.filter(word => !name.includes(word))
    if (missing.length > 0) return '模型名字里没有 ' + missing.join('、')
  }
  if (config.sessions.length > 0) {
    const sessionId = options.sessionId === undefined ? '' : String(options.sessionId)
    if (!sessionId || !config.sessions.includes(sessionId)) return '不在指定的会话里'
  }
  if (config.onlyRootAgents) {
    const agents = agentRegistry(ctx)
    const current = agents?.currentInitiator?.()
    const roots = agents?.roots?.()
    if (current && Array.isArray(roots) && !roots.includes(current)) return '子 agent 的调用'
  }
  return ''
}

async function* guarded(
  ctx: Context,
  config: Config,
  options: GenerateOptions,
  source: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  const started = Date.now()
  const chunks: StreamChunk[] = []
  for await (const chunk of source) chunks.push(chunk)

  let out = chunks
  try {
    const collected = collect(chunks)
    if (collected.hasToolCall) {
      note(config, options, '这一轮在调用工具')
    } else if (collected.text.length < config.minChars) {
      note(config, options, '回复太短')
    } else {
      const rubric = loadRubric(config.rubricPath)
      if (!rubric) {
        note(config, options, '读不到规范')
      } else {
        const route = {
          provider: config.provider || options.provider,
          model: config.model || options.model,
        }
        // 检查和改写都要知道他问的是什么，否则分不清一句短答是自然还是缺主语
        const question = lastUserQuestion(options.messages)
        const result = await improve(
          collected.text,
          Math.min(Math.max(Math.round(config.rounds), 1), 2),
          started + config.maxExtraMs,
          {
            now: () => Date.now(),
            critique: text => critiqueReply(ctx, route, rubric, text, question, options.signal),
            rewrite: (text, critique) => rewriteReply(ctx, route, rubric, text, critique, question, config.rewriteEffort, options.signal),
          },
          question,
        )
        const changed = result.roundsRun > 0 && result.text !== collected.text
        appendAudit(config.auditPath, {
          kind: 'review',
          sessionId: String(options.sessionId ?? ''),
          provider: route.provider,
          model: route.model,
          chars: collected.text.length,
          ms: Date.now() - started,
          roundsRun: result.roundsRun,
          problems: result.problems,
          notes: result.notes,
          rejected: result.rejected,
          softMissing: result.softMissing,
          droppedNumbers: result.droppedNumbers,
          critiqueRaw: result.critiqueRaw,
          dryRun: config.dryRun,
          applied: changed && !config.dryRun,
          question,
          original: collected.text,
          rewritten: changed ? result.text : undefined,
          // 被驳回的那一版也留档，面板要把它和原文并排展示，并标出哪里要小心
          rejectedText: result.rejectedText,
        })
        if (changed && !config.dryRun) out = replaceText(chunks, result.text)
      }
    }
  } catch (error) {
    appendAudit(config.auditPath, {
      kind: 'error',
      sessionId: String(options.sessionId ?? ''),
      error: String(error),
    })
    out = chunks
  }
  yield* out
}

export function apply(ctx: Context, schemaConfig: Config): void {
  const config = withFileOverrides(schemaConfig)
  if (!config.enabled) return
  // 整个判断包在 try 里。这个位置在每次模型调用的必经之路上，
  // 这里抛一个错，整轮对话就起不来，所以任何意外都退回原始流。
  ctx.on('llm/stream', (options, next) => {
    try {
      if (config.trace) {
        appendAudit(config.auditPath, {
          kind: 'tick',
          agentCall: looksLikeAgentCall(options),
          frozen: Object.isFrozen(options),
          purpose: options.purpose,
          messages: options.messages?.length,
          provider: options.provider,
          model: options.model,
          sessionId: String(options.sessionId ?? ''),
        })
      }
      if (!looksLikeAgentCall(options)) return next()
      const reason = skipReason(ctx, config, options)
      if (reason) {
        note(config, options, reason)
        return next()
      }
      return guarded(ctx, config, options, next())
    } catch (error) {
      appendAudit(config.auditPath, { kind: 'error', where: 'listen', error: String(error) })
      return next()
    }
  })
  registerRecordsApi(ctx, config)
}

/**
 * 给侧边栏面板用的只读接口。
 *
 * 走延迟注入，webServer 不在就不注册，主流程照常跑。挂载失败也不能往外抛：
 * 这个插件在每次模型调用的必经之路上，任何一处抛错都会让整轮对话起不来。
 */
function registerRecordsApi(ctx: Context, config: Config): void {
  try {
    ctx.inject(['webServer'], (childCtx: Context) => {
      const server = (childCtx as unknown as { webServer?: { register: (route: unknown) => () => void } }).webServer
      if (!server || typeof server.register !== 'function') return
      childCtx.effect(() => server.register({
        kind: 'prefix',
        path: API_PATH,
        handler: (req: { url?: string }, res: { writeHead: (code: number, headers: Record<string, string>) => void, end: (body: string) => void }) => {
          const limit = limitOf(req?.url)
          const session = sessionOf(req?.url)
          const body = JSON.stringify({ records: readRecentReviews(config.auditPath, limit, session) })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(body)
        },
      }), 'dsh-style-guard: records api')
    })
  } catch (error) {
    appendAudit(config.auditPath, { kind: 'error', where: 'api-register', error: String(error) })
  }
}

/** 从请求地址里取条数，最多两百条，取不到就用五十条。 */
function limitOf(url: string | undefined): number {
  const match = /[?&]limit=(\d+)/.exec(url ?? '')
  const parsed = match ? Number.parseInt(match[1] ?? '', 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50
}

/** 从请求地址里取会话编号。取不到就不过滤，返回空串。 */
function sessionOf(url: string | undefined): string {
  const match = /[?&]session=([^&]*)/.exec(url ?? '')
  if (!match?.[1]) return ''
  try {
    return decodeURIComponent(match[1]).trim()
  } catch {
    return match[1].trim()
  }
}
