import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import z from 'schemastery';
import { appendAudit, DEFAULT_AUDIT_PATH } from './audit.js';
import { critiqueReply, isOwnCall, rewriteReply } from './critic.js';
import { collect, replaceText } from './guard.js';
import { improve } from './improve.js';
import { readRecentReviews } from './records.js';
import { DEFAULT_RUBRIC_PATH, loadRubric } from './rubric.js';
export const name = '@dsh-external/dsh-style-guard';
export const inject = ['llm', 'agents'];
/** 侧边栏面板读取记录的地址前缀。 */
export const API_PATH = '/dsh-style-guard/api';
export const Config = z.object({
    enabled: z.boolean().default(true),
    dryRun: z.boolean().default(true),
    minChars: z.number().default(500),
    rounds: z.number().default(1),
    maxExtraMs: z.number().default(90000),
    sessions: z.array(z.string()).default([]),
    onlyRootAgents: z.boolean().default(true),
    provider: z.string().default(''),
    model: z.string().default(''),
    verbose: z.boolean().default(false),
    trace: z.boolean().default(false),
    auditPath: z.string().default(DEFAULT_AUDIT_PATH),
    rubricPath: z.string().default(DEFAULT_RUBRIC_PATH),
});
/** 插件配置文件。改这里的值之后重载插件即可生效，不用重新构建。 */
export const CONFIG_PATH = join(homedir(), '.dsh', 'style-guard', 'config.json');
/** 把配置文件里的字段盖在内置默认值上面。读不到或格式不对就用默认值。 */
function withFileOverrides(config) {
    try {
        const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
        return { ...config, ...parsed };
    }
    catch {
        return config;
    }
}
/**
 * 取 agent 服务。用 reflect.get 而不是直接读 ctx.agents。
 * 直接读一个没声明的服务会当场抛错，而这里位于每次模型调用的必经之路上，
 * 一旦抛错整轮对话都起不来，所以宁可拿不到也不要抛。
 */
function agentRegistry(ctx) {
    const reflect = ctx.reflect;
    return reflect?.get('agents', false);
}
function note(config, options, reason) {
    if (!config.verbose)
        return;
    appendAudit(config.auditPath, {
        kind: 'skip',
        reason,
        sessionId: String(options.sessionId ?? ''),
        provider: options.provider,
        model: options.model,
    });
}
/**
 * 判断这次模型调用是不是主 agent 写回复的那一次。
 *
 * 不用框架里的 isAgentLoopRequest。那个判断依据是一个按对象身份记录的弱集合，
 * 而插件构建时链接的那份 dsh-llm 和运行中宿主加载的那份是两个模块实例，
 * 弱集合不共享，判断永远是假。改用两条能直接看见的线索：
 * 主 agent 的请求是深度冻结的，而且不带 purpose（压缩、起标题这类附带调用会带）。
 */
function looksLikeAgentCall(options) {
    if (isOwnCall(options))
        return false;
    if (options.purpose !== undefined)
        return false;
    return Object.isFrozen(options);
}
/** 判断这次调用是否归本插件管。返回空串表示管，返回原因表示跳过。 */
function skipReason(ctx, config, options) {
    if (config.sessions.length > 0) {
        const sessionId = options.sessionId === undefined ? '' : String(options.sessionId);
        if (!sessionId || !config.sessions.includes(sessionId))
            return '不在指定的会话里';
    }
    if (config.onlyRootAgents) {
        const agents = agentRegistry(ctx);
        const current = agents?.currentInitiator?.();
        const roots = agents?.roots?.();
        if (current && Array.isArray(roots) && !roots.includes(current))
            return '子 agent 的调用';
    }
    return '';
}
async function* guarded(ctx, config, options, source) {
    const started = Date.now();
    const chunks = [];
    for await (const chunk of source)
        chunks.push(chunk);
    let out = chunks;
    try {
        const collected = collect(chunks);
        if (collected.hasToolCall) {
            note(config, options, '这一轮在调用工具');
        }
        else if (collected.text.length < config.minChars) {
            note(config, options, '回复太短');
        }
        else {
            const rubric = loadRubric(config.rubricPath);
            if (!rubric) {
                note(config, options, '读不到规范');
            }
            else {
                const route = {
                    provider: config.provider || options.provider,
                    model: config.model || options.model,
                };
                const result = await improve(collected.text, Math.min(Math.max(Math.round(config.rounds), 1), 2), started + config.maxExtraMs, {
                    now: () => Date.now(),
                    critique: text => critiqueReply(ctx, route, rubric, text, options.signal),
                    rewrite: (text, critique) => rewriteReply(ctx, route, rubric, text, critique, options.signal),
                });
                const changed = result.roundsRun > 0 && result.text !== collected.text;
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
                    dryRun: config.dryRun,
                    applied: changed && !config.dryRun,
                    original: collected.text,
                    rewritten: changed ? result.text : undefined,
                    // 被驳回的那一版也留档，面板要把它和原文并排展示，并标出哪里要小心
                    rejectedText: result.rejectedText,
                });
                if (changed && !config.dryRun)
                    out = replaceText(chunks, result.text);
            }
        }
    }
    catch (error) {
        appendAudit(config.auditPath, {
            kind: 'error',
            sessionId: String(options.sessionId ?? ''),
            error: String(error),
        });
        out = chunks;
    }
    yield* out;
}
export function apply(ctx, schemaConfig) {
    const config = withFileOverrides(schemaConfig);
    if (!config.enabled)
        return;
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
                });
            }
            if (!looksLikeAgentCall(options))
                return next();
            const reason = skipReason(ctx, config, options);
            if (reason) {
                note(config, options, reason);
                return next();
            }
            return guarded(ctx, config, options, next());
        }
        catch (error) {
            appendAudit(config.auditPath, { kind: 'error', where: 'listen', error: String(error) });
            return next();
        }
    });
    registerRecordsApi(ctx, config);
}
/**
 * 给侧边栏面板用的只读接口。
 *
 * 走延迟注入，webServer 不在就不注册，主流程照常跑。挂载失败也不能往外抛：
 * 这个插件在每次模型调用的必经之路上，任何一处抛错都会让整轮对话起不来。
 */
function registerRecordsApi(ctx, config) {
    try {
        ctx.inject(['webServer'], (childCtx) => {
            const server = childCtx.webServer;
            if (!server || typeof server.register !== 'function')
                return;
            childCtx.effect(() => server.register({
                kind: 'prefix',
                path: API_PATH,
                handler: (req, res) => {
                    const limit = limitOf(req?.url);
                    const session = sessionOf(req?.url);
                    const body = JSON.stringify({ records: readRecentReviews(config.auditPath, limit, session) });
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(body);
                },
            }), 'dsh-style-guard: records api');
        });
    }
    catch (error) {
        appendAudit(config.auditPath, { kind: 'error', where: 'api-register', error: String(error) });
    }
}
/** 从请求地址里取条数，最多两百条，取不到就用五十条。 */
function limitOf(url) {
    const match = /[?&]limit=(\d+)/.exec(url ?? '');
    const parsed = match ? Number.parseInt(match[1] ?? '', 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}
/** 从请求地址里取会话编号。取不到就不过滤，返回空串。 */
function sessionOf(url) {
    const match = /[?&]session=([^&]*)/.exec(url ?? '');
    if (!match?.[1])
        return '';
    try {
        return decodeURIComponent(match[1]).trim();
    }
    catch {
        return match[1].trim();
    }
}
//# sourceMappingURL=index.js.map