/**
 * 客户端开关的离线自测：在 jsdom 里搭出聊天页的行结构，
 * 验证「找到收尾正文行」「放进另一版」「换过去再换回来」，
 * 以及「采纳的回复换原版」「没采纳的回复换改写版」这两类匹配。
 * 不调用模型、不连浏览器。运行：npm run test:client
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  applyAlternate, closingAssistantItem, ensureStyle, flowItemOf, matchVersion, placeAlternate, removeAlternate,
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
check('样式只注入一次', document.querySelectorAll('#dsh-style-guard-swap-style').length === 1)
check('样式含隐藏规则', (document.getElementById('dsh-style-guard-swap-style')?.textContent ?? '')
  .includes('display:none !important'))

const holder = placeAlternate(response as HTMLElement)
check('另一版放在正文行最前面', (response as HTMLElement).firstElementChild === holder)
check('另一版默认藏着', holder.style.display === 'none')

applyAlternate(response as HTMLElement, holder, true)
check('切过去：行上打了记号', (response as HTMLElement).getAttribute('data-style-guard-swap') === '1')
check('切过去：另一版露出来', holder.style.display === '')

applyAlternate(response as HTMLElement, holder, false)
check('切回来：记号抹掉', (response as HTMLElement).getAttribute('data-style-guard-swap') === null)
check('切回来：另一版藏回去', holder.style.display === 'none')

removeAlternate(response as HTMLElement, holder)
check('收摊：位置撤走', holder.parentElement === null)
check('收摊：记号不留', (response as HTMLElement).getAttribute('data-style-guard-swap') === null)
check('收摊：正文原样还在', (response as HTMLElement).querySelector('.md')?.textContent === '改写后的正文')

// 采纳的回复：页面显示改写版，能换的是原版
const adopted = matchVersion([{ original: '原来写的', rewritten: '改写后的正文' }], '改写后的正文')
check('采纳的回复：换到原版', adopted !== undefined && adopted.alternate === '原来写的'
  && adopted.alternateIsOriginal === true)
check('采纳的回复：不匹配别的正文', matchVersion([{ original: '原来写的', rewritten: '改写后的正文' }], '别的一段话') === undefined)

// 没采纳的回复：页面显示原文，能换的是被驳回的改写版
const rejected = matchVersion(
  [{ original: '原文', rewritten: '', rejectedText: '被驳回的改写', dryRun: false }], '原文')
check('没采纳的回复：换到被驳回的改写版', rejected !== undefined && rejected.alternate === '被驳回的改写'
  && rejected.alternateIsOriginal === false && rejected.alternateRejected === true)

// 只检查没替换的回复：页面显示原文，能换的是改写版
const dry = matchVersion([{ original: '原文', rewritten: '改写的版本', dryRun: true }], '原文')
check('只检查没替换：换到改写版', dry !== undefined && dry.alternate === '改写的版本'
  && dry.alternateDryRun === true && dry.alternateRejected === false)

// 本来就没改的回复：两版都没有，不给按钮
check('本来就没改：不给按钮', matchVersion([{ original: '原文', rewritten: '' }], '原文') === undefined)
check('空正文不匹配', matchVersion([{ original: '原文', rewritten: '改写的版本' }], '') === undefined)
check('两版一样也不给按钮', matchVersion([{ original: '一样', rewritten: '一样' }], '一样') === undefined)

console.log(failed === 0 ? '全部通过' : failed + ' 项失败')
process.exit(failed === 0 ? 0 : 1)
