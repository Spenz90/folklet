# Connections and models

Open **My workspace → Connections** on the host to add an account. On desktop, choose **My workspace → Models & reasoning** to set each bot's connection, model and supported reasoning level. On the phone, use **Settings → Models & reasoning** with a connection already added on the host. The bot's gear menu and model chip open the same editor.

## ChatGPT through official Codex

The ChatGPT connection uses the bundled official Codex engine and its browser sign-in. You do not need the Codex desktop app, a separate Crew account, or an API key for that connection. You need an account with access to Codex; the models and limits available to it still apply. OpenAI documents [ChatGPT and API authentication separately](https://learn.chatgpt.com/docs/auth).

The engine owns ChatGPT credentials. Its existing sign-in may be shared with the official Codex CLI for the same OS user. Signing out can affect that shared sign-in. Crew does not import your ChatGPT conversation history or promise every Codex desktop plugin, connector or feature.

## Six API connection types

| Connection | What to provide | API base URL used by Crew |
| --- | --- | --- |
| OpenAI API | An OpenAI Platform API key | https://api.openai.com/v1 |
| Anthropic API | An Anthropic API key | https://api.anthropic.com/v1 |
| Google Gemini | A Gemini API key | https://generativelanguage.googleapis.com/v1beta/openai |
| OpenRouter | OpenRouter browser authorization or API key | https://openrouter.ai/api/v1 |
| Ollama | A running local Ollama server; key optional | http://127.0.0.1:11434/v1 by default |
| OpenAI-compatible API | A trusted compatible URL, model ID and key if required | Your chosen base URL |

These use the provider's API rather than a consumer chat subscription login. Native OpenAI GPT-5/GPT-6 and supported o-series models use the Responses API for tool work; other compatible connections use Chat Completions. Anthropic uses its Messages API; Gemini and Ollama use their documented OpenAI-compatible interfaces. Official references: [OpenAI Responses](https://developers.openai.com/api/docs/guides/latest-model#update-api-and-model-parameters), [Anthropic API](https://platform.claude.com/docs/en/api/overview), [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility).

A ChatGPT, Claude or Gemini consumer subscription is not an API key for these connections. Crew does not provide unofficial consumer-account login for other providers. Hosted API usage is billed by your chosen provider; review that account's pricing and limits. Local Ollama requires your own model installation and adequate hardware.

For custom endpoints, remote addresses must use HTTPS. HTTP is accepted only for a loopback host. Your key, prompts, tool results and any submitted images go to the endpoint you choose. Use only a service you trust. On a VPS, 127.0.0.1 means the VPS itself, not your laptop.

## OpenRouter sign-in

Choose **OpenRouter → Sign in with OpenRouter → Continue to OpenRouter**. Authorize in the browser, then return to Crew. This follows OpenRouter's official [OAuth PKCE flow](https://openrouter.ai/docs/guides/overview/auth/oauth): S256 challenge, a one-time callback state, and exchange for a user-controlled API key. The browser returns to Crew's loopback address. It is OpenRouter authorization, not a way to sign into other providers' consumer subscriptions.

The resulting key follows the same session-only or remembered storage choice as a pasted key. An expired or already-used callback must be restarted from Connections. On a remote host, keep the SSH tunnel to Crew open during authorization.

## Choose a capable model

Crew tries to list models available to your connection. If the service does not support listing, enter the model ID manually. The provider decides whether your account can use it.

Choose tool calling for tasks that use Crew's tools. Choose vision as well for browser screenshots and native desktop screenshots. A text-only model may answer ordinary chat but cannot reliably act on a visual screen. Some compatible endpoints differ in their tool schema; compatibility with every model is not guaranteed.

API-connected bots can use Crew's browser, bounded workspace files, team, routine, skill, recall and learning tools, explicitly allowed read-only integrations, and separate app drafts. Approved native actions remain available when enabled. They do not inherit Codex's terminal or desktop plugin suite. ChatGPT-connected bots run through the official Codex engine and its supported task tools and approval flow. A skill or fallback choice does not add tool permissions.

## Choose the reasoning level

Open **Models & reasoning** from **My workspace** on desktop or **Settings** on the phone. Select a bot, connection and model, choose a listed reasoning level, and save. **Default** always remains available and follows your connection's configuration; it does not promise one fixed level such as Medium. Higher effort can take longer and consume more tokens; the bot's permissions, tools and provider access stay the same.

- **ChatGPT/Codex:** choose a named model to customize reasoning. Available levels come from the bundled engine's live model catalog, and Crew validates an explicit choice again before starting work. A level available for one model may be absent from another. The Default model follows Codex's configuration.
- **OpenAI, Anthropic and Gemini APIs:** Crew offers the levels verified for supported model families. Unknown model IDs use Default rather than guessing which parameters the provider accepts.
- **OpenRouter:** choices follow that model's advertised reasoning capabilities. Missing capability metadata leaves Default only; mandatory reasoning models do not offer None.
- **Ollama and custom compatible connections:** Default only in this preview. Their server/model configuration controls reasoning.

Changing the connection or model clears the old reasoning choice in the editor. Choose a newly supported level if needed before saving. Finish or stop an active task before changing any of these settings; saved changes apply to the next task.

An actual connection, model or reasoning change starts a fresh engine session while retaining the visible Crew chat history. For Codex, this also clears a prior effort override when returning to Default, so an earlier High setting cannot silently carry over. The fresh session uses the provider's configuration; previous context is not a promise of identical behavior across models. OpenAI's [App Server model catalog and turn settings](https://learn.chatgpt.com/docs/app-server#models) describe the underlying Codex controls.

API tasks have a bounded tool loop and response size. Explicit effort on supported newer Anthropic models enables adaptive thinking with a larger output allowance; Default retains the ordinary allowance. A difficult task can still reach a response or step limit and require a smaller follow-up. These adapters and settings are tested with mocked provider responses; live paid-provider reasoning has not been validated in this preview.

## Approved fallback

Each bot's **Fallback models** settings can name up to three ordered connection/model/reasoning alternatives. Fallback is off by default. Enable it only after confirming that the task, relevant conversation context, files and tool results may be sent to the selected connections. Editing that order or a choice clears the sharing confirmation. Connections must already be configured on the host.

Fallback is limited to temporary transport, rate-limit and availability failures before any assistant output or tool use, with unchanged task permissions and relevant settings. Authentication, unsupported-model and permission failures stop for your attention. The task records an alternate model and the failure reason; the bot's preferred model remains unchanged.

API bots cannot automatically move to ChatGPT/Codex because that would add tools. Codex fallback stops once a turn is submitted, even if no answer is visible, because work may already have started. These limits also prevent a Codex-to-API-to-Codex chain from reintroducing the engine. Review partial or failed work before retrying manually.

Alternative providers can charge separately and apply different retention rules. Fallback does not guarantee completion or establish a universal spending limit. See [the feature guide](FEATURES.md#choose-fallback-models) for setup.

## Keys, billing and limits

**Session-only is the default.** A key stays in host memory until the host exits. Closing a window that leaves Crew running does not end that session. **Remember this key on this computer** saves it in provider-secrets.json in the private data folder, with owner-only permissions on macOS/Linux. On Windows, access follows the data folder’s existing Windows permissions; Crew does not install a separate access-control rule. The file is plaintext and is not an OS keychain or encrypted vault. Anyone with sufficient access to that OS account, its disk or backups may read it.

Provider settings and keys are managed from the authenticated local host interface, including over your own SSH tunnel. A paired phone can select an existing connection but cannot add, retrieve or change keys. Removing a connection removes Crew's stored key; revoke keys at the provider too if they may have been exposed.

Crew does not purchase credits or enforce a universal provider spending cap. Configure limits in the provider's account and watch its usage. Routine and browser tasks can make multiple model calls. There are no fixed provider-price promises in this preview.

The connection protocol is covered by automated adapter tests. This does not mean every provider/model combination has had a live paid-account test. Consult the release checks and try one small task with each connection before relying on unattended routines.
