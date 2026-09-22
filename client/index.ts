/**
 * @dsh-external/dsh-style-guard 客户端半边。
 *
 * 在右侧栏注册一个标签页，展示每一次检查的记录。数据从宿主那边的只读接口取，
 * 客户端读不到文件，也不该读。
 *
 * 注册走延迟注入，老版本没有 sidebarRightTabs 服务时整段跳过，不影响本体。
 */
import { createElement as h, useEffect, useState } from 'react'

export const inject = ['slots']

const TAB_ID = 'dsh-style-guard'
const TAB_KIND = 'dsh-style-guard'
const API = '/dsh-style-guard/api/records?limit=50'

interface Entry {
  ts: string
  chars: number
  ms: number
  roundsRun: number
  applied: boolean
  dryRun: boolean
  notes: string[]
  problems: string[]
  missing: string[]
  original: string
  rewritten: string
}

interface SlotRegistration {
  name: string
  id?: string
  key?: string
  order?: number
}

interface SlotsFace {
  inject: (name: string, callback: () => unknown) => unknown
  register: (registration: SlotRegistration, component: (props: Record<string, unknown>) => unknown) => unknown
}

interface TabsFace {
  register: (definition: {
    id: string
    kind: string
    title: () => string
    guide?: { order: number, title: () => string, description?: () => string }[]
  }) => unknown
}

interface ClientContext {
  slots: SlotsFace
  inject: (deps: string[], callback: (raw: unknown) => unknown) => unknown
  effect: (callback: () => unknown, label?: string) => unknown
}

const CARD: Record<string, string | number> = {
  border: '1px solid #e3e5e8',
  borderRadius: '8px',
  background: '#fff',
  padding: '10px 12px',
  marginBottom: '10px',
}

const MUTED: Record<string, string | number> = { color: '#7a7f87', fontSize: '12px' }

function badge(text: string, color: string, background: string) {
  return h('span', {
    style: {
      display: 'inline-block', padding: '1px 8px', borderRadius: '10px',
      fontSize: '12px', color, background, marginRight: '8px',
    },
  }, text)
}

function statusOf(entry: Entry) {
  if (entry.applied) return badge('已采纳', '#1a7f37', '#e6f4ea')
  if (entry.dryRun) return badge('只检查', '#8a6d00', '#fff8e1')
  if (entry.missing.length > 0) return badge('被驳回', '#b42318', '#fdecea')
  return badge('未改动', '#5b6169', '#f0f1f3')
}

function textBlock(title: string, body: string, tint: string) {
  return h('div', { style: { flex: '1 1 0', minWidth: '0' } }, [
    h('div', { key: 't', style: { ...MUTED, marginBottom: '4px' } }, title),
    h('pre', {
      key: 'b',
      style: {
        margin: '0', padding: '8px', background: tint, borderRadius: '6px',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '260px',
        overflow: 'auto', fontSize: '12px', lineHeight: '1.6',
      },
    }, body || '（空）'),
  ])
}

function detail(entry: Entry) {
  const rows: unknown[] = []
  if (entry.problems.length > 0) {
    rows.push(h('div', { key: 'p', style: { marginBottom: '8px' } }, [
      h('div', { key: 'h', style: { ...MUTED, marginBottom: '4px' } }, '检查发现的问题'),
      h('ol', { key: 'l', style: { margin: '0', paddingLeft: '20px', fontSize: '13px', lineHeight: '1.7' } },
        entry.problems.map((item, index) => h('li', { key: index }, item))),
    ]))
  }
  if (entry.notes.length > 0) {
    rows.push(h('div', { key: 'n', style: { ...MUTED, marginBottom: '8px' } }, '处理结果 ' + entry.notes.join('；')))
  }
  if (entry.missing.length > 0) {
    rows.push(h('div', { key: 'm', style: { marginBottom: '8px', color: '#b42318', fontSize: '13px' } },
      '驳回原因，改写后少了 ' + entry.missing.join('、') + '，整段作废用原文'))
  }
  rows.push(h('div', { key: 'x', style: { display: 'flex', gap: '10px' } }, [
    textBlock('原版', entry.original, '#fafafa'),
    textBlock(entry.rewritten ? '改写后' : '改写后（无，未产生可用的改写）', entry.rewritten, '#f4f8ff'),
  ]))
  return h('div', { key: 'd', style: { marginTop: '10px' } }, rows)
}

function recordCard(entry: Entry, index: number) {
  const time = entry.ts ? new Date(entry.ts).toLocaleString('zh-CN') : ''
  const head = h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' } }, [
    statusOf(entry),
    h('span', { key: 't', style: MUTED }, time),
    h('span', { key: 'c', style: MUTED }, entry.chars + ' 字'),
    h('span', { key: 'm', style: MUTED }, (entry.ms / 1000).toFixed(1) + ' 秒'),
    h('span', { key: 'r', style: MUTED }, entry.roundsRun + ' 轮改写'),
  ])
  return h('details', { key: entry.ts + '-' + index, style: CARD }, [
    h('summary', { key: 's', style: { cursor: 'pointer' } }, head),
    detail(entry),
  ])
}

function Panel(props: { sessionId?: string }) {
  const sessionId = props.sessionId
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [records, setRecords] = useState<Entry[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const url = sessionId ? API + '&session=' + encodeURIComponent(sessionId) : API
    fetch(url)
      .then(response => response.json())
      .then((data: { records?: Entry[] }) => {
        if (!alive) return
        setRecords(Array.isArray(data.records) ? data.records : [])
        setError('')
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setError(String(cause))
        setLoading(false)
      })
    return () => { alive = false }
  }, [tick, sessionId])

  const adopted = records.filter(entry => entry.applied).length
  const rejected = records.filter(entry => !entry.applied && entry.missing.length > 0).length

  return h('div', { style: { padding: '12px', fontFamily: 'system-ui, sans-serif', fontSize: '13px' } }, [
    h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } }, [
      h('div', { key: 'title', style: { fontWeight: 600 } }, '回复风格检查'),
      h('button', {
        key: 'refresh',
        onClick: () => setTick(value => value + 1),
        style: { cursor: 'pointer', padding: '3px 10px', borderRadius: '6px', border: '1px solid #d0d5dd', background: '#fff' },
      }, '刷新'),
    ]),
    h('div', { key: 'stat', style: { ...MUTED, marginBottom: '10px' } },
      (sessionId ? '本会话 ' : '未取到会话编号，显示全部会话的 ') + records.length + ' 次，采纳 ' + adopted + '，驳回 ' + rejected),
    error ? h('div', { key: 'err', style: { color: '#b42318' } }, '读取失败 ' + error) : null,
    loading ? h('div', { key: 'load', style: MUTED }, '读取中…') : null,
    records.length === 0 && !loading ? h('div', { key: 'empty', style: MUTED }, '还没有记录。') : null,
    h('div', { key: 'list' }, records.map(recordCard)),
  ])
}

export function apply(ctx: ClientContext): void {
  try {
    ctx.inject(['sidebarRightTabs'], (raw: unknown) => {
      const injected = raw as { sidebarRightTabs?: TabsFace }
      const tabs = injected.sidebarRightTabs
      if (!tabs || typeof tabs.register !== 'function') return
      const disposers: (() => void)[] = []
      const own = (result: unknown): void => {
        if (typeof result === 'function') disposers.push(result as () => void)
      }
      try {
        own(tabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => '风格检查',
          guide: [{
            order: 30,
            title: () => '风格检查',
            description: () => '看每次回复被检查、改写与采纳的记录',
          }],
        }))
        own(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: TAB_ID },
          (props: Record<string, unknown>) => h(Panel, {
            sessionId: typeof props.sessionId === 'string' ? props.sessionId : undefined,
          }),
        )))
      } catch {
        for (const dispose of disposers) dispose()
        return
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    })
  } catch {
    /* 右侧栏不可用时整个面板缺席，本体照常工作 */
  }
}
