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
const result = (id: string, text: string, h: string, isError = false): SessionMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: id, text, isError }],
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
  expect(stats).toEqual({ elided: 2, thinkingDropped: 2 })
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
  expect(twice.stats).toEqual({ elided: 0, thinkingDropped: 0 })
})
