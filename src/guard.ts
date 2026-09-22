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

const NUMBER = /-?\d+(?:\.\d+)?/g
const BACKTICK = new RegExp('`([^`\\n]+)`', 'g')
const PATH = /(?:[A-Za-z]:)?\/[A-Za-z0-9_./-]{3,}/g

function tokens(text: string): string[] {
  const found = [
    ...text.matchAll(NUMBER),
    ...text.matchAll(BACKTICK),
    ...text.matchAll(PATH),
  ].map(match => match[1] ?? match[0])
  return [...new Set(found)]
}

/** 改写前后的事实核对。数字、路径、反引号里的名字少一个就作废这一版改写。 */
export function preservesFacts(original: string, rewritten: string): { ok: boolean; missing: string[] } {
  const after = new Set(tokens(rewritten))
  const missing = tokens(original).filter(token => !after.has(token))
  return { ok: missing.length === 0, missing }
}
