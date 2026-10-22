# Recommended models

pi-foundry works with any GPT or Claude **chat** deployment on your Foundry resource. These are the settings that make a good coding agent.

## What to deploy

| Use | Deploy | Why |
|---|---|---|
| **Default daily driver** | Claude Opus (latest) *or* GPT-5.5 | Strongest at multi-file edits, tool use and long agentic loops. |
| **Long autonomous refactors** | GPT-5.x **codex** (e.g. `gpt-5.3-codex`) | Tuned for agentic coding; large context; good value per token. |
| **Fast, cheap iterations** | Claude Sonnet (latest) or GPT-5.x **mini** | Lower latency for quick questions, reviews, small edits. |
| **Lightweight helpers** | Claude Haiku or GPT-5.x **nano** | Summaries, commit messages, compaction. |

pi-foundry automatically picks a sensible default (Opus > codex > Sonnet > GPT-5.x > the rest, skipping mini/nano). Override it with `FOUNDRY_DEFAULT_MODEL=<deployment>`, or press ++ctrl+s++ in pi's `/model` picker to save your choice.

!!! tip "Name deployments after the model"
    When the deployment name equals the model name (`claude-opus-4-8`, `gpt-5.5`), pi labels it clearly and `--model foundry/gpt-5.5` reads naturally. Custom names work too. pi-foundry reads the underlying model from Azure to get the right context window, reasoning levels and pricing.

## How each family is wired

| | GPT / codex / o-series | Claude |
|---|---|---|
| Foundry format | `OpenAI` | `Anthropic` |
| pi API | `openai-responses` (Responses API) | `anthropic-messages` (Messages API) |
| Base URL | `https://<resource>.services.ai.azure.com/openai/v1` | `https://<resource>.services.ai.azure.com/anthropic` |
| Auth header | `Authorization: Bearer <Entra token>` | `Authorization: Bearer <Entra token>` |
| Token scope | `https://ai.azure.com/.default` | `https://ai.azure.com/.default` |
| Reasoning control | pi thinking levels → `reasoning.effort` | pi thinking levels → adaptive thinking / effort |

OpenAI-format deployments that don't support the Responses API (older chat-only models) fall back to Chat Completions automatically. Embedding, image, audio and realtime deployments are ignored.

### Other Foundry models (opt-in)

DeepSeek, Grok, Mistral, Llama, Kimi and other models sold directly by Azure expose an OpenAI-compatible Chat Completions API. Set `FOUNDRY_INCLUDE_OTHER_MODELS=1` to register them. Tool calling quality varies by model; treat this as best effort.

## Sizing capacity (TPM)

A coding agent resends the conversation, the system prompt and tool definitions on every turn. A typical turn is **20K–150K input tokens**, and pi can make several turns a minute while working.

| Usage | Suggested capacity per deployment |
|---|---|
| One developer, occasional use | 100K–250K TPM |
| One developer, all day / long autonomous runs | 500K–1M TPM |
| Shared by a team | 1M+ TPM, or one deployment per developer |

Too little capacity shows up as **HTTP 429**. pi retries with backoff, but persistent 429s mean you need more TPM (quota is per subscription, region and model). Prompt caching cuts *cost* but not the TPM count.

## Deployment settings checklist

- [x] **Global Standard** (or Data Zone Standard if you need data residency). Highest availability and quota.
- [x] **Version upgrade policy:** *auto-update to default*, so you get model fixes without redeploying.
- [x] **Content filter:** the default (`Microsoft.DefaultV2`) is fine for coding. If code that mentions security topics gets blocked, a custom policy with lower thresholds may help.
- [x] **Key auth disabled** on the resource.
- [x] Identity has **Foundry User** / **Cognitive Services User** (see [Requirements](requirements.md#3-permissions-for-the-identity-that-runs-pi)).

## Context windows and limits

pi-foundry uses pi's built-in catalog for each model's context window, max output tokens, image support and pricing, so `/session` cost estimates and auto-compaction work as they do with first-party providers. If Azure exposes a different limit for your deployment (some regions or versions differ), override it per deployment in [`foundry.json`](configuration.md#foundryjson):

```json
{ "models": [ { "deployment": "gpt-5.5", "contextWindow": 400000, "maxTokens": 64000 } ] }
```
