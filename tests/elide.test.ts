import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import { microCompact } from '../hooks/elide.ts'

const numbered = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${String(from + i).padStart(6)}\tline ${from + i}`).join('\n')

const read = (id: string, input: Record<string, unknown>, h: string): SessionMessage => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool_use_id: id, tool: 'Read', input }],
  handle: h,
})
const result = (id: string, text: string, h: string, isError = false, record?: unknown): SessionMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: id, text, isError, ...(record === undefined ? {} : { result: record }) }],
  handle: h,
})

const transcript: SessionMessage[] = [
  { role: 'user', text: 'read things', toolUses: [], handle: 'u0' },
  { role: 'assistant', text: '', toolUses: [], handle: 'think1' },
  read('r1', { file_path: '/src/a.ts' }, 'a1'),
  result('r1', numbered(1, 300), 'u1'),
  read('r2', { file_path: '/src/b.ts', offset: 100, limit: 20 }, 'a2'),
  result('r2', numbered(100, 119), 'u2'),
  read('r3', { file_path: '/nope' }, 'a3'),
  result('r3', 'File does not exist. '.repeat(10), 'u3', true),
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b1', tool: 'Bash', input: { command: 'ls' } }], handle: 'a4' },
  result('b1', 'x\n'.repeat(200), 'u4'),
  { role: 'assistant', text: '', toolUses: [], handle: 'think2' },
  { role: 'assistant', text: 'done', toolUses: [], handle: 'a5' },
]

test('Read results are elided with path and line range', () => {
  const { messages } = microCompact(transcript)
  const texts = messages.flatMap(m => m.toolResults ?? []).map(r => r.text)
  expect(texts[0]).toBe('[file contents elided by compaction: /src/a.ts, 300 lines. Read it again if needed.]')
  expect(texts[1]).toBe('[file contents elided by compaction: /src/b.ts, lines 100-119. Read it again if needed.]')
})

test('thinking-only assistant messages are dropped, everything else stays in order', () => {
  const { messages, stats } = microCompact(transcript)
  expect(stats).toEqual({ elided: 2, chars: numbered(1, 300).length + numbered(100, 119).length, thinkingDropped: 2, writesElided: 0 })
  expect(messages.length).toBe(transcript.length - 2)
  expect(messages.map(m => m.handle)).toEqual(['u0', 'a1', undefined, 'a2', undefined, 'a3', 'u3', 'a4', 'u4', 'a5'])
})

test('errored reads, other tools and short results keep their handle and text', () => {
  const short: SessionMessage[] = [read('r', { file_path: '/x' }, 'a'), result('r', '     1\thi', 'u')]
  expect(microCompact(short).messages).toEqual(short)
  const { messages } = microCompact(transcript)
  expect(messages.find(m => m.handle === 'u3')).toBe(transcript[7])
  expect(messages.find(m => m.handle === 'u4')).toBe(transcript[9])
})

test('compacting twice changes nothing more', () => {
  const once = microCompact(transcript).messages
  const twice = microCompact(once)
  expect(twice.messages).toEqual(once)
  expect(twice.stats).toEqual({ elided: 0, chars: 0, thinkingDropped: 0, writesElided: 0 })
})

// Shapes as session.compact delivered them in a spike (2.1.287): the bulk is an image or
// document block, `text` is empty or a one-line note
const media: SessionMessage[] = [
  read('i1', { file_path: '/w/img.png' }, 'a1'),
  result('i1', '', 'u1', false, {
    type: 'image',
    file: { base64: 'AAAA', type: 'image/png', originalSize: 196992, dimensions: { originalWidth: 256, originalHeight: 256 } },
  }),
  read('p1', { file_path: '/w/doc.pdf' }, 'a2'),
  result('p1', 'PDF file read: /w/doc.pdf (1.1KB)', 'u2', false, {
    type: 'pdf',
    file: { filePath: '/w/doc.pdf', base64: 'JVBERi0=', originalSize: 1147 },
  }),
  read('p2', { file_path: '/w/doc.pdf', pages: '2' }, 'a3'),
  result('p2', 'PDF pages extracted: 1 page(s) from /w/doc.pdf (1.1KB)', 'u3', false, {
    type: 'parts',
    file: { filePath: '/w/doc.pdf', originalSize: 1147, count: 1, outputDir: '/o' },
    firstPage: 2,
  }),
  read('p3', { file_path: '/w/doc.pdf' }, 'a4'),
  result('p3', '', 'u4', false, { type: 'parts', file: { filePath: '/w/doc.pdf', originalSize: 1147, count: 3, outputDir: '/o' }, firstPage: 1 }),
  read('n1', { file_path: '/w/same.ts' }, 'a5'),
  result('n1', 'File unchanged since last read.', 'u5', false, { type: 'file_unchanged', file: { filePath: '/w/same.ts' } }),
]

test('images and PDFs are elided whatever their text length', () => {
  const { messages, stats } = microCompact(media)
  expect(stats.elided).toBe(4)
  expect(messages.flatMap(m => m.toolResults ?? []).map(r => r.text)).toEqual([
    '[image elided by compaction: /w/img.png, 256x256. Read it again if needed.]',
    '[PDF elided by compaction: /w/doc.pdf. Read it again if needed.]',
    '[PDF pages elided by compaction: /w/doc.pdf, pages 2. Read it again if needed.]',
    '[PDF pages elided by compaction: /w/doc.pdf, pages 1-3. Read it again if needed.]',
    'File unchanged since last read.',
  ])
  // Rebuilt without the record, so no image or document block can come back
  for (const m of messages.slice(0, 8)) expect(m.handle === undefined).toBe(m.role === 'user')
  expect(messages.flatMap(m => m.toolResults ?? []).slice(0, 4).every(r => r.result === undefined)).toBe(true)
  expect(messages[9]).toBe(media[9])
})

test('media placeholders are left alone on a second pass, even with their record', () => {
  const once = microCompact(media).messages
  // In case the engine hands the record back with the rebuilt result
  const withRecords = once.map((m, i) =>
    m.toolResults ? { ...m, toolResults: m.toolResults.map((r, j) => ({ ...r, result: media[i]!.toolResults![j]!.result })) } : m,
  )
  expect(microCompact(withRecords).stats).toEqual({ elided: 0, chars: 0, thinkingDropped: 0, writesElided: 0 })
})

// Results as Write and Edit returned them in a spike (2.1.294)
const NOTE = ' (file state is current in your context — no need to Read it back)'
const call = (id: string, tool: string, input: Record<string, unknown>, h: string): SessionMessage => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool_use_id: id, tool, input }],
  handle: h,
})
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
const writes: SessionMessage[] = [
  call('w1', 'Write', { file_path: '/w/a.txt', content: lines(40) }, 'a1'),
  result('w1', `File created successfully at: /w/a.txt${NOTE}`, 'u1'),
  call('e1', 'Edit', { file_path: '/w/a.txt', old_string: lines(12), new_string: 'x', replace_all: false }, 'a2'),
  result('e1', `The file /w/a.txt has been updated successfully.${NOTE}`, 'u2'),
  call('e2', 'Edit', { file_path: '/w/a.txt', old_string: '20', new_string: 'twenty' }, 'a3'),
  result('e2', `The file /w/a.txt has been updated successfully.${NOTE}`, 'u3'),
  read('r1', { file_path: '/w/a.txt' }, 'a4'),
  result('r1', numbered(1, 100), 'u4'),
]

test('micro leaves Write and Edit calls alone', () => {
  const { messages, stats } = microCompact(writes)
  expect(stats.writesElided).toBe(0)
  expect(messages.slice(0, 6)).toEqual(writes.slice(0, 6))
})

test('tiny elides Write and Edit payloads and the note that the file is in context', () => {
  const { messages, stats } = microCompact(writes, { tiny: true })
  expect(stats).toEqual({ elided: 1, chars: numbered(1, 100).length + lines(40).length + lines(12).length, thinkingDropped: 0, writesElided: 2 })
  expect(messages[0]!.handle).toBeUndefined()
  expect(messages[0]!.toolUses[0]!.input).toEqual({
    file_path: '/w/a.txt',
    content: '[content elided by compaction: 40 lines. Read the file if needed.]',
  })
  expect(messages[1]!.toolResults![0]!.text).toBe('File created successfully at: /w/a.txt')
  expect(messages[2]!.toolUses[0]!.input).toEqual({
    file_path: '/w/a.txt',
    old_string: '[old_string elided by compaction: 12 lines. Read the file if needed.]',
    new_string: 'x',
    replace_all: false,
  })
  expect(messages[3]!.toolResults![0]!.text).toBe('The file /w/a.txt has been updated successfully.')
  // Short payloads are cheaper than a placeholder, so the call and its note stay
  expect(messages[4]).toBe(writes[4])
  expect(messages[5]).toBe(writes[5])
  expect(messages[7]!.toolResults![0]!.text).toBe(
    '[file contents elided by compaction: /w/a.txt, 100 lines. Read it again if needed.]',
  )
})

test('tiny twice changes nothing more', () => {
  const once = microCompact(writes, { tiny: true }).messages
  const twice = microCompact(once, { tiny: true })
  expect(twice.messages).toEqual(once)
  expect(twice.stats).toEqual({ elided: 0, chars: 0, thinkingDropped: 0, writesElided: 0 })
})

test('/compact micro logs the number of reads and chars elided', async ($, on) => {
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  const answer: any = await ($ as any).session.compact({ trigger: 'manual', instructions: ' Micro ', messages: transcript })
  expect(answer.messages.length).toBe(transcript.length - 2)
  expect(logs).toEqual([`Elided 2 file reads with ${numbered(1, 300).length + numbered(100, 119).length} chars`])
})

test('/compact tiny also logs the write/edit payloads elided', async ($, on) => {
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  await ($ as any).session.compact({ trigger: 'manual', instructions: 'tiny', messages: writes })
  expect(logs).toEqual([`Elided 1 file reads and 2 write/edit payloads with ${numbered(1, 100).length + lines(40).length + lines(12).length} chars`])
})
