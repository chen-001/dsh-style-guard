export declare const DEFAULT_AUDIT_PATH: string;
/** 追加一条记录。写日志失败绝不影响回复本身。 */
export declare function appendAudit(path: string, record: Record<string, unknown>): void;
