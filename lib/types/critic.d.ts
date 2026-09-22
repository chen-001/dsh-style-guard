/**
 * 两次独立的模型调用。检查那一次只给它一段回复和几条规范，
 * 不带代码也不带上下文，这正是它在单独面对一段文字时判断更准的原因。
 */
import type { Context } from 'cordis';
import type { Critique } from './improve.js';
/** 这次调用是不是本插件自己发的。 */
export declare function isOwnCall(options: object): boolean;
export interface Route {
    provider: string;
    model: string;
}
/** 审一遍。返回 undefined 表示这次审查没能得到可用结果。 */
export declare function critiqueReply(ctx: Context, route: Route, rubric: string, text: string, signal?: AbortSignal): Promise<Critique | undefined>;
/** 按意见改一遍。返回 undefined 表示这次改写不可用。 */
export declare function rewriteReply(ctx: Context, route: Route, rubric: string, text: string, critique: Critique, signal?: AbortSignal): Promise<string | undefined>;
