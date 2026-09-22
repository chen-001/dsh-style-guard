/**
 * 从审查记录文件里读出要展示的条目。
 * 只读 review 那一种，跳过 tick 和 skip，按时间倒序。
 */
import { readFileSync } from 'node:fs'

/** 面板要展示的一条记录。 */
export interface ReviewEntry {
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

function pick(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function shape(raw: Record<string, unknown>): ReviewEntry {
  const rejected = raw.rejected as { missing?: unknown } | undefined
  return {
    ts: pick(raw.ts, ''),
    chars: typeof raw.chars === 'number' ? raw.chars : 0,
    ms: typeof raw.ms === 'number' ? raw.ms : 0,
    roundsRun: typeof raw.roundsRun === 'number' ? raw.roundsRun : 0,
    applied: raw.applied === true,
    dryRun: raw.dryRun === true,
    notes: strings(raw.notes),
    problems: strings(raw.problems),
    missing: strings(rejected?.missing),
    original: pick(raw.original, ''),
    rewritten: pick(raw.rewritten, ''),
  }
}

/** 读最近的若干条审查记录；文件不存在或者某一行坏了都不影响其余行。 */
export function readRecentReviews(path: string, limit: number): ReviewEntry[] {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n')
  const out: ReviewEntry[] = []
  for (let index = lines.length - 1; index >= 0 && out.length < limit; index--) {
    const line = lines[index]?.trim()
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.kind === 'review') out.push(shape(parsed))
    } catch {
      /* 坏行跳过 */
    }
  }
  return out
}
