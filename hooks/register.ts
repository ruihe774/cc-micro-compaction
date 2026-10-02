import { microCompact } from './elide.ts'

export function register(on: any) {
  // Only the person's /compact; auto (threshold, prompt too long), plugin and precompute
  // keep core's summary, which may be needed to fit the window
  on('session.compact', { trigger: 'manual' }, async ($: any, e: any, next: any) => {
    // `/compact full` falls back to the normal summary
    if (e.instructions?.trim() === 'full') return next({ ...e, instructions: undefined })
    const { messages, stats } = microCompact(e.messages)
    $.ui.log(`Micro-compacted: ${stats.elided} file read(s) elided, ${stats.thinkingDropped} thinking block(s) dropped`, { to: 'debug' })
    return { messages }
  })
}
