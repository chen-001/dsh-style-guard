/**
 * 两次独立的模型调用。检查那一次只给它一段回复和几条规范，
 * 不带代码也不带上下文，这正是它在单独面对一段文字时判断更准的原因。
 */
import type { Context } from 'cordis';
import type { Critique } from './improve.js';
export declare const CRITIC_SYSTEM: string;
export declare const REWRITE_SYSTEM: string;
/** 检查那一步发给模型的话。导出给离线对照脚本用。 */
export declare function critiquePrompt(rubric: string, text: string, question: string): string;
/** 改写那一步发给模型的话。编辑手册放在规范后面，离正文更近，改写时更容易照着做。 */
export declare function rewritePrompt(rubric: string, text: string, critique: Critique, question: string): string;
/** 这次调用是不是本插件自己发的。 */
export declare function isOwnCall(options: object): boolean;
export interface Route {
    provider: string;
    model: string;
}
/**
 * 从被截断的返回里尽量把问题清单抠出来。
 *
 * 输出上限用完时，JSON 会停在半截，最后那个大括号永远等不到。
 * 这时不整段放弃，而是把 problems 数组里已经写完整的那些字符串一条条读出来，
 * 丢掉被切断的最后一条。审查意见是给人看的一句话，少一条不影响用。
 */
export declare function salvageProblems(raw: string): string[];
/**
 * 从模型返回里挖出那个 JSON。
 * 先当整段就是 JSON；不是的话，退一步取第一个大括号到最后一个大括号之间的部分，
 * 模型常在 JSON 前后带一句说明，卡在整段解析上会把好好的审查结果丢掉。
 */
export declare function parseCritiqueJson(raw: string): Record<string, unknown> | undefined;
/** 审一遍。返回 undefined 表示这次审查没能得到可用结果。 */
export declare function critiqueReply(ctx: Context, route: Route, rubric: string, text: string, question: string, signal?: AbortSignal): Promise<Critique | undefined>;
/** 按意见改一遍。返回 undefined 表示这次改写不可用。 */
export declare function rewriteReply(ctx: Context, route: Route, rubric: string, text: string, critique: Critique, question: string, effort: string, signal?: AbortSignal): Promise<string | undefined>;
