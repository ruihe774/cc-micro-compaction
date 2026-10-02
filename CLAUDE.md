# micro-compaction

A Claude Mod (v2.1.287+) that adds micro-compaction as `/compact micro`: Read results become a placeholder (`[file contents elided by compaction: <path>, N lines. Read it again if needed.]` or `lines A-B`; `[image|PDF|PDF pages elided by compaction: …]` for media), thinking is dropped, and every other message stays as it was. No model call. A mod is a plugin directory whose hooks run as JS/TS middleware.

## Layout

- `.claude-plugin/plugin.json`: manifest
- `hooks/hooks.json`: `modules` points to `./register.ts`
- `hooks/register.ts`: the `session.compact` hook
- `hooks/elide.ts`: `microCompact(messages)`, a pure function (unit tested)
- `tests/elide.test.ts`: run with `claude plugin test`
- `.claude-plugin/types/`: generated per version, authoritative, not hand-edited
- `docs/`: downloaded docs

## Behavior

- Only `trigger: 'manual'` with instructions exactly `micro` (trimmed, any case). Any other `/compact`, with or without instructions, goes to core via `next(e)` unchanged; so do `auto`, `plugin`, `precompute` (core's summary may be needed to fit the window).
- Only the `Read` tool is elided, by its record's `result.type`: `image`, `pdf` and `parts` (PDF pages rendered as images) always, since their bulk is an image/document block and `text` is empty or a one-line note; `text`, `notebook`, `file_unchanged` or no record only when `text` is longer than the placeholder. Errored reads and earlier placeholders (any `[... elided by compaction: `) are kept. Bash output is left alone: long output is spilled to a file that is then Read.
- Elision is idempotent.

## How session.compact behaves (verified by a spike on 2.1.287)

- Returning `{ messages }` without calling `next` replaces core compaction completely; the engine writes a `compact_boundary` and the list becomes the transcript.
- `e.messages` has one message per transcript entry, i.e. per content block: an assistant turn of thinking + tool_use + text is three messages. Thinking-only messages read as `role: 'assistant'`, `text: ''`, `toolUses: []`; dropping them strips thinking. Seen in `e.messages` with Haiku 4.5 and Sonnet 5.5 (effort low); in stored transcripts (~5000 entries from Opus 5.5, Sonnet 5.5, Sonnet 5, Haiku 4.5) thinking never shares an entry with another block. Low effort often produces no thinking at all.
- A message returned with its `handle` is kept whole (user prompts carry system-reminder blocks that `text` does not show). One without is rebuilt from `role`, `text`, tool blocks: a rebuilt thinking-only message becomes `(no content)` text, so drop those, don't rebuild them.
- Recovery works: after a hook compaction, the model re-reads elided files on its own from the placeholder, and an identical Read (same path/offset/limit, file unchanged) returns full content, not the "unchanged since last read" stub. Core resets its read-state cache for hook compactions too. Same for images and PDF pages (Haiku, 2.1.287); a rebuilt result carries only the placeholder text, no image/document block.
- A rebuilt user message's `tool_result` comes from `toolResults[].text`; tool_use ids and pairing with the (handled) assistant message are preserved.

## Verifying changes

1. `claude plugin validate .` and `claude plugin test`
2. Typecheck: `npx -p typescript tsc -p .` (TS5097 on `.ts` imports is expected)
3. End to end needs an interactive session (`/compact` is not available in `-p`): run `claude --model haiku --plugin-dir . ` in tmux with the `CLAUDE*`/`AI_AGENT` env vars unset (except `CLAUDE_CODE_PLUGIN_DIRS`) so it isn't treated as a child session. Read a file, `/compact micro`, then inspect the session JSONL after the last `compact_boundary`.

## Docs (downloaded; consult before changing APIs)

- `docs/mods-reference.md`: events (`session.compact`), API methods, limits
- `docs/mods-events.md`: middleware semantics (`next`, answering an event)
- `docs/mods-api.md`, `docs/mods-create.md`, `docs/mods-test.md`

`session.compact` is barely documented; read `SessionCompactInput`, `SessionCompacted`, `SessionMessage` in `.claude-plugin/types/claude-code/index.d.ts`. If docs and types disagree, trust the types.
