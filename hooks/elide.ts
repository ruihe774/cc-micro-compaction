import type { SessionMessage as Msg } from 'claude-code'

export type MicroCompactStats = {
  elided: number
  thinkingDropped: number
}

const PREFIX = '[file contents elided by compaction: '

// Read numbers its output as `   12\tline`; the first and last numbers give the range read
const LINE_NO = /^\s*(\d+)\t/

function describeRead(input: Record<string, unknown>, text: string): string {
  const path = typeof input.file_path === 'string' ? input.file_path : 'unknown file'
  let first: number | null = null
  let last: number | null = null
  for (const line of text.split('\n')) {
    const m = LINE_NO.exec(line)
    if (!m) continue
    const n = Number(m[1])
    first ??= n
    last = n
  }
  const range = first === null ? '' : first === 1 ? `, ${last} lines` : `, lines ${first}-${last}`
  return `${PREFIX}${path}${range}. Read it again if needed.]`
}

// Thinking blocks come as assistant messages of their own (one transcript entry per block),
// which read as no text and no tool uses
function isThinkingOnly(m: Msg): boolean {
  return m.role === 'assistant' && !m.text && m.toolUses.length === 0
}

/**
 * Elides the results of Read calls and drops thinking. Every other message keeps its
 * handle, so the engine keeps it whole; a user message holding an elided result is rebuilt.
 */
export function microCompact(messages: readonly Msg[]): { messages: Msg[]; stats: MicroCompactStats } {
  const reads = new Map<string, Record<string, unknown>>()
  for (const m of messages) for (const u of m.toolUses) if (u.tool === 'Read') reads.set(u.tool_use_id, u.input)

  const stats: MicroCompactStats = { elided: 0, thinkingDropped: 0 }
  const out: Msg[] = []
  for (const m of messages) {
    if (isThinkingOnly(m)) {
      stats.thinkingDropped++
      continue
    }
    let changed = false
    const toolResults = m.toolResults?.map(r => {
      const input = reads.get(r.tool_use_id)
      if (!input || r.isError || r.text.startsWith(PREFIX)) return r
      const text = describeRead(input, r.text)
      // Already short (an image, an "unchanged since last read" stub)
      if (r.text.length <= text.length) return r
      changed = true
      stats.elided++
      return { tool_use_id: r.tool_use_id, isError: r.isError, text }
    })
    if (!changed) {
      out.push(m)
      continue
    }
    const { handle: _, ...rest } = m
    out.push({ ...rest, toolResults })
  }
  return { messages: out, stats }
}
