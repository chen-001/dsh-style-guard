/**
 * 逐句比对用的纯函数。宿主构建会把它编译进 lib，客户端打包时也会打进面板那一份，
 * 两边用的是同一份代码，测试也只测这一份。
 */

/** 按句号一类断句，断开的位置保留在句子里。 */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？；!?;\n])/).filter(part => part.trim().length > 0)
}

/** 一个句子里的相邻两字组合，用来比相似度。 */
export function bigrams(text: string): Set<string> {
  const cleaned = text.replace(/\s+/g, '')
  const out = new Set<string>()
  for (let index = 0; index + 2 <= cleaned.length; index++) out.add(cleaned.slice(index, index + 2))
  return out
}

/** 两个句子的相似度，取共同的相邻两字组合占多数的比例。 */
export function overlap(left: string, right: string): number {
  const a = bigrams(left)
  const b = bigrams(right)
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const gram of a) if (b.has(gram)) hit++
  return hit / Math.max(a.size, b.size)
}

/**
 * 改写版里哪些句子在原文里找不到对应。
 * 找得到对应的意思是在原文里有一句和它足够像；像不到就说明这句是新写的或者改动很大。
 */
export function riskySentences(original: string, rewritten: string, threshold = 0.34): number[] {
  const source = splitSentences(original)
  const risky: number[] = []
  splitSentences(rewritten).forEach((sentence, index) => {
    let best = 0
    for (const other of source) best = Math.max(best, overlap(sentence, other))
    if (best < threshold) risky.push(index)
  })
  return risky
}
