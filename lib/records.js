/**
 * 从审查记录文件里读出要展示的条目。
 * 只读 review 那一种，跳过 tick 和 skip，按时间倒序。
 * 面板要的是"当前这一条会话"的记录，所以按会话编号过滤。
 */
import { readFileSync } from 'node:fs';
function pick(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}
function strings(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
function shape(raw) {
    const rejected = raw.rejected;
    return {
        ts: pick(raw.ts, ''),
        sessionId: pick(raw.sessionId, ''),
        chars: typeof raw.chars === 'number' ? raw.chars : 0,
        ms: typeof raw.ms === 'number' ? raw.ms : 0,
        roundsRun: typeof raw.roundsRun === 'number' ? raw.roundsRun : 0,
        applied: raw.applied === true,
        dryRun: raw.dryRun === true,
        notes: strings(raw.notes),
        problems: strings(raw.problems),
        missing: strings(rejected?.missing),
        original: pick(raw.original, ''),
        rewritten: pick(raw.rewritten, ''),
    };
}
/** 会话编号去掉前缀再比，宿主记的是 session-xxx，界面给的可能是 xxx。 */
function normalizeSession(value) {
    const trimmed = value.trim().toLowerCase();
    return trimmed.startsWith('session-') ? trimmed.slice('session-'.length) : trimmed;
}
/** 两条记录的会话编号是不是同一个。前缀对得上也算，只要前缀够长。 */
function sameSession(left, right) {
    const a = normalizeSession(left);
    const b = normalizeSession(right);
    if (a.length === 0 || b.length === 0)
        return false;
    if (a === b)
        return true;
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    return shorter.length >= 8 && longer.startsWith(shorter);
}
/**
 * 读最近的若干条审查记录。
 * session 传了就只留这一条会话的，不传就全部。
 * 文件不存在、某一行坏了，都不影响其余行。
 */
export function readRecentReviews(path, limit, session) {
    let text = '';
    try {
        text = readFileSync(path, 'utf8');
    }
    catch {
        return [];
    }
    const lines = text.split('\n');
    const out = [];
    for (let index = lines.length - 1; index >= 0 && out.length < limit; index--) {
        const line = lines[index]?.trim();
        if (!line)
            continue;
        try {
            const parsed = JSON.parse(line);
            if (parsed.kind !== 'review')
                continue;
            const entry = shape(parsed);
            if (session !== undefined && session !== '' && !sameSession(entry.sessionId, session))
                continue;
            out.push(entry);
        }
        catch {
            /* 坏行跳过 */
        }
    }
    return out;
}
//# sourceMappingURL=records.js.map