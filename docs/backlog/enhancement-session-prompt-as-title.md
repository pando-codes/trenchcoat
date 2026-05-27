# Show first user prompt as session title

## Idea
On the session detail page (`/sessions/[id]`), use the first `prompt_submit` event's prompt text as a one-line session title/intent label, so users can see what each session was *about* at a glance.

## Why deferred
The plugin defaults `privacy.log_prompt_content = false` (see `claude-plugin/lib/telemetry.py:35`). Most sessions will not have the prompt content stored — `prompt_submit` events will only carry `prompt_length` and `word_count`.

Surfacing this well requires either:
1. An opt-in story: explain the privacy tradeoff, encourage users to flip the config, and gracefully fall back when content is absent.
2. A title-extraction story that works *without* prompt content (e.g., infer from first edited file path, first Bash command, or branch name).

Neither is in scope for the current Timeline + Outcomes work.

## Data we already have
- `prompt_submit.data.prompt_length` (always present)
- `prompt_submit.data.word_count` (always present)
- `prompt_submit.data.prompt` (only when `log_prompt_content = true`)

## When to revisit
After the Phase 1 timeline ships and we have a real sense of which sessions feel hardest to identify in the list view.
