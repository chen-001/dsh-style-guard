/**
 * 每条回复操作行里的「原版 / 改写版」开关。
 *
 * 页面上那条回复显示的是改写后的版本，原版只存在插件的记录里。
 * 这里按正文内容去记录里对上号，点一下把这条回复换成原版，再点切回来。
 *
 * 为什么直接改页面：聊天页只给每条回复留了「操作行」这一个位置，
 * 没有让插件替换正文的入口，所以正文的切换由按钮自己在页面上完成。
 * 落到页面上的几个小动作在 dom.ts 里，和 React 无关。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  applyOriginal, closingAssistantItem, ensureStyle, flowItemOf, matchRecord, placeOriginal, removeOriginal,
} from './dom.js'
import type { GuardRecord } from './dom.js'

/** 聊天树里一条回复，只取匹配要用的部分。 */
interface ChatNodeLike {
  kind?: string
  messageId?: string
  blocks?: readonly { kind?: string, text?: string }[]
}

/** 宿主传进来的东西：这条回复的编号，加上会话编号和读聊天记录的工具。 */
export interface ToggleProps {
  messageId?: string
  sessionId?: string
  useChat?: (selector: (snapshot: { legacy?: { nodes?: readonly ChatNodeLike[] } }) => string) => string
}

const LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' } }
const API = '/dsh-style-guard/api/records?limit=200'

/** 同一时刻只留一个在路上的记录请求，一瞬间挂上来的多条回复共用它。 */
let inflight: { sessionId: string, promise: Promise<GuardRecord[]> } | null = null

/** 取这一条会话最近的记录。取不到就当没有，不影响页面。 */
function loadRecords(sessionId: string): Promise<GuardRecord[]> {
  if (inflight !== null && inflight.sessionId === sessionId) return inflight.promise
  const url = sessionId.length > 0 ? API + '&session=' + encodeURIComponent(sessionId) : API
  const promise = fetch(url)
    .then(response => response.json())
    .then((data: { records?: unknown }) => Array.isArray(data?.records) ? data.records as GuardRecord[] : [])
    .catch(() => [] as GuardRecord[])
  inflight = { sessionId, promise }
  void promise.finally(() => { if (inflight?.promise === promise) inflight = null })
  return promise
}

/** 原版正文，用聊天页自己的 markdown 渲染，读起来和正常回复一样。 */
function OriginalBlock({ text }: { text: string }): ReactNode {
  return h('div', { style: { padding: '2px 0 8px' } }, [
    h('div', {
      key: 'label',
      style: { fontSize: '12px', color: '#8a6d00', marginBottom: '6px' },
    }, '模型原来写的版本'),
    h(MarkdownText, { key: 'body', text, labels: LABELS }),
  ])
}

/** 内层组件，读取聊天记录的钩子在这里无条件调用。 */
function Toggle({ messageId, sessionId, useChat }: {
  messageId: string
  sessionId: string
  useChat: NonNullable<ToggleProps['useChat']>
}): ReactNode {
  const text = useChat((snapshot) => {
    const nodes = snapshot?.legacy?.nodes
    if (!Array.isArray(nodes)) return ''
    for (const node of nodes) {
      if (node?.kind !== 'assistant' || node.messageId !== messageId) continue
      let out = ''
      for (const block of node.blocks ?? []) {
        if (block?.kind === 'text' && typeof block.text === 'string') out += block.text
      }
      return out
    }
    return ''
  })
  const [record, setRecord] = useState<GuardRecord | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [holder, setHolder] = useState<HTMLElement | null>(null)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const flowRef = useRef<HTMLElement | null>(null)

  // 正文和记录里的改写版一字不差，说明这条回复被改写器动过，才给开关。
  useEffect(() => {
    if (text.length === 0) return
    let alive = true
    void loadRecords(sessionId).then((records) => {
      if (!alive) return
      const hit = matchRecord(records, text)
      if (hit !== undefined) setRecord(hit)
    })
    return () => { alive = false }
  }, [text, sessionId])

  // 在正文那一行里先占一个位置，用来放原版。
  useEffect(() => {
    if (record === null || rootRef.current === null) return
    ensureStyle()
    const tail = flowItemOf(rootRef.current)
    if (tail === null) return
    const flow = closingAssistantItem(tail)
    if (flow === null) return
    const node = placeOriginal(flow)
    flowRef.current = flow
    setHolder(node)
    return () => {
      removeOriginal(flow, node)
      flowRef.current = null
    }
  }, [record])

  // 开关一动，就把这一行在「改写版」和「原版」之间换过来。
  useEffect(() => {
    const flow = flowRef.current
    if (flow === null || holder === null) return
    applyOriginal(flow, holder, showOriginal)
  }, [showOriginal, holder])

  if (record === null) return null
  return h('span', { ref: rootRef, style: { display: 'inline-flex', alignItems: 'center' } }, [
    h('button', {
      key: 'button',
      type: 'button',
      onClick: () => setShowOriginal(value => !value),
      title: showOriginal ? '切回改写后的版本' : '看模型原来写的版本',
      style: {
        cursor: 'pointer',
        padding: '1px 8px',
        borderRadius: '10px',
        fontSize: '12px',
        lineHeight: '18px',
        marginLeft: '8px',
        border: '1px solid ' + (showOriginal ? '#d9a400' : '#d0d5dd'),
        background: showOriginal ? '#fff8e1' : '#fff',
        color: showOriginal ? '#8a6d00' : '#5b6169',
      },
    }, showOriginal ? '改写版' : '原版'),
    holder === null ? null : createPortal(h(OriginalBlock, { text: record.original }), holder),
  ])
}

/** 操作行里的一项：给被改写过的回复加一个原版/改写版开关。 */
export function StyleGuardAction(props: ToggleProps): ReactNode {
  const { messageId, sessionId = '', useChat } = props
  if (typeof messageId !== 'string' || typeof useChat !== 'function') return null
  return h(Toggle, { messageId, sessionId, useChat })
}
