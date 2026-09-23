/** 扫一遍分片，取出正文与几个判断要用的标志。 */
export function collect(chunks) {
    const indexes = new Set();
    let text = '';
    let hasToolCall = false;
    for (const chunk of chunks) {
        if (chunk.type === 'block-start' && chunk.blockType === 'text')
            indexes.add(chunk.index);
        if (chunk.type === 'text-delta') {
            text += chunk.text;
            indexes.add(chunk.index);
        }
        if (chunk.type === 'tool-call-delta')
            hasToolCall = true;
    }
    return { text, hasToolCall, textIndexes: [...indexes].sort((a, b) => a - b) };
}
/**
 * 把流里的正文换成改写版，其余分片原样保留。
 * 同时丢掉 finish 里的 replayState，避免以后重放时把原文又翻出来。
 * 结构对不上就整封退回原件，宁可显示原文也不产生坏消息。
 */
export function replaceText(chunks, rewritten) {
    const primary = collect(chunks).textIndexes[0];
    if (primary === undefined)
        return chunks.slice();
    const out = [];
    let emitted = false;
    for (const chunk of chunks) {
        if (chunk.type === 'text-delta') {
            if (chunk.index === primary && !emitted) {
                out.push({ type: 'text-delta', index: primary, text: rewritten });
                emitted = true;
            }
            continue;
        }
        if (chunk.type === 'block-start' && chunk.blockType === 'text' && chunk.index !== primary)
            continue;
        if (chunk.type === 'block-end' && chunk.block.type === 'text') {
            if (chunk.index !== primary)
                continue;
            out.push({ type: 'block-end', index: chunk.index, block: { type: 'text', text: rewritten } });
            continue;
        }
        if (chunk.type === 'finish') {
            out.push(chunk.replayState === undefined
                ? chunk
                : { type: 'finish', reason: chunk.reason });
            continue;
        }
        out.push(chunk);
    }
    return emitted ? out : chunks.slice();
}
// 只认独立成词的数量。夹在字母里的数字（tail_v3.py 的那个 3）不算，
// 否则丢一个文件名会连带把里面的数字当成要紧的东西。
const NUMBER = /(?<![\w.\-])\d+(?:\.\d+)*(?![\w.])/g;
const BACKTICK = new RegExp('`([^`\\n]+)`', 'g');
const PATH = /(?:[A-Za-z]:)?\/[A-Za-z0-9_./-]{3,}/g;
/** 正文里哪些位置是作者标出来的名字。落在这些位置里的数字不算数量。 */
function codeSpans(text) {
    const spans = [];
    for (const match of text.matchAll(BACKTICK)) {
        const inner = match[1];
        if (inner === undefined)
            continue;
        const start = (match.index ?? 0) + 1;
        spans.push({ start, end: start + inner.length });
    }
    for (const match of text.matchAll(PATH)) {
        const start = match.index ?? 0;
        spans.push({ start, end: start + match[0].length });
    }
    return spans;
}
function inside(index, spans) {
    return spans.some(span => index >= span.start && index < span.end);
}
/** 把正文里的数量和名字都挑出来。 */
export function readTokens(text) {
    const spans = codeSpans(text);
    const out = new Map();
    for (const match of text.matchAll(BACKTICK)) {
        if (match[1] !== undefined)
            out.set(match[1], { value: match[1], kind: 'code' });
    }
    for (const match of text.matchAll(PATH))
        out.set(match[0], { value: match[0], kind: 'code' });
    for (const match of text.matchAll(NUMBER)) {
        const value = match[0];
        const at = match.index ?? 0;
        if (inside(at, spans))
            continue;
        if (out.has(value))
            continue;
        out.set(value, { value, kind: 'number' });
    }
    return [...out.values()];
}
/**
 * 用户的问题是不是在问数量。问的就是数量时，回答里的数字一个都不能删。
 * "几乎"里的"几"不算。
 */
const ASKS_NUMBER = /多少|几(?!乎)|多大|多长|多久|多快|多高|多低|多重|数字|数值|数量|比例|占比|百分之|百分比|具体值/;
export function asksForNumbers(question) {
    return ASKS_NUMBER.test(question);
}
/**
 * 改写前后的事实核对。
 *
 * 删数字是允许的，常规检查里的字节数、测试条数压成"其余检查都通过"正是规范要的。
 * 挡的是三种情况。改写里出现原文没有的数字，说明改错或者编了；
 * 用户问的就是数量，这时删哪个都不行；用户问题里提到的数字，回答里也要留着。
 * 判断"原文有没有"时把代码名字里的数字也算上，原文写 `199`、改写去掉反引号写 199，不算多出来。
 */
export function preservesFacts(original, rewritten, question = '', asksNumber) {
    const after = new Set(readTokens(rewritten).map(token => token.value));
    const missingTokens = readTokens(original).filter(token => !after.has(token.value));
    const missingNumbers = missingTokens.filter(token => token.kind === 'number').map(token => token.value);
    const soft = missingTokens.filter(token => token.kind === 'code').map(token => token.value);
    const anywhere = new Set([...original.matchAll(NUMBER)].map(match => match[0]));
    const invented = readTokens(rewritten)
        .filter(token => token.kind === 'number' && !anywhere.has(token.value))
        .map(token => token.value);
    const asked = new Set([...question.matchAll(NUMBER)].map(match => match[0]));
    // 检查模型判断过就听它的，关键词只在它没给判断时兜底。关键词会把"让面板显示耗时多久"也当成在问数
    const keepAll = asksNumber ?? asksForNumbers(question);
    const mustKeep = missingNumbers.filter(value => keepAll || asked.has(value));
    const dropped = missingNumbers.filter(value => !mustKeep.includes(value));
    const hard = [...invented, ...mustKeep];
    return { ok: hard.length === 0, hard, invented, dropped, soft };
}
//# sourceMappingURL=guard.js.map