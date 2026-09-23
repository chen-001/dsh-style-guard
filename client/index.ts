/**
 * @dsh-external/dsh-style-guard 客户端半边。
 *
 * 在右侧栏注册一个标签页，展示每一次检查的记录。数据从宿主那边的只读接口取，
 * 客户端读不到文件，也不该读。
 *
 * 注册走延迟注入，老版本没有 sidebarRightTabs 服务时整段跳过，不影响本体。
 */
import { createElement as h, useEffect, useState } from 'react'
import { riskySentences, splitSentences } from '../src/textdiff.js'

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
  softMissing: string[]
  droppedNumbers: string[]
  critiqueRaw: string
  original: string
  rewritten: string
  rejectedText: string
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

/** 把正文里指定的词标出来，用在原文那一栏，指出改写版把哪些词丢了。 */
function withHighlights(text: string, tokens: string[]) {
  const usable = tokens.filter(token => token.length > 0)
  if (usable.length === 0) return [h('span', { key: 'plain' }, text)]
  const escaped = usable.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  let parts: string[]
  try {
    parts = text.split(new RegExp('(' + escaped.join('|') + ')', 'g'))
  } catch {
    return [h('span', { key: 'plain' }, text)]
  }
  return parts.map((part, index) => usable.includes(part)
    ? h('mark', { key: index, style: { background: '#ffe0e0', color: '#b42318', padding: '0 2px', borderRadius: '3px' } }, part)
    : h('span', { key: index }, part))
}

/** 改写后的正文，把和原文对不上的句子底色标出来。 */
function withRiskyMarks(text: string, risky: number[]) {
  return splitSentences(text).map((sentence, index) => risky.includes(index)
    ? h('span', {
      key: index,
      title: '这句在原文里找不到对应，可能是新写的或改动很大，请对照原文',
      style: { background: '#fff1c2', borderRadius: '3px', padding: '0 1px' },
    }, sentence)
    : h('span', { key: index }, sentence))
}

function textBlock(title: string, children: unknown, tint: string) {
  return h('div', { style: { flex: '1 1 0', minWidth: '0' } }, [
    h('div', { key: 't', style: { ...MUTED, marginBottom: '4px' } }, title),
    h('pre', {
      key: 'b',
      style: {
        margin: '0', padding: '8px', background: tint, borderRadius: '6px',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '260px',
        overflow: 'auto', fontSize: '12px', lineHeight: '1.6',
      },
    }, children),
  ])
}

function plain(text: string) {
  return [h('span', { key: 'plain' }, text || '（空）')]
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

  // 驳回的那一版也拿出来展示，只是要标明哪里不能照抄
  const rejectedOnly = entry.rewritten.length === 0 && entry.rejectedText.length > 0
  const shown = entry.rewritten.length > 0 ? entry.rewritten : entry.rejectedText

  // 检查那一步返回的东西读不出来时，把它开头原样放出来，方便排查
  if (entry.critiqueRaw) {
    rows.push(h('div', {
      key: 'raw',
      style: { marginBottom: '8px', padding: '8px 10px', borderRadius: '6px', background: '#f5f6f8', fontSize: '12px', lineHeight: '1.6' },
    }, [
      h('div', { key: 't', style: { ...MUTED, marginBottom: '4px' } }, '检查那一步返回的内容读不出来，它的开头是'),
      h('pre', { key: 'b', style: { margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '160px', overflow: 'auto' } }, entry.critiqueRaw),
    ]))
  }

  // 改写没产出时，把原因说清楚，别让人以为是没检查
  if (!shown && entry.problems.length > 0) {
    rows.push(h('div', {
      key: 'why',
      style: { marginBottom: '8px', padding: '8px 10px', borderRadius: '6px', background: '#f5f6f8', fontSize: '13px', lineHeight: '1.7' },
    }, '检查列出了上面的问题，但没有可用的改写版本，页面上用的还是原文。原因见下面的处理结果。'))
  }

  // 没被采用的改写丢了什么，一律列出来，旧记录没有存档也照样列
  if (entry.missing.length > 0) {
    rows.push(h('div', {
      key: 'm',
      style: { marginBottom: '8px', color: '#b42318', fontSize: '13px', lineHeight: '1.7' },
    }, '这一版的数字对不上，因此没有采用：' + entry.missing.join('、')
      + '。要么是改写里多出了原文没有的数，要么是你问的就是数量它却删了。'))
  }

  // 采纳了但丢了代码名字的，单独提一句，不影响使用
  if (entry.softMissing.length > 0) {
    rows.push(h('div', {
      key: 'sm',
      style: { marginBottom: '8px', color: '#8a6d00', fontSize: '13px', lineHeight: '1.7' },
    }, '这一版已经采用，只是原文里的这些名字没保留：' + entry.softMissing.join('、')
      + '。路径、文件名和代码里的代号都算这一类，不影响你读，需要照着改文件时看原文那一栏。'))
  }

  // 采纳了但删了数字的，也提一句。你没问数量时，常规检查里的数字允许删
  if (entry.droppedNumbers.length > 0) {
    rows.push(h('div', {
      key: 'dn',
      style: { marginBottom: '8px', color: '#8a6d00', fontSize: '13px', lineHeight: '1.7' },
    }, '这一版已经采用，删掉了原文里的这些数字：' + entry.droppedNumbers.join('、')
      + '。想看具体数的话，看原文那一栏。'))
  }

  if (rejectedOnly) {
    rows.push(h('div', {
      key: 'w',
      style: {
        marginBottom: '8px', padding: '8px 10px', borderRadius: '6px',
        background: '#fff8e1', border: '1px solid #ffe0a3', fontSize: '13px', lineHeight: '1.7',
      },
    }, '这一版改写没有采用，页面上用的还是原文。下面把它整段列出来，原文里对应的词标了红色，改写版里底色发黄的句子在原文里找不到对应，看的时候要对着原文核一遍。'))
  }

  rows.push(h('div', { key: 'x', style: { display: 'flex', gap: '10px' } }, [
    textBlock(
      entry.missing.length > 0 ? '原版（红色是改写版丢掉的词）' : '原版',
      entry.missing.length > 0 ? withHighlights(entry.original, entry.missing) : plain(entry.original),
      '#fafafa',
    ),
    textBlock(
      rejectedOnly ? '改写后（没有采用，黄底句子请对照原文）' : (shown ? '改写后' : '改写后（无，没有产生可用的改写）'),
      rejectedOnly ? withRiskyMarks(shown, riskySentences(entry.original, shown)) : plain(shown),
      rejectedOnly ? '#fffdf5' : '#f4f8ff',
    ),
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
    const url = sessionId ? API + '&session=' + encodeURIComponent(sessionId) : API

    // 后台自己刷。第一次和手动点刷新时显示"读取中"，自动刷不闪这一段。
    const load = (showSpinner: boolean) => {
      if (showSpinner) setLoading(true)
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
    }

    load(true)
    // 每 5 秒取一次，页面不在前台时跳过，省得后台白跑
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load(false)
    }, 5000)
    // 切回这个页面时立刻取一次，不用等下一个 5 秒
    const onWake = () => { if (document.visibilityState === 'visible') load(false) }
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)

    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
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
      (sessionId ? '本会话 ' : '未取到会话编号，显示全部会话的 ') + records.length + ' 次，采纳 ' + adopted + '，驳回 ' + rejected + '，每 5 秒自动刷新'),
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
