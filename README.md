# micro-compaction

A Claude Mod that adds **micro-compaction** as `/compact micro`. Instead of asking a model to summarize your whole conversation, it trims the two bulkiest and cheapest-to-recover parts of the transcript and leaves everything else exactly as it was.

## What it does

When you run `/compact micro`, the plugin rewrites the conversation transcript locally:

- **File reads are elided.** Each successful `Read` tool result is replaced with a short placeholder such as `[file contents elided by compaction: <path>, N lines. Read it again if needed.]` (or `lines A-B` for partial reads). Images and PDFs get one too (`[image elided by compaction: <path>, WxH. …]`, `[PDF elided …]`, `[PDF pages elided …, pages N]`), since their image and document blocks are usually the largest results in a conversation. Claude can read the file again on its own whenever it needs the contents.
- **Thinking is dropped.** Thinking-only messages are removed from the transcript.
- **Everything else is kept.** Your prompts, Claude's replies, tool calls, and non-Read tool output stay unchanged, so the structure and wording of the conversation survive.

Some results are deliberately left alone: errored reads, text results already shorter than their placeholder ("unchanged since last read" stubs, tiny files), and earlier placeholders. Running `/compact micro` repeatedly is safe, because elision is idempotent.

## When it runs

- Only for a manual `/compact micro`.
- Any other `/compact`, with or without instructions (`/compact keep the plan`), is passed through unchanged to Claude Code's normal model-written summary.
- Automatic compaction (when the context window fills up) and other compaction triggers also use the normal summary, since that may be needed to fit the window.


## Installation

Requires Claude Code v2.1.287 or later.

Install it from the official Anthropic plugin directory. In case you haven't added this marketplace yet, add it first, and refresh it to get the latest listing:

```
claude plugin marketplace add anthropic-plugin-directory
claude plugin marketplace update anthropic-plugin-directory
claude plugin install micro-compaction@anthropic-plugin-directory
```

If you prefer using the TUI, inside a session, use `/plugin marketplace add`, `/plugin marketplace update` and `/plugin install` with the same arguments.

To update to a newer release later:

```
claude plugin marketplace update anthropic-plugin-directory
claude plugin update micro-compaction@anthropic-plugin-directory
```

To try a local checkout while developing, load it directly instead:

```
claude --plugin-dir /path/to/micro-compaction
```

Then run `/compact micro`. Plain `/compact` keeps working as usual.

## Best practice

- **Lower `bashOutputMaxChars` in your Claude Code config.** Micro-compaction leaves Bash output alone, but long output is spilled to a file that Claude then reads with `Read`, and that read can be elided. The default threshold is 30000 characters; a lower one (for example 10000) spills more output to files, so more of it can be stripped.
- **Watch prompt cache warmness.** Micro-compaction rewrites earlier messages, which invalidates the prompt cache. Running it often while the cache is still warm is not cost-efficient, so it pays off most when the cache has gone cold anyway or the elided content is large.
- **Use full compaction when the context is mostly unrelated information.** If a large part of the conversation no longer matters and you don't need to preserve its structure, plain `/compact` (the default) is a better fit, as is `/clear`. Micro-compaction keeps everything except file reads and thinking, so it can't discard irrelevant discussion.
- **Compact at natural breakpoints.** The best moment is after an exploration or reading phase, when many files have been read but the findings are already in the conversation, and before the next phase begins.
- **Prefer the `Read` tool for file contents.** Only `Read` results are elided. Output from `cat` in Bash, or from other tools such as MCP tools, web fetches and searches, is kept as is.
- **Expect re-reads if you keep working on the same files.** Claude re-reads an elided file when it needs it again, which adds back the tokens you saved. Micro-compaction helps most when the files you read are no longer needed.
- **It shines in image and PDF heavy sessions.** Image and PDF results are usually the largest blocks in a transcript, and they are always elided.
- **Fall back to full compaction if micro isn't enough.** Prompts, replies, tool calls and non-Read output are kept, so a long conversation can still fill the window. Run `/compact` for a summary, or rely on automatic compaction, which always uses the normal summary.

## What the hook does

The plugin registers exactly one hook, on the `session.compact` event, with the filter `trigger: 'manual'`. `session.compact` is also the name of the call that Claude Code makes to compact a conversation, so this hook sees the conversation's message list for every manual `/compact`. It changes the call only when the instructions are exactly `micro` (ignoring surrounding whitespace and case): then it returns a rewritten list (file reads elided, thinking dropped) in place of core's model-written summary. For any other `/compact`, with or without instructions, it calls `next` with the call unchanged, so Claude Code compacts as usual. Other triggers (automatic, plugin, precompute) never reach the hook because of its `trigger: 'manual'` filter. The plugin never makes the `session.compact` call itself, and it hooks no other event.

## What it runs, sends, and fetches

- It runs a single `session.compact` hook, written in TypeScript (`hooks/register.ts` and `hooks/elide.ts`), inside Claude Code.
- It makes **no model calls**, **no network requests**, and **no shell commands**.
- It does not read or write any files itself, and it uses no credentials, environment variables, or MCP servers.
- It does not collect, store, or transmit any data. It only edits the in-memory message list that Claude Code hands to the hook, and it writes one debug-level log line with the count of elided reads and dropped thinking blocks.
- It has no package dependencies and no install step.

## Development

The core logic is the pure function `microCompact(messages)` in `hooks/elide.ts`, covered by unit tests in `tests/elide.test.ts`.

```
claude plugin validate .
claude plugin test
```
