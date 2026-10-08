import type { SessionMessage as Msg } from 'claude-code'

export type MicroCompactStats = {
  elided: number
  /** Characters of Read results and (tiny) Write/Edit payloads replaced by placeholders */
  chars: number
  thinkingDropped: number
  /** Write and Edit payloads elided (tiny only), one per call however many fields */
  writesElided: number
}

export type CompactOptions = {
  /** Also elide what Write and Edit calls carry: `content`, `old_string`, `new_string` */
  tiny?: boolean
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

// The bulky fields of each call that tiny elides
const PAYLOADS: Record<string, readonly string[]> = {
  Write: ['content'],
  Edit: ['old_string', 'new_string'],
}

// What a Write or Edit result appends, as seen in a spike (2.1.294); false once the payload is elided
const STATE_NOTE = /\s*\(file state is current in your context[^)]*\)/

const lineCount = (s: string) => s.split('\n').length - (s.endsWith('\n') ? 1 : 0)

/**
 * The input with each payload field replaced by a placeholder, or null when none is
 * longer than its placeholder (short strings, earlier placeholders)
 */
function elidePayload(
  fields: readonly string[],
  input: Record<string, unknown>,
): { input: Record<string, unknown>; chars: number } | null {
  let out: Record<string, unknown> | null = null
  let chars = 0
  for (const f of fields) {
    const v = input[f]
    if (typeof v !== 'string' || PLACEHOLDER.test(v)) continue
    const n = lineCount(v)
    const text = `[${f}${MARKER}${n} line${n === 1 ? '' : 's'}. Read the file if needed.]`
    if (v.length <= text.length) continue
    out ??= { ...input }
    out[f] = text
    chars += v.length
  }
  return out && { input: out, chars }
}

// Thinking blocks come as assistant messages of their own (one transcript entry per block),
// which read as no text and no tool uses
function isThinkingOnly(m: Msg): boolean {
  return m.role === 'assistant' && !m.text && m.toolUses.length === 0
}

/**
 * Elides the results of Read calls and drops thinking; with `tiny`, also the payloads of
 * Write and Edit calls. Every other message keeps its handle, so the engine keeps it whole;
 * a message holding an elided result or payload is rebuilt.
 */
export function microCompact(
  messages: readonly Msg[],
  { tiny = false }: CompactOptions = {},
): { messages: Msg[]; stats: MicroCompactStats } {
  const reads = new Map<string, Record<string, unknown>>()
  // Write and Edit calls whose payload is elided, by id, with their new input and the chars saved
  const writes = new Map<string, { input: Record<string, unknown>; chars: number }>()
  for (const m of messages)
    for (const u of m.toolUses) {
      if (u.tool === 'Read') reads.set(u.tool_use_id, u.input)
      const fields = tiny ? PAYLOADS[u.tool] : undefined
      const elided = fields && elidePayload(fields, u.input)
      if (elided) writes.set(u.tool_use_id, elided)
    }

  const stats: MicroCompactStats = { elided: 0, chars: 0, thinkingDropped: 0, writesElided: 0 }
  const out: Msg[] = []
  for (const m of messages) {
    if (isThinkingOnly(m)) {
      stats.thinkingDropped++
      continue
    }
    let changed = false
    const toolUses = m.toolUses.map(u => {
      const elided = writes.get(u.tool_use_id)
      if (!elided) return u
      changed = true
      stats.writesElided++
      stats.chars += elided.chars
      return { ...u, input: elided.input }
    })
    const toolResults = m.toolResults?.map(r => {
      if (writes.has(r.tool_use_id)) {
        // The content is gone from the context, so the result must not say otherwise
        const text = r.text.replace(STATE_NOTE, '')
        if (text === r.text) return r
        changed = true
        return { tool_use_id: r.tool_use_id, isError: r.isError, text }
      }
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
    out.push({ ...rest, toolUses, ...(toolResults && { toolResults }) })
  }
  return { messages: out, stats }
}
