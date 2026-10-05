import { microCompact } from './elide.ts'

export function register(on: any) {
  // Only the person's `/compact micro`; any other /compact (with or without instructions)
  // and auto, plugin, precompute go to core's summary untouched
  on('session.compact', { trigger: 'manual' }, async ($: any, e: any, next: any) => {
    if (e.instructions?.trim().toLowerCase() !== 'micro') return next(e)
    const { messages, stats } = microCompact(e.messages)
    $.ui.log(`Elided ${stats.elided} file reads with ${stats.chars} chars`)
    return { messages }
  })
}
