import { microCompact } from './elide.ts'

const MODES = ['micro', 'tiny'] as const

export function register(on: any) {
  // Only the person's `/compact micro` or `/compact tiny`; any other /compact (with or without
  // instructions) and auto, plugin, precompute go to core's summary untouched
  on('session.compact', { trigger: 'manual' }, async ($: any, e: any, next: any) => {
    const mode = MODES.find(m => m === e.instructions?.trim().toLowerCase())
    if (!mode) return next(e)
    const { messages, stats } = microCompact(e.messages, { tiny: mode === 'tiny' })
    const writes = mode === 'tiny' ? ` and ${stats.writesElided} write/edit payloads` : ''
    $.ui.log(`Elided ${stats.elided} file reads${writes} with ${stats.chars} chars`)
    return { messages }
  })
}
