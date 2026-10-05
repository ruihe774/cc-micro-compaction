import type { SessionMessage as Msg } from 'claude-code'

export type MicroCompactStats = {
  elided: number
  /** Characters of Read result text replaced by placeholders */
  chars: number
  thinkingDropped: number
}

const MARKER = ' elided by compaction: '
const AGAIN = '. Read it again if needed.]'
// Any of our placeholders, so a second pass leaves them be
const PLACEHOLDER = /^\[[^\]\n]* elided by compaction: /

// Read numbers its output as `   12\tline`; the first and last numbers give the range read
const LINE_NO = /^\s*(\d+)\t/

const pathOf = (input: Record<string, unknown>) => (typeof input.file_path === 'string' ? input.file_path : 'unknown file')

function describeText(input: Record<string, unknown>, text: string): string {
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
  return `[file contents${MARKER}${pathOf(input)}${range}${AGAIN}`
}

/**
 * The placeholder for a Read whose bulk is an image or document block rather than text
 * (`result.type` image, pdf, or parts: PDF pages rendered as images), or null for any other.
 * Their `text` is empty or a one-line note, so length says nothing about their size.
 */
function describeMedia(input: Record<string, unknown>, result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { type?: unknown; file?: any; firstPage?: unknown }
  const path = pathOf(input)
  switch (r.type) {
    case 'image': {
      const d = r.file?.dimensions
      const size = d?.originalWidth && d?.originalHeight ? `, ${d.originalWidth}x${d.originalHeight}` : ''
      return `[image${MARKER}${path}${size}${AGAIN}`
    }
    case 'pdf':
      return `[PDF${MARKER}${path}${AGAIN}`
    case 'parts': {
      const first = typeof r.firstPage === 'number' ? r.firstPage : null
      const count = typeof r.file?.count === 'number' ? r.file.count : null
      const pages =
        typeof input.pages === 'string' ? input.pages : first !== null && count !== null ? `${first}-${first + count - 1}` : null
      return `[PDF pages${MARKER}${path}${pages ? `, pages ${pages}` : ''}${AGAIN}`
    }
    default:
      return null
  }
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

  const stats: MicroCompactStats = { elided: 0, chars: 0, thinkingDropped: 0 }
  const out: Msg[] = []
  for (const m of messages) {
    if (isThinkingOnly(m)) {
      stats.thinkingDropped++
      continue
    }
    let changed = false
    const toolResults = m.toolResults?.map(r => {
      const input = reads.get(r.tool_use_id)
      if (!input || r.isError || PLACEHOLDER.test(r.text)) return r
      let text = describeMedia(input, r.result)
      if (text === null) {
        text = describeText(input, r.text)
        // Already short (an "unchanged since last read" stub, a tiny file)
        if (r.text.length <= text.length) return r
      }
      changed = true
      stats.elided++
      stats.chars += r.text.length
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
