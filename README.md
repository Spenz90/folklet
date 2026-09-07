# Crew

Your own AI teammates, in one workspace.

[Source](https://github.com/Spenz90/crew) · [Release checks](https://github.com/Spenz90/crew/actions/workflows/ci.yml) · [Downloads](https://github.com/Spenz90/crew/releases) · [Report a security issue privately](https://github.com/Spenz90/crew/security/advisories/new)

**Release status:** 0.6.1 is undergoing release validation. Source availability does not mean the desktop packages are signed or production-certified. Use only the versioned downloads that have actually been published, and read their platform requirements and test results.

Create a researcher, writer, builder or assistant. Give each a role, talk to them individually or in a group, and keep their files, memory and recurring work together. Use your ChatGPT account through the bundled official Codex engine, or connect an API or local model. **The Codex desktop app is not required.**

Crew is free, open source software under the [MIT license](LICENSE). You pay your chosen model provider and, if you choose a server, your hosting provider. There is no Crew subscription or hosted service to buy in this preview.

## Start here

1. Get the matching archive from this project's published release, if available. Extract the whole archive before opening it.
2. Start Crew on the host, open **My workspace → Connections**, and connect an account.
3. Choose **+** to create a bot, give it a name and a job, then send a task.

| Platform | Archive | Open | Status |
| --- | --- | --- | --- |
| Windows x64 | Crew-Windows.zip | Start Crew.cmd | Windows preview; host and task checks exercised |
| Mac with Apple silicon | Crew-Mac-AppleSilicon.zip | Crew.app | Assembled preview; requires macOS 15+; not run on a Mac yet |
| Mac with Intel | Crew-Mac-Intel.zip | Crew.app | Assembled preview; requires macOS 15+; not run on a Mac yet |
| Linux x64 | Crew-Linux-x64.zip | Crew/Start Crew.sh | Assembled preview; glibc 2.38+, such as Ubuntu 24.04 or Debian 13; not run on Linux yet |

Windows needs [WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) and [.NET Framework 4.8](https://dotnet.microsoft.com/download/dotnet-framework/net48). Windows 11 is the recommended host. The Windows wrapper targets Windows 10/11 x64; current browser tooling may have narrower OS support. Native ARM Windows and ARM Linux builds are not included. Mac builds are unsigned and not notarized; Windows builds are unsigned. These are previews, not platform-certified installers.

Read the **[Quick start](QUICKSTART.md)** for setup, first tasks and common fixes, then **[Make Crew more useful](FEATURES.md)** for the features added in 0.6. See **[Connections](PROVIDERS.md)** for accounts and models, or **[Private cloud hosting](HOSTING.md)** to keep Crew running when your laptop is off.

On desktop, open **My workspace → Models & reasoning**; on the phone, use **Settings → Models & reasoning**. Choose a bot to change its connection, model and reasoning level. Its gear menu and model chip open the same editor. Crew lists only supported reasoning choices; **Default** follows your connection's configuration. With ChatGPT, choose a named model to customize reasoning. Finish or stop an active task before saving changes. Your visible chat history stays saved.

## What Crew does

- **A persistent team:** bots with roles, avatars, separate conversations and group chats.
- **Work that continues:** task queues, progress, stop/retry controls, questions, approvals and teammate handoffs.
- **Files and context:** uploads, downloads, bot workspaces, memory and shared notes.
- **Browser work:** separate persistent browser profiles, previews and manual control. A compatible browser must be available on the host.
- **Skills and reviewed memory:** reusable instruction skills, preference and note revisions, source links, history and undo. Skills must be accepted and enabled for each bot. Bots can recall their own past chats, with shared-channel recall under your control.
- **More predictable routines:** next-run explanations, missed-run choices, prior-result comparisons, quiet unchanged results and bounded retries before any answer or tool use. Accepted workflow proposals become paused routines.
- **Connections you approve:** read-only GitHub issues and pull requests, optional paired Telegram updates, and an explicit fallback model order. Fallback never adds tools or replays work that may have started.
- **Reviewable app drafts:** a separate source copy, visible changes, syntax checks and explicitly approved selected tests before you apply an exact revision. No automatic apply or restart. Run only trusted test code: Node restrictions are not a security sandbox, and network/local services remain reachable.
- **Your choice of model and reasoning:** per-bot connection, model and supported reasoning level. Use ChatGPT through official Codex, plus OpenAI, Anthropic, Gemini, OpenRouter, Ollama and compatible API connections. Model capabilities vary.
- **Optional desktop control:** explicit host opt-in for the current session, with approval before every model screenshot or input. This uses the real host desktop. See [native access requirements](native/README.md).
- **An iPhone companion:** pair privately through Tailscale and add Crew to the Safari Home Screen. The host must stay online. This is a web app, not an App Store app or phone-only engine.

## What is still a preview

The Windows host and isolated ChatGPT tasks have been checked. Automated tests and fixture-based checks do not replace live checks on each device and provider. Mac/Linux desktop startup, interactive native control, external model APIs, real GitHub/Telegram integrations, a VPS deployment and physical iPhone pairing still need their respective live validation. The Mac desktop helper must currently be compiled on a Mac before native control is available. See [release checks](RELEASE-CHECKS.md) for the exact evidence and remaining gates.

Closing the Windows/Mac window keeps Crew running; Linux minimizes it so it remains reachable. Use **Quit Crew** to stop the host. Keep the host awake for routines and phone access. The cloud kit can run a separate private Crew under a Linux user service.

## Build from source

Clone this repository or extract Crew-Source.zip. Open a terminal in the folder containing Setup.ps1 and Setup.sh, and quit any existing Crew before running setup. Setup downloads pinned runtimes and dependencies from recorded sources; it does not require the Codex desktop app.

Windows, in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1
& '.\Start Crew.cmd'
```

macOS 15+ or supported Linux x64, in a terminal:

```sh
sh Setup.sh
./runtime/node server.mjs
```

The Windows launcher opens Crew's window. On Mac/Linux, leave the host command running and open http://127.0.0.1:4318 in your browser; this starts the web interface without building an Electron desktop bundle. See [contributing](CONTRIBUTING.md) and [release building](RELEASING.md) for developer checks and desktop packaging.

## Keep your workspace private

The main host listens only on 127.0.0.1:4318. It is a personal workspace with local owner access, not a public website with user accounts. Never publish that port or put it behind a public reverse proxy. Phone access uses a separate authenticated gateway and private Tailscale Serve. Your conversations, browser profiles, files and optional saved API keys stay in the host's private data folder; task content still goes to your selected model provider.

Publish the reviewed source archive or a clean checkout. **Do not upload a used Crew installation, its data folder, browser profiles or account files.** Read [security and privacy](SECURITY.md) before sharing a release.

## Inspiration and license

Crew is an independent community project inspired by [Grok Bot](https://x.ai/bot), [OpenMausBot](https://github.com/milind-soni/OpenMausBot) and [Luke The Dev's phone companion demonstration](https://x.com/iamlukethedev/status/2095334068808458686). It is not affiliated with xAI, OpenAI, Microsoft, Tailscale or the supported model providers.

The seven ideas reviewed from Hermes Agent and OpenClaw are implemented in the 0.6 source, with deliberate limits described in the [feature roadmap](FEATURE-ROADMAP.md). The separate app-change draft workflow adds a review and application step. This does not imply compatibility with their executable plugins or services.

Crew's code and original assets use the [MIT license](LICENSE). Bundled and optional components have their own [third-party notices](THIRD-PARTY-NOTICES.md). The [business note](BUSINESS.md) describes the free local offering and a possible future managed service without implying that such a service exists today.
