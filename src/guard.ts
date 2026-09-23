/**
 * 改写一封流式回复。收到的是模型吐出的原始分片，交回去的是改写后的分片，
 * 中间不留任何东西给页面，所以用户看到的和存进对话记录的始终是同一份。
 */
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

/** 一封流里能读出的事实。 */
export interface Collected {
  /** 全部 text 分片拼起来的正文。 */
  text: string
  /** 是否在调用工具。调用工具的那一轮不改写。 */
  hasToolCall: boolean
  /** 出现过的 text 块编号，用来定位要替换哪一块。 */
  textIndexes: number[]
}

/** 扫一遍分片，取出正文与几个判断要用的标志。 */
export function collect(chunks: readonly StreamChunk[]): Collected {
  const indexes = new Set<number>()
  let text = ''
  let hasToolCall = false
  for (const chunk of chunks) {
    if (chunk.type === 'block-start' && chunk.blockType === 'text') indexes.add(chunk.index)
    if (chunk.type === 'text-delta') {
      text += chunk.text
      indexes.add(chunk.index)
    }
    if (chunk.type === 'tool-call-delta') hasToolCall = true
  }
  return { text, hasToolCall, textIndexes: [...indexes].sort((a, b) => a - b) }
}

/**
 * 把流里的正文换成改写版，其余分片原样保留。
 * 同时丢掉 finish 里的 replayState，避免以后重放时把原文又翻出来。
 * 结构对不上就整封退回原件，宁可显示原文也不产生坏消息。
 */
export function replaceText(chunks: readonly StreamChunk[], rewritten: string): StreamChunk[] {
  const primary = collect(chunks).textIndexes[0]
  if (primary === undefined) return chunks.slice()
  const out: StreamChunk[] = []
  let emitted = false
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      if (chunk.index === primary && !emitted) {
        out.push({ type: 'text-delta', index: primary, text: rewritten })
        emitted = true
      }
      continue
    }
    if (chunk.type === 'block-start' && chunk.blockType === 'text' && chunk.index !== primary) continue
    if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      if (chunk.index !== primary) continue
      out.push({ type: 'block-end', index: chunk.index, block: { type: 'text', text: rewritten } })
      continue
    }
    if (chunk.type === 'finish') {
      out.push(chunk.replayState === undefined
        ? chunk
        : { type: 'finish', reason: chunk.reason })
      continue
    }
    out.push(chunk)
  }
  return emitted ? out : chunks.slice()
}

// 只认独立成词的数量。夹在字母里的数字（tail_v3.py 的那个 3）不算，
// 否则丢一个文件名会连带把里面的数字当成要紧的东西。
const NUMBER = /(?<![\w.\-])\d+(?:\.\d+)*(?![\w.])/g
const BACKTICK = new RegExp('`([^`\\n]+)`', 'g')
const PATH = /(?:[A-Za-z]:)?\/[A-Za-z0-9_./-]{3,}/g

/** 一个词，以及它为什么被记下来。 */
export interface FactToken {
  value: string
  /**
   * number 是正文里的数量，例如 5089、0.34、90 秒，改了或者丢了就可能出错，挡下改写。
   * code 是作者标出来的名字，路径、文件名、反引号里的代号，改写时换成日常说法很正常，
   * 只记账不挡路：读的人本来就记不住这些名字，卡住整段反而更贵。
   */
  kind: 'number' | 'code'
}

/** 正文里哪些位置是作者标出来的名字。落在这些位置里的数字不算数量。 */
function codeSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  for (const match of text.matchAll(BACKTICK)) {
    const inner = match[1]
    if (inner === undefined) continue
    const start = (match.index ?? 0) + 1
    spans.push({ start, end: start + inner.length })
  }
  for (const match of text.matchAll(PATH)) {
    const start = match.index ?? 0
    spans.push({ start, end: start + match[0].length })
  }
  return spans
}

function inside(index: number, spans: { start: number; end: number }[]): boolean {
  return spans.some(span => index >= span.start && index < span.end)
}

/** 把正文里的数量和名字都挑出来。 */
export function readTokens(text: string): FactToken[] {
  const spans = codeSpans(text)
  const out = new Map<string, FactToken>()
  for (const match of text.matchAll(BACKTICK)) {
    if (match[1] !== undefined) out.set(match[1], { value: match[1], kind: 'code' })
  }
  for (const match of text.matchAll(PATH)) out.set(match[0], { value: match[0], kind: 'code' })
  for (const match of text.matchAll(NUMBER)) {
    const value = match[0]
    const at = match.index ?? 0
    if (inside(at, spans)) continue
    if (out.has(value)) continue
    out.set(value, { value, kind: 'number' })
  }
  return [...out.values()]
}

/** 事实核对的结果。 */
export interface FactCheck {
  /** 数量一个没丢才算通过。 */
  ok: boolean
  /** 丢掉的词，全部。 */
  missing: string[]
  /** 丢掉且挡下改写的数量。 */
  hard: string[]
  /** 丢掉但不挡路的代码名字，路径、文件名、反引号代号都算。 */
  soft: string[]
}

/** 改写前后的事实核对。只挡正文里的数量，代码名字丢了照常采用。 */
export function preservesFacts(original: string, rewritten: string): FactCheck {
  const after = new Set(readTokens(rewritten).map(token => token.value))
  const missingTokens = readTokens(original).filter(token => !after.has(token.value))
  const hard = missingTokens.filter(token => token.kind === 'number').map(token => token.value)
  const soft = missingTokens.filter(token => token.kind === 'code').map(token => token.value)
  return { ok: hard.length === 0, missing: [...hard, ...soft], hard, soft }
}
