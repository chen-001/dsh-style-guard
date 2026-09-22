/**
 * 规范来源。每次现读 AGENTS.md 里所有"## 回复风格："小节，按文件修改时间缓存，
 * 这样用户改规范后检查器自动跟着变，不会出现两份不一致的规则。
 */
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const DEFAULT_RUBRIC_PATH = join(homedir(), '.dsh', 'AGENTS.md');
let cache;
/** 取 AGENTS.md 里全部回复风格小节的原文；文件不可读时返回空串。 */
export function loadRubric(path = DEFAULT_RUBRIC_PATH) {
    try {
        const mtimeMs = statSync(path).mtimeMs;
        if (cache && cache.path === path && cache.mtimeMs === mtimeMs)
            return cache.text;
        const lines = readFileSync(path, 'utf8').split('\n');
        const kept = [];
        let keeping = false;
        for (const line of lines) {
            if (line.startsWith('## '))
                keeping = line.startsWith('## 回复风格');
            if (keeping)
                kept.push(line);
        }
        const text = kept.join('\n').trim();
        cache = { path, mtimeMs, text };
        return text;
    }
    catch {
        return '';
    }
}
//# sourceMappingURL=rubric.js.map