/**
 * 检查与改写。一轮就是先审一遍、再按意见改一遍；两轮就是把这件事再做一次。
 * 任何一步失败都返回手上已有的版本，绝不抛给调用方。
 */
import { preservesFacts } from './guard.js'

export interface Critique {
  problems: string[]
  verdict: string
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
  rejected?: { missing: string[] }
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
  const notes: string[] = []
  for (let round = 0; round < rounds; round++) {
    if (deps.now() >= deadline) {
      notes.push('时间到了，停止检查')
      break
    }
    const critique = await deps.critique(current)
    if (!critique) {
      notes.push('审查没有返回结果')
      break
    }
    if (critique.problems.length === 0) {
      notes.push('没有发现问题')
      break
    }
    problems.push(...critique.problems)
    const rewritten = await deps.rewrite(current, critique)
    if (!rewritten || rewritten === current) {
      notes.push('改写没有返回新文本')
      break
    }
    const facts = preservesFacts(original, rewritten)
    if (!facts.ok) {
      notes.push('改写动了事实，整段作废')
      return { text: current, roundsRun, problems, rejected: { missing: facts.missing }, notes }
    }
    current = rewritten
    roundsRun = round + 1
  }
  return { text: current, roundsRun, problems, notes }
}
