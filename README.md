# micro-compaction

A Claude Mod that adds **micro-compaction** as `/compact micro`. Instead of asking a model to summarize your whole conversation, it trims the two bulkiest and cheapest-to-recover parts of the transcript and leaves everything else exactly as it was.

## What it does

When you run `/compact micro`, the plugin rewrites the conversation transcript locally:

- **File reads are elided.** Each successful `Read` tool result is replaced with a short placeholder such as `[file contents elided by compaction: <path>, N lines. Read it again if needed.]` (or `lines A-B` for partial reads). Claude can read the file again on its own whenever it needs the contents.
- **Thinking is dropped.** Thinking-only messages are removed from the transcript.
- **Everything else is kept.** Your prompts, Claude's replies, tool calls, and non-Read tool output stay unchanged, so the structure and wording of the conversation survive.

Some results are deliberately left alone: errored reads, and results already shorter than their placeholder (images, "unchanged since last read" stubs, earlier placeholders). Running `/compact micro` repeatedly is safe, because elision is idempotent.

## When it runs

- Only for a manual `/compact micro`.
- Any other `/compact`, with or without instructions (`/compact keep the plan`), is passed through unchanged to Claude Code's normal model-written summary.
- Automatic compaction (when the context window fills up) and other compaction triggers also use the normal summary, since that may be needed to fit the window.

## What it runs, sends, and fetches

- It runs a single `session.compact` hook, written in TypeScript (`hooks/register.ts` and `hooks/elide.ts`), inside Claude Code.
- It makes **no model calls**, **no network requests**, and **no shell commands**.
- It does not read or write any files itself, and it uses no credentials, environment variables, or MCP servers.
- It does not collect, store, or transmit any data. It only edits the in-memory message list that Claude Code hands to the hook, and it writes one debug-level log line with the count of elided reads and dropped thinking blocks.
- It has no package dependencies and no install step.

## Installation

Install it from the Claude plugin directory, or load a local checkout while developing:

```
claude --plugin-dir /path/to/micro-compaction
```

Then run `/compact micro`. Plain `/compact` keeps working as usual.

## Development

The core logic is the pure function `microCompact(messages)` in `hooks/elide.ts`, covered by unit tests in `tests/elide.test.ts`.

```
claude plugin validate .
claude plugin test
```

Requires Claude Code v2.1.287 or later.

## License

Released into the public domain under the Unlicense. See [LICENSE](LICENSE).
