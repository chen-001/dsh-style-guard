# dsh-style-guard

A grammar-of-plain-speech guard for DSH replies. The model's answer is held back,
reviewed, rewritten when it reads badly, and only then shown. The hard-to-read draft
never appears first.

## The problem it solves

The same model, focused on a technical problem, often writes replies that are hard
to read. Hand that reply to the same model with nothing else to do and it points out
the problems accurately. This plugin makes that second pass part of every reply.

## How it works

1. Detect that the main conversation is writing a reply that is long enough and calls no tools.
2. Buffer the output; nothing reaches the page yet.
3. Run one isolated model call with only that reply and your writing rubric.
4. Run a second call that rewrites the reply against the reported problems. At most two
   rounds, and the second round only when the first one still reports real problems.
5. Compare numbers, paths and backticked names before and after. Any mismatch discards
   the rewrite and keeps the original.
6. Hand the result upstream. The page and the session log always carry the same text.

Any failure or timeout inside the plugin passes the original through.

## Install

```sh
dsh plugin --profile web add github:dsh-external/dsh-style-guard
```

`lib/` is committed, so a git install needs no build authorization.

For local development the package can also be injected directly: run
`bash scripts/build.sh` and mount it with the injector.

## Configuration

Two sources, the second overriding the first.

1. The `config` key on this plugin's row in the profile patch.
2. `~/.dsh/style-guard/config.json`. Editing this file needs no rebuild, only a plugin reload.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `dryRun` | `true` | Review and log only; the page keeps the original text. |
| `minChars` | `500` | Replies shorter than this are not reviewed. |
| `rounds` | `1` | Review-and-rewrite rounds; the code caps this at 2. |
| `maxExtraMs` | `90000` | Total budget for reviewing and rewriting. |
| `onlyRootAgents` | `true` | Only the main conversation; subagents are skipped. |
| `sessions` | `[]` | Restrict to these sessions; empty means all. |
| `provider` / `model` | `''` | Model used for the review calls; empty follows the main model. |
| `verbose` | `false` | Log the reason for every skip. |
| `trace` | `false` | Log every model call, for diagnosing whether events arrive. |
| `auditPath` | `~/.dsh/style-guard/log.jsonl` | Review log, with the full original and rewritten text. |
| `rubricPath` | `~/.dsh/AGENTS.md` | Rubric file. The "reply style" sections are re-read on every call. |

## Where the rubric comes from

Every second-level section whose heading starts with "回复风格" (reply style) in
`rubricPath` is read fresh before each review. Improving the rubric improves the checker;
there is never a second copy of the rules to keep in sync.

## Log

`~/.dsh/style-guard/log.jsonl`, one JSON object per line, with `kind`
(`review`, `skip`, `error`), the full `original` and `rewritten` text, the reported
`problems`, and `ms` / `roundsRun` / `rejected`. The original is kept here only and
never enters the conversation.

## Known limits

- The rewrite is a separate model call that sees the reply but not the code, so it can
  only change wording. Numbers, paths and identifiers are checked mechanically; finer
  wording changes are not.
- Replies are buffered, so long ones appear roughly twenty seconds later.
- The plugin sits in the path of every reply. Any exception passes the original through
  rather than stalling the conversation.

## License

BSD-3-Clause
