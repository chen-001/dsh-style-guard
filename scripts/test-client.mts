/**
 * 客户端开关的离线自测：在 jsdom 里搭出聊天页的行结构，
 * 验证「找到收尾正文行」「放进原版」「换过去再换回来」「记录匹配」这几步。
 * 不调用模型、不连浏览器。运行：npm run test:client
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  applyOriginal, closingAssistantItem, ensureStyle, flowItemOf, matchRecord, placeOriginal, removeOriginal,
} from '../client/dom.ts'

const require = createRequire(import.meta.url)

function jsdomPath(): string {
  if (process.env.DSH_CHECKOUT !== undefined && process.env.DSH_CHECKOUT.length > 0) {
    return join(process.env.DSH_CHECKOUT, 'node_modules/jsdom/lib/api.js')
  }
  for (const candidate of [join(homedir(), 'dsh-harness'), join(homedir(), 'dsh'), join(homedir(), '.dsh/dsh-harness')]) {
    const file = join(candidate, 'node_modules/jsdom/lib/api.js')
    if (existsSync(file)) return file
  }
  throw new Error('test:client 找不到 jsdom（设 DSH_CHECKOUT 指向 dsh 源码目录）')
}

const { JSDOM } = require(jsdomPath()) as { JSDOM: new (html: string) => { window: { document: Document } } }

let failed = 0
function check(name: string, ok: boolean): void {
  if (ok) console.log('PASS ' + name)
  else { failed += 1; console.log('FAIL ' + name) }
}

const dom = new JSDOM(`<!doctype html><html><head></head><body>
<div id="root">
  <div class="flowItem" data-chat-flow-key="n1" data-chat-flow-kind="assistant-step" data-chat-turn="5" data-chat-group-part="reasoning">思考</div>
  <div class="flowItem" data-chat-flow-key="n2" data-chat-flow-kind="assistant-step" data-chat-turn="5" data-chat-group-part="response">
    <div class="md">改写后的正文</div>
  </div>
  <div class="flowItem" data-chat-flow-key="n3" data-chat-flow-kind="turn-tail" data-chat-turn="5">
    <div data-turn-tail="5"><span id="button">原版</span></div>
  </div>
  <div class="flowItem" data-chat-flow-key="n4" data-chat-flow-kind="assistant-step" data-chat-turn="6"></div>
  <div class="flowItem" data-chat-flow-key="n5" data-chat-flow-kind="turn-tail" data-chat-turn="6"><span id="button6">原版</span></div>
</div>
</body></html>`)

const document = dom.window.document as unknown as globalThis.Document
;(globalThis as unknown as { document: unknown }).document = document

const tail = document.getElementById('button') as unknown as Element
const flow = flowItemOf(tail)
check('从操作行找到所在行', flow !== null && flow.getAttribute('data-chat-flow-key') === 'n3')

const response = closingAssistantItem(flow as Element)
check('找到这一轮收尾的正文行（不是思考行）',
  response !== null && response.getAttribute('data-chat-flow-key') === 'n2')

const laterTail = document.getElementById('button6') as unknown as Element
const laterFlow = flowItemOf(laterTail)
const later = closingAssistantItem(laterFlow as Element)
check('下一轮只匹配自己那一行', later !== null && later.getAttribute('data-chat-flow-key') === 'n4')

ensureStyle()
ensureStyle()
check('样式只注入一次', document.querySelectorAll('#' + 'dsh-style-guard-original-style').length === 1)
check('样式含隐藏规则', (document.getElementById('dsh-style-guard-original-style')?.textContent ?? '')
  .includes('display:none !important'))

const holder = placeOriginal(response as HTMLElement)
check('原版位置放在正文行最前面', (response as HTMLElement).firstElementChild === holder)
check('原版位置默认藏着', holder.style.display === 'none')

applyOriginal(response as HTMLElement, holder, true)
check('切到原版：行上打了记号', (response as HTMLElement).getAttribute('data-style-guard-original') === '1')
check('切到原版：原版位置露出来', holder.style.display === '')

applyOriginal(response as HTMLElement, holder, false)
check('切回改写版：记号抹掉', (response as HTMLElement).getAttribute('data-style-guard-original') === null)
check('切回改写版：原版位置藏回去', holder.style.display === 'none')

removeOriginal(response as HTMLElement, holder)
check('收摊：位置撤走', holder.parentElement === null)
check('收摊：记号不留', (response as HTMLElement).getAttribute('data-style-guard-original') === null)
check('收摊：正文原样还在', (response as HTMLElement).querySelector('.md')?.textContent === '改写后的正文')

const record = { original: '原来写的', rewritten: '改写后的正文' }
check('正文对得上就取到记录', matchRecord([record], '改写后的正文') === record)
check('对不上就不给', matchRecord([record], '别的一段话') === undefined)
check('空正文不匹配', matchRecord([record], '') === undefined)
check('没有改写版的记录不算', matchRecord([{ original: 'x', rewritten: '' }], 'x') === undefined)

console.log(failed === 0 ? '全部通过' : failed + ' 项失败')
process.exit(failed === 0 ? 0 : 1)
