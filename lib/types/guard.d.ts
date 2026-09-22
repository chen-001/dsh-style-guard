/**
 * 改写一封流式回复。收到的是模型吐出的原始分片，交回去的是改写后的分片，
 * 中间不留任何东西给页面，所以用户看到的和存进对话记录的始终是同一份。
 */
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
/** 一封流里能读出的事实。 */
export interface Collected {
    /** 全部 text 分片拼起来的正文。 */
    text: string;
    /** 是否在调用工具。调用工具的那一轮不改写。 */
    hasToolCall: boolean;
    /** 出现过的 text 块编号，用来定位要替换哪一块。 */
    textIndexes: number[];
}
/** 扫一遍分片，取出正文与几个判断要用的标志。 */
export declare function collect(chunks: readonly StreamChunk[]): Collected;
/**
 * 把流里的正文换成改写版，其余分片原样保留。
 * 同时丢掉 finish 里的 replayState，避免以后重放时把原文又翻出来。
 * 结构对不上就整封退回原件，宁可显示原文也不产生坏消息。
 */
export declare function replaceText(chunks: readonly StreamChunk[], rewritten: string): StreamChunk[];
/** 改写前后的事实核对。数字、路径、反引号里的名字少一个就作废这一版改写。 */
export declare function preservesFacts(original: string, rewritten: string): {
    ok: boolean;
    missing: string[];
};
