/** 面板要展示的一条记录。 */
export interface ReviewEntry {
    ts: string;
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
/** 读最近的若干条审查记录；文件不存在或者某一行坏了都不影响其余行。 */
export declare function readRecentReviews(path: string, limit: number): ReviewEntry[];
