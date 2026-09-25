/**
 * 每条回复操作行里的「另一版」开关：原版看改写版，改写版看原版。
 *
 * 页面上显示哪一版由插件决定（采纳了就显示改写版，没采纳就显示原文），
 * 这里按正文内容去记录里对上号，点一下换成另一版，再点切回来。
 * 没采纳的回复默认就是原文，按钮只是让人能看看被驳回的改写版长什么样。
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
  applyAlternate, closingAssistantItem, ensureStyle, flowItemOf, matchVersion, placeAlternate, removeAlternate,
} from './dom.js'
import type { GuardRecord, VersionMatch } from './dom.js'

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

/** 另一版正文，用聊天页自己的 markdown 渲染，读起来和正常回复一样。 */
function AlternateBlock({ text, header }: { text: string, header: string }): ReactNode {
  return h('div', { style: { padding: '2px 0 8px' } }, [
    h('div', {
      key: 'label',
      style: { fontSize: '12px', color: '#8a6d00', marginBottom: '6px' },
    }, header),
    h(MarkdownText, { key: 'body', text, labels: LABELS }),
  ])
}

/** 另一版是什么，按用途起个名字。 */
function headerOf(match: VersionMatch): string {
  if (match.alternateIsOriginal) return '模型原来写的版本'
  if (match.alternateRejected) return '模型改写的版本（没有采用，页面上用的是原文）'
  if (match.alternateDryRun) return '模型改写的版本（只检查，没有替换）'
  return '模型改写的版本'
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
  const [match, setMatch] = useState<VersionMatch | null>(null)
  const [showAlternate, setShowAlternate] = useState(false)
  const [holder, setHolder] = useState<HTMLElement | null>(null)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const flowRef = useRef<HTMLElement | null>(null)

  // 正文和记录里的某一版一字不差，说明这条回复被改写器动过，才给开关。
  useEffect(() => {
    if (text.length === 0) return
    let alive = true
    void loadRecords(sessionId).then((records) => {
      if (!alive) return
      const hit = matchVersion(records, text)
      if (hit !== undefined) setMatch(hit)
    })
    return () => { alive = false }
  }, [text, sessionId])

  // 在正文那一行里先占一个位置，用来放另一版。
  useEffect(() => {
    if (match === null || rootRef.current === null) return
    ensureStyle()
    const tail = flowItemOf(rootRef.current)
    if (tail === null) return
    const flow = closingAssistantItem(tail)
    if (flow === null) return
    const node = placeAlternate(flow)
    flowRef.current = flow
    setHolder(node)
    return () => {
      removeAlternate(flow, node)
      flowRef.current = null
    }
  }, [match])

  // 开关一动，就把这一行在页面现在显示的那版和另一版之间换过来。
  useEffect(() => {
    const flow = flowRef.current
    if (flow === null || holder === null) return
    applyAlternate(flow, holder, showAlternate)
  }, [showAlternate, holder])

  if (match === null) return null
  // 按钮上写的是点一下会看到哪一版；切过去之后写的是怎么切回来。
  const alternateName = match.alternateIsOriginal ? '原版' : '改写版'
  const pageName = match.alternateIsOriginal ? '改写版' : '原版'
  const title = showAlternate
    ? (match.alternateIsOriginal ? '切回改写后的版本' : '切回页面原来显示的那版')
    : (match.alternateIsOriginal
      ? '看模型原来写的版本'
      : (match.alternateRejected ? '这一版没有采用，点一下看它长什么样' : '点一下看改写后的版本'))
  return h('span', { ref: rootRef, style: { display: 'inline-flex', alignItems: 'center' } }, [
    h('button', {
      key: 'button',
      type: 'button',
      onClick: () => setShowAlternate(value => !value),
      title,
      style: {
        cursor: 'pointer',
        padding: '1px 8px',
        borderRadius: '10px',
        fontSize: '12px',
        lineHeight: '18px',
        marginLeft: '8px',
        border: '1px solid ' + (showAlternate ? '#d9a400' : '#d0d5dd'),
        background: showAlternate ? '#fff8e1' : '#fff',
        color: showAlternate ? '#8a6d00' : '#5b6169',
      },
    }, showAlternate ? pageName : alternateName),
    holder === null ? null : createPortal(h(AlternateBlock, { text: match.alternate, header: headerOf(match) }), holder),
  ])
}

/** 操作行里的一项：给被改写器动过的回复加一个看另一版的开关。 */
export function StyleGuardAction(props: ToggleProps): ReactNode {
  const { messageId, sessionId = '', useChat } = props
  if (typeof messageId !== 'string' || typeof useChat !== 'function') return null
  return h(Toggle, { messageId, sessionId, useChat })
}
