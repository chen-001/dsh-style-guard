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
/** 一个词，以及它为什么被记下来。 */
export interface FactToken {
    value: string;
    /**
     * number 是正文里的数量，例如 5089、0.34、90 秒，改了或者丢了就可能出错，挡下改写。
     * code 是作者标出来的名字，路径、文件名、反引号里的代号，改写时换成日常说法很正常，
     * 只记账不挡路：读的人本来就记不住这些名字，卡住整段反而更贵。
     */
    kind: 'number' | 'code';
}
/** 把正文里的数量和名字都挑出来。 */
export declare function readTokens(text: string): FactToken[];
export declare function asksForNumbers(question: string): boolean;
/** 事实核对的结果。 */
export interface FactCheck {
    /** 没有改错或多出来的数字，该留的数字也都在，才算通过。 */
    ok: boolean;
    /** 挡下改写的数字，包括改写里凭空多出来的，和不许删却被删掉的。 */
    hard: string[];
    /** 改写里凭空多出来的数字，原文哪里都找不到。hard 的一部分。 */
    invented: string[];
    /** 删掉了但允许删的数字。只记账，面板上提一句。 */
    dropped: string[];
    /** 丢掉但不挡路的代码名字，路径、文件名、反引号代号都算。 */
    soft: string[];
}
/**
 * 改写前后的事实核对。
 *
 * 删数字是允许的，常规检查里的字节数、测试条数压成"其余检查都通过"正是规范要的。
 * 挡的是三种情况。改写里出现原文没有的数字，说明改错或者编了；
 * 用户问的就是数量，这时删哪个都不行；用户问题里提到的数字，回答里也要留着。
 * 判断"原文有没有"时把代码名字里的数字也算上，原文写 `199`、改写去掉反引号写 199，不算多出来。
 */
export declare function preservesFacts(original: string, rewritten: string, question?: string, asksNumber?: boolean): FactCheck;
