/**
 * 从审查记录文件里读出要展示的条目。
 * 只读 review 那一种，跳过 tick 和 skip，按时间倒序。
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
/** 读最近的若干条审查记录；文件不存在或者某一行坏了都不影响其余行。 */
export function readRecentReviews(path, limit) {
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
            if (parsed.kind === 'review')
                out.push(shape(parsed));
        }
        catch {
            /* 坏行跳过 */
        }
    }
    return out;
}
//# sourceMappingURL=records.js.map