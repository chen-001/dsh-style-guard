/**
 * 让「原版 / 改写版」开关落到页面上的几个小动作。
 *
 * 聊天页把每条回复渲染成一行，行上有 data-chat-flow-key 这样的标记；
 * 一轮结束时那行操作行是单独的一行，正文在它前面。这里只做两件事：
 * 从操作行找到这一轮收尾的正文行，以及把原版塞进那一行、盖住改写版。
 * 和 React 无关，好单独测。
 */

/** 记录里用得上的两个字段。 */
export interface GuardRecord {
  original: string
  rewritten: string
}

/** 切到原版时隐藏同一条回复里的其它内容。 */
const ORIGINAL_ATTR = 'data-style-guard-original'
const HOLDER_ATTR = 'data-style-guard-original-block'
const STYLE_ID = 'dsh-style-guard-original-style'

/** 样式只注入一次；没有 document（例如测试环境外）就什么都不做。 */
export function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = '[' + ORIGINAL_ATTR + '="1"] > :not([' + HOLDER_ATTR + ']){display:none !important}'
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

/** 在这一行里放一个位置给原版，默认先藏着。 */
export function placeOriginal(flow: HTMLElement): HTMLElement {
  const holder = document.createElement('div')
  holder.setAttribute(HOLDER_ATTR, '')
  holder.style.display = 'none'
  flow.insertBefore(holder, flow.firstChild)
  return holder
}

/** 换还是不换：换的时候把这一行标上记号，原版那个位置露出来。 */
export function applyOriginal(flow: HTMLElement, holder: HTMLElement, on: boolean): void {
  if (on) {
    flow.setAttribute(ORIGINAL_ATTR, '1')
    holder.style.display = ''
  } else {
    flow.removeAttribute(ORIGINAL_ATTR)
    holder.style.display = 'none'
  }
}

/** 收摊：把记号抹掉，把位置撤走。 */
export function removeOriginal(flow: HTMLElement, holder: HTMLElement): void {
  flow.removeAttribute(ORIGINAL_ATTR)
  holder.remove()
}

/** 记录里有没有和这段正文一字不差的改写版。有就返回那条记录。 */
export function matchRecord(records: readonly GuardRecord[], text: string): GuardRecord | undefined {
  if (text.length === 0) return undefined
  return records.find(item => typeof item.rewritten === 'string'
    && item.rewritten === text && item.rewritten.length > 0)
}
