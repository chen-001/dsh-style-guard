/** 面板要展示的一条记录。 */
export interface ReviewEntry {
    ts: string;
    sessionId: string;
    chars: number;
    ms: number;
    roundsRun: number;
    applied: boolean;
    dryRun: boolean;
    notes: string[];
    problems: string[];
    missing: string[];
    original: string;
    rewritten: string;
}
/**
 * 读最近的若干条审查记录。
 * session 传了就只留这一条会话的，不传就全部。
 * 文件不存在、某一行坏了，都不影响其余行。
 */
export declare function readRecentReviews(path: string, limit: number, session?: string): ReviewEntry[];
