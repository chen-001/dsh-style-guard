/**
 * 检查与改写。一轮就是先审一遍、再按意见改一遍；两轮就是把这件事再做一次。
 * 任何一步失败都返回手上已有的版本，绝不抛给调用方。
 */
import { preservesFacts } from './guard.js'

export interface Critique {
  problems: string[]
  verdict: string
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
): Promise<ImproveResult> {
  let current = original
  let roundsRun = 0
  const problems: string[] = []
  const softMissing: string[] = []
  const notes: string[] = []
  let critiqueRaw: string | undefined
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
    problems.push(...critique.problems)
    const rewritten = await deps.rewrite(current, critique)
    if (!rewritten) {
      notes.push('改写没有返回内容')
      break
    }
    if (rewritten === current) {
      notes.push('改写交回来的和原文一模一样，等于没改')
      break
    }
    const facts = preservesFacts(original, rewritten)
    if (!facts.ok) {
      notes.push(roundsRun === 0
        ? '改写动了数字、路径这类要紧的东西，整段作废'
        : '后一轮改的动了要紧的东西，作废，保留前一轮的结果')
      return {
        text: current,
        roundsRun,
        problems,
        rejected: { missing: facts.hard },
        rejectedText: rewritten,
        softMissing,
        notes,
      }
    }
    if (facts.soft.length > 0) {
      softMissing.push(...facts.soft)
      notes.push('这一版把 ' + facts.soft.length + ' 个代码里的名字写没了，其余一致，仍然采用')
    }
    current = rewritten
    roundsRun = round + 1
  }
  return { text: current, roundsRun, problems, softMissing, critiqueRaw, notes }
}
