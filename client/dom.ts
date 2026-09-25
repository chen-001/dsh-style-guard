/**
 * 让「原版 / 改写版」开关落到页面上的几个小动作。
 *
 * 聊天页把每条回复渲染成一行，行上有 data-chat-flow-key 这样的标记；
 * 一轮结束时那行操作行是单独的一行，正文在它前面。这里只做两件事：
 * 从操作行找到这一轮收尾的正文行，以及把另一版塞进那一行、盖住页面现在显示的那版。
 * 和 React 无关，好单独测。
 */

/** 记录里用得上的字段。 */
export interface GuardRecord {
  original: string
  rewritten: string
  rejectedText?: string
  dryRun?: boolean
}

/** 这条回复在页面上显示的是哪一版，以及点一下会换成哪一版。 */
export interface VersionMatch {
  /** 点一下会换成的那一版正文。 */
  alternate: string
  /** 换过去的是原版（说明页面现在显示的是改写版）。 */
  alternateIsOriginal: boolean
  /** 换过去的那版没被采用。 */
  alternateRejected: boolean
  /** 换过去的那版只是检查过，没有真的替换。 */
  alternateDryRun: boolean
}

/** 切到另一版时隐藏同一条回复里的其它内容。 */
const SWAP_ATTR = 'data-style-guard-swap'
const HOLDER_ATTR = 'data-style-guard-swap-block'
const STYLE_ID = 'dsh-style-guard-swap-style'

/** 样式只注入一次；没有 document（例如测试环境外）就什么都不做。 */
export function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = '[' + SWAP_ATTR + '="1"] > :not([' + HOLDER_ATTR + ']){display:none !important}'
  document.head.appendChild(style)
}

/** 从操作行往上找到它所在的那一行。 */
export function flowItemOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[data-chat-flow-key]')
}

/**
 * 一条回复的正文行：从这一轮的操作行往前找最近的那条助手回复。
 * 同一轮里可能有中途说话的助手行，也可能有单独的思考行，
 * 最近的那条收尾回复才是要换的那条。
 */
export function closingAssistantItem(tail: Element): HTMLElement | null {
  const turn = tail.getAttribute('data-chat-turn')
  let candidate: HTMLElement | null = null
  let el = tail.previousElementSibling
  while (el !== null) {
    const elTurn = el.getAttribute('data-chat-turn')
    if (turn !== null && elTurn !== null && elTurn !== turn) break
    if (el.getAttribute('data-chat-flow-kind') === 'assistant-step') {
      const part = el.getAttribute('data-chat-group-part')
      if (part === null || part === 'response') return el as HTMLElement
      candidate = el as HTMLElement
    }
    el = el.previousElementSibling
  }
  return candidate
}

/** 在这一行里放一个位置给另一版，默认先藏着。 */
export function placeAlternate(flow: HTMLElement): HTMLElement {
  const holder = document.createElement('div')
  holder.setAttribute(HOLDER_ATTR, '')
  holder.style.display = 'none'
  flow.insertBefore(holder, flow.firstChild)
  return holder
}

/** 换还是不换：换的时候把这一行标上记号，另一版那个位置露出来。 */
export function applyAlternate(flow: HTMLElement, holder: HTMLElement, on: boolean): void {
  if (on) {
    flow.setAttribute(SWAP_ATTR, '1')
    holder.style.display = ''
  } else {
    flow.removeAttribute(SWAP_ATTR)
    holder.style.display = 'none'
  }
}

/** 收摊：把记号抹掉，把位置撤走。 */
export function removeAlternate(flow: HTMLElement, holder: HTMLElement): void {
  flow.removeAttribute(SWAP_ATTR)
  holder.remove()
}

/**
 * 记录里有没有和这段正文对得上的那一版，对上了给出能换的那一版。
 *
 * 两种情形都要管：
 * - 页面显示的是采纳后的改写版，能换的是原版；
 * - 页面显示的是原文（改写没被采纳，或者只是检查没替换），能换的是改写版。
 * 记录里两版都没有（本来就没改）就不给按钮。
 */
export function matchVersion(records: readonly GuardRecord[], text: string): VersionMatch | undefined {
  if (text.length === 0) return undefined
  for (const item of records) {
    if (typeof item.rewritten !== 'string' || item.rewritten !== text || item.rewritten.length === 0) continue
    if (typeof item.original !== 'string' || item.original.length === 0 || item.original === item.rewritten) continue
    return { alternate: item.original, alternateIsOriginal: true, alternateRejected: false, alternateDryRun: false }
  }
  for (const item of records) {
    if (typeof item.original !== 'string' || item.original !== text || item.original.length === 0) continue
    const adopted = typeof item.rewritten === 'string' && item.rewritten.length > 0 ? item.rewritten : ''
    const rejected = typeof item.rejectedText === 'string' && item.rejectedText.length > 0 ? item.rejectedText : ''
    const alternate = adopted.length > 0 ? adopted : rejected
    if (alternate.length === 0 || alternate === text) continue
    return {
      alternate,
      alternateIsOriginal: false,
      alternateRejected: adopted.length === 0,
      alternateDryRun: item.dryRun === true,
    }
  }
  return undefined
}
