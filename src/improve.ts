/**
 * 检查与改写。一轮就是先审一遍、再按意见改一遍；两轮就是把这件事再做一次。
 * 任何一步失败都返回手上已有的版本，绝不抛给调用方。
 */
import { preservesFacts } from './guard.js'

export interface Critique {
  problems: string[]
  verdict: string
  /** 检查模型判断用户这一轮是不是在问一个数量。没给判断时是 undefined。 */
  asksNumber?: boolean
  /** 模型返回的东西读不成 JSON 时，这里放它的开头，用于排查。 */
  unreadable?: string
}

export interface ImproveDeps {
  critique: (text: string) => Promise<Critique | undefined>
  rewrite: (text: string, critique: Critique) => Promise<string | undefined>
  now: () => number
}

export interface ImproveResult {
  text: string
  roundsRun: number
  problems: string[]
  /** 被事实核对拦下的那一版改写。留档用，让面板能把它和原文并排展示。 */
  rejected?: { missing: string[] }
  rejectedText?: string
  /** 采纳了，但改写时没保住的代码名字。不挡路，只记账。 */
  softMissing: string[]
  /** 采纳了，改写时删掉的数字。用户没问数量时允许删，只记账。 */
  droppedNumbers: string[]
  /** 检查那一步返回的内容读不出来时，它的开头。 */
  critiqueRaw?: string
  notes: string[]
}

/** 反复审改到没问题、到轮次上限、或到时间上限为止。 */
export async function improve(
  original: string,
  rounds: number,
  deadline: number,
  deps: ImproveDeps,
  question = '',
): Promise<ImproveResult> {
  let current = original
  let roundsRun = 0
  const problems: string[] = []
  const softMissing: string[] = []
  const droppedNumbers: string[] = []
  const notes: string[] = []
  let critiqueRaw: string | undefined
  // 用户在不在问数量，按第一轮检查的判断，后面几轮沿用
  let asksNumber: boolean | undefined
  // 最后交出去的那一版丢了代码名字的话，说明里提一句。放在收尾统一做，免得两轮各记一次
  const softNote = (): string[] => softMissing.length > 0
    ? [...notes, '这一版把 ' + softMissing.length + ' 个代码里的名字写没了，其余一致，仍然采用']
    : notes
  for (let round = 0; round < rounds; round++) {
    if (deps.now() >= deadline) {
      notes.push('时间到了，停止检查')
      break
    }
    const critique = await deps.critique(current)
    if (!critique) {
      notes.push('检查那一步没有返回内容')
      break
    }
    if (critique.unreadable !== undefined) {
      notes.push('检查那一步返回的内容读不出来，这一轮原文照发')
      critiqueRaw = critique.unreadable
      break
    }
    if (critique.problems.length === 0) {
      notes.push('没有发现问题')
      break
    }
    if (asksNumber === undefined) asksNumber = critique.asksNumber
    problems.push(...critique.problems)
    const rewritten = await deps.rewrite(current, { ...critique, asksNumber })
    if (!rewritten) {
      notes.push('改写没有返回内容')
      break
    }
    if (rewritten === current) {
      notes.push('改写交回来的和原文一模一样，等于没改')
      break
    }
    // 改写到一半被截断的话，后半段内容会整段消失，这里拦住
    if (original.length > 200 && rewritten.length < original.length * 0.5) {
      notes.push('改写比原文短了一半以上，怕丢内容，作废')
      return {
        text: current,
        roundsRun,
        problems,
        rejectedText: rewritten,
        softMissing,
        droppedNumbers,
        notes: softNote(),
      }
    }
    const facts = preservesFacts(original, rewritten, question, asksNumber)
    if (!facts.ok) {
      const why = facts.invented.length > 0 ? '改写里出现了原文没有的数字' : '你问的就是数量，改写却删了数字'
      notes.push(roundsRun === 0 ? why + '，整段作废' : why + '，后一轮作废，保留前一轮的结果')
      return {
        text: current,
        roundsRun,
        problems,
        rejected: { missing: facts.hard },
        rejectedText: rewritten,
        softMissing,
        droppedNumbers,
        notes: softNote(),
      }
    }
    // 两轮都拿原文比，同一个名字会报两次，只留最新一轮的结果
    softMissing.splice(0, softMissing.length, ...facts.soft)
    // 第二轮是在第一轮的基础上改，比较的对象始终是原文，所以同一个数字两轮都会报，去重
    droppedNumbers.splice(0, droppedNumbers.length, ...facts.dropped)
    current = rewritten
    roundsRun = round + 1
  }
  return { text: current, roundsRun, problems, softMissing, droppedNumbers, critiqueRaw, notes: softNote() }
}
