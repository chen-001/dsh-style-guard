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
const NUMBER = /-?\d+(?:\.\d+)?/g;
const BACKTICK = new RegExp('`([^`\\n]+)`', 'g');
const PATH = /(?:[A-Za-z]:)?\/[A-Za-z0-9_./-]{3,}/g;
function tokens(text) {
    const found = [
        ...text.matchAll(NUMBER),
        ...text.matchAll(BACKTICK),
        ...text.matchAll(PATH),
    ].map(match => match[1] ?? match[0]);
    return [...new Set(found)];
}
/** 像文件名的词，丢了要挡。 */
const FILE_LIKE = /\.(py|rs|h5|hdf5|json|ya?ml|md|txt|csv|parquet|toml|sh|ts|tsx|js|mjs|cjs|log|tgz|zip|png|svg|cfg|ini)$/i;
/**
 * 丢掉的这个词要不要挡下整段改写。
 *
 * 数字、路径、像文件名的词都算要紧的，丢了就不敢用。
 * 其余反引号里的名字，例如 `main`、`session-`、`applied`，只是作者随手写的代号，
 * 改写时换成日常说法未必是错，挡下整段反而过度，单独记下来给人看就行。
 */
export function isHardFact(token) {
    if (/\d/.test(token))
        return true;
    if (token.includes('/'))
        return true;
    return FILE_LIKE.test(token);
}
/** 改写前后的事实核对。 */
export function preservesFacts(original, rewritten) {
    const after = new Set(tokens(rewritten));
    const missing = tokens(original).filter(token => !after.has(token));
    const hard = missing.filter(isHardFact);
    const soft = missing.filter(token => !isHardFact(token));
    return { ok: hard.length === 0, missing, hard, soft };
}
//# sourceMappingURL=guard.js.map