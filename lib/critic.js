import { VOICE_GUIDE } from './voice.js';
const PLUGIN = '@dsh-external/dsh-style-guard';
export const CRITIC_SYSTEM = [
    '你在审一份中文回复，读者是只会一点 Python 的量化研究者，不懂 Rust。',
    '下面会给你他的写作规范、一份编辑手册、他这一轮问的话，以及 AI 写给他的回复。',
    '先把回复当成一个同事当面对他说的话，从头读一遍，问自己他听着会不会觉得这是一个人在说话。',
    '问题按这个顺序找，前面的比后面的要紧。',
    '第一，整段的样子，例如一句一个事实、句子之间没有因果连接、每件事一段、固定的开头和结尾、先讲程序内部后讲他看到什么。',
    '第二，没有回答到他问的那件事，或者先说的不是他最想知道的。',
    '第三，具体的词和写法违反规范。',
    '接得上他问题的短句是自然的，例如他问触发了没有，第一句答触发了，不算缺主语。',
    '不要评价技术内容对不对，不要为了凑数挑刺。',
    '只输出 JSON，形如 {"problems":["具体位置加一句为什么难读"],"verdict":"一句话总体判断"}。',
    'problems 最多四条，按上面的顺序排，每条一句话、不超过六十字。',
    '读起来已经像一个人在说话、只剩鸡毛蒜皮时，problems 给空数组。',
    '不要输出别的字，也不要展开解释。',
].join('');
export const REWRITE_SYSTEM = [
    '你是中文编辑。把一段 AI 回复重新讲一遍，讲成一个懂行的同事听完他的问题，坐在他旁边当面说的那段话，再照着写下来。',
    '可以调整先后顺序，合并或拆开段落，把几句短陈述连成一句，把程序内部的说法换成他那一头看得到的结果。',
    '硬性约束，正文里的每一个数字都要原样出现，代码块、表格、链接原样保留，反引号里的名字尽量保留。',
    '原文的每一件事实都要还在，可以压缩成半句，不能丢，也不能添加原文没有的信息。',
    '尤其不要替原文解释原因、推测以后会怎样、补充建议，原文没说的一个字都不加。',
    '篇幅和原文差不多或者更短，不要写任何说明，只输出改写后的正文本身。',
].join('');
/** 检查那一步发给模型的话。导出给离线对照脚本用。 */
export function critiquePrompt(rubric, text, question) {
    return [
        '规范如下。', '', rubric, '', VOICE_GUIDE, '',
        '=== 他这一轮问的话 ===', question || '（没取到）', '',
        '=== 待审回复 ===', text, '', '只输出 JSON。',
    ].join('\n');
}
/** 改写那一步发给模型的话。编辑手册放在规范后面，离正文更近，改写时更容易照着做。 */
export function rewritePrompt(rubric, text, critique, question) {
    return [
        '规范如下。', '', rubric, '', VOICE_GUIDE, '',
        '=== 他这一轮问的话 ===', question || '（没取到）', '',
        '=== 审稿意见 ===',
        critique.problems.map((item, index) => (index + 1) + '. ' + item).join('\n'), '',
        '=== 待改写的回复 ===', '', text, '',
        '只输出改写后的正文。',
    ].join('\n');
}
const FENCE = '\u0060\u0060\u0060';
function userMessage(text) {
    return {
        id: 'style-guard-' + Math.random().toString(36).slice(2, 12),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: PLUGIN },
    };
}
/**
 * 本插件自己发出去的那几次调用。记录在案，免得检查器去检查自己写的东西。
 * 用自己模块里的弱集合，不依赖外部模块，避免同一份依赖被加载成两个实例。
 */
const OWN_CALLS = new WeakSet();
/** 这次调用是不是本插件自己发的。 */
export function isOwnCall(options) {
    return OWN_CALLS.has(options);
}
async function callText(ctx, req) {
    let text = '';
    let truncated = false;
    const options = {
        provider: req.route.provider,
        model: req.route.model,
        system: req.system,
        messages: [userMessage(req.prompt)],
        temperature: req.temperature ?? 0,
        maxTokens: req.maxTokens,
        // 默认关掉思考。这类模型把思考也计入输出上限，开着的话要把上限一起放大，否则长文本会被截断成空。
        reasoningEffort: (req.effort || 'off'),
        signal: req.signal,
    };
    OWN_CALLS.add(options);
    const stream = ctx.llm.stream(options);
    let reason = 'no-finish';
    for await (const chunk of stream) {
        if (chunk.type === 'text-delta')
            text += chunk.text;
        if (chunk.type === 'finish') {
            reason = chunk.reason.kind;
            if (chunk.reason.kind === 'max-tokens')
                truncated = true;
            if (chunk.reason.kind === 'error') {
                const failure = chunk.reason.failure;
                throw new Error('模型调用失败 ' + String(failure?.code) + ' ' + String(failure?.message));
            }
            if (chunk.reason.kind === 'aborted')
                throw new Error('模型调用被中断');
        }
    }
    const trimmed = text.trim();
    if (!trimmed)
        throw new Error('模型没有输出正文，结束原因是 ' + reason);
    return { text: trimmed, truncated };
}
/**
 * 从被截断的返回里尽量把问题清单抠出来。
 *
 * 输出上限用完时，JSON 会停在半截，最后那个大括号永远等不到。
 * 这时不整段放弃，而是把 problems 数组里已经写完整的那些字符串一条条读出来，
 * 丢掉被切断的最后一条。审查意见是给人看的一句话，少一条不影响用。
 */
export function salvageProblems(raw) {
    const key = raw.indexOf('"problems"');
    if (key < 0)
        return [];
    const open = raw.indexOf('[', key);
    if (open < 0)
        return [];
    const out = [];
    let index = open + 1;
    while (index < raw.length) {
        // 遇到数组的右括号就说明这个清单到头了，后面的 verdict 不算
        while (index < raw.length && raw[index] !== '"' && raw[index] !== ']')
            index++;
        if (index >= raw.length || raw[index] === ']')
            break;
        let cursor = index + 1;
        let body = '';
        let closed = false;
        while (cursor < raw.length) {
            const char = raw[cursor] ?? '';
            if (char === '\\') {
                body += raw.slice(cursor, cursor + 2);
                cursor += 2;
                continue;
            }
            if (char === '"') {
                closed = true;
                break;
            }
            body += char;
            cursor++;
        }
        if (!closed)
            break;
        try {
            const value = JSON.parse('"' + body + '"');
            if (typeof value === 'string' && value.trim().length > 0)
                out.push(value);
        }
        catch {
            /* 半截的字符串跳过去 */
        }
        index = cursor + 1;
    }
    return out.slice(0, 6);
}
/** 去掉模型习惯性套上的整篇代码围栏。 */
function stripFence(body) {
    const lines = body.trim().split('\n');
    if (lines.length > 1 && lines[0]?.trim().startsWith(FENCE))
        lines.shift();
    if (lines.length > 1 && lines[lines.length - 1]?.trim().startsWith(FENCE))
        lines.pop();
    return lines.join('\n').trim();
}
function asObject(body) {
    try {
        const parsed = JSON.parse(body);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * 从模型返回里挖出那个 JSON。
 * 先当整段就是 JSON；不是的话，退一步取第一个大括号到最后一个大括号之间的部分，
 * 模型常在 JSON 前后带一句说明，卡在整段解析上会把好好的审查结果丢掉。
 */
export function parseCritiqueJson(raw) {
    const body = stripFence(raw);
    const whole = asObject(body);
    if (whole)
        return whole;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start)
        return undefined;
    return asObject(body.slice(start, end + 1));
}
/** 审一遍。返回 undefined 表示这次审查没能得到可用结果。 */
export async function critiqueReply(ctx, route, rubric, text, question, signal) {
    const { text: raw, truncated } = await callText(ctx, {
        route,
        system: CRITIC_SYSTEM,
        maxTokens: 6000,
        signal,
        prompt: critiquePrompt(rubric, text, question),
    });
    const parsed = parseCritiqueJson(raw);
    if (parsed) {
        const problems = Array.isArray(parsed.problems)
            ? parsed.problems.filter((item) => typeof item === 'string').slice(0, 6)
            : [];
        const verdict = typeof parsed.verdict === 'string' ? parsed.verdict : '';
        return { problems, verdict };
    }
    // 整段读不出来时，退一步把已经写完整的问题一条条抠出来。
    // 输出上限用完的话，JSON 会停在半截，最后那个大括号永远等不到。
    const salvaged = salvageProblems(raw);
    if (salvaged.length > 0)
        return { problems: salvaged, verdict: '' };
    if (truncated)
        return { problems: [], verdict: '', unreadable: raw.slice(0, 400) };
    // 读不出来时把开头带回去留档，下一次遇到就不用猜它到底返回了什么
    return { problems: [], verdict: '', unreadable: raw.slice(0, 400) };
}
/** 按意见改一遍。返回 undefined 表示这次改写不可用。 */
export async function rewriteReply(ctx, route, rubric, text, critique, question, effort, signal) {
    const { text: raw, truncated } = await callText(ctx, {
        route,
        system: REWRITE_SYSTEM,
        // 开思考时思考也算在上限里，放大一倍
        maxTokens: effort ? 16000 : 8000,
        effort,
        // 稍微放开一点。温度为零时改写器最保守，只肯换词，不肯重新组织句子
        temperature: 0.4,
        signal,
        prompt: rewritePrompt(rubric, text, critique, question),
    });
    // 被截断的改写一定缺内容，宁可不用
    if (truncated)
        return undefined;
    const body = stripFence(raw);
    return body || undefined;
}
//# sourceMappingURL=critic.js.map