/**
 * 审查记录。原文与改写版都写进本地 JSONL，原文不进对话，只留档，
 * 便于回看模型本来想说什么，以及统计哪类问题最常出现。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
export const DEFAULT_AUDIT_PATH = join(homedir(), '.dsh', 'style-guard', 'log.jsonl');
function resolve(path) {
    return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}
/** 追加一条记录。写日志失败绝不影响回复本身。 */
export function appendAudit(path, record) {
    try {
        const target = resolve(path);
        mkdirSync(dirname(target), { recursive: true });
        appendFileSync(target, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
    }
    catch {
        /* 留档失败是次要问题，放过去 */
    }
}
//# sourceMappingURL=audit.js.map