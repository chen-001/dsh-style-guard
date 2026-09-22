/**
 * 逐句比对用的纯函数。宿主构建会把它编译进 lib，客户端打包时也会打进面板那一份，
 * 两边用的是同一份代码，测试也只测这一份。
 */
/** 按句号一类断句，断开的位置保留在句子里。 */
export declare function splitSentences(text: string): string[];
/** 一个句子里的相邻两字组合，用来比相似度。 */
export declare function bigrams(text: string): Set<string>;
/** 两个句子的相似度，取共同的相邻两字组合占多数的比例。 */
export declare function overlap(left: string, right: string): number;
/**
 * 改写版里哪些句子在原文里找不到对应。
 * 找得到对应的意思是在原文里有一句和它足够像；像不到就说明这句是新写的或者改动很大。
 */
export declare function riskySentences(original: string, rewritten: string, threshold?: number): number[];
