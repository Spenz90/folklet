# Folklet

A little team of helpers. Your models, your workspace.

Folklet was previously called Crew. Existing workspaces stay in their original data folders; install updates without deleting your data. Some internal filenames and tool identifiers retain the old name for compatibility.

[Source](https://github.com/Spenz90/folklet) · [Release checks](https://github.com/Spenz90/folklet/actions/workflows/ci.yml) · [Downloads](https://github.com/Spenz90/folklet/releases) · [Report a security issue privately](https://github.com/Spenz90/folklet/security/advisories/new)

**Release status:** 0.6.1 is a community preview. Desktop downloads require matching-platform startup checks before publication. Windows and Mac publisher signing, physical device checks and some live provider checks remain outstanding. Read the evidence and limitations attached to each published release.

**Development source after 0.6.1:** the next upgrade adds encrypted backups and separate restore, credential protection, optional draft autosave, smaller mobile updates and history loading, API usage limits, opt-in phone push and a starter plugin catalog. Open **My workspace → Data & reliability** to set them up. These additions are not in the existing 0.6.1 downloads. Read [Recovery](RECOVERY.md) and the [real-world release checks](REAL-WORLD-CHECKS.md).

Create a researcher, writer, builder or assistant. Give each a role, talk to them individually or in a group, and keep their files, memory and recurring work together. Use your ChatGPT account through the bundled official Codex engine, or connect an API or local model. **The Codex desktop app is not required.**

Folklet is free, open source software under the [MIT license](LICENSE). You pay your chosen model provider and, if you choose a server, your hosting provider. There is no Folklet subscription or hosted service to buy in this preview.

## Start here

1. Get the matching archive from this project's published release, if available. Extract the whole archive before opening it.
2. Start Folklet on the host, open **My workspace → Connections**, and connect an account.
3. Choose **+** to create a bot, give it a name and a job, then send a task.

| Platform | Archive | Open | Status |
| --- | --- | --- | --- |
| Windows x64 | Folklet-Windows.zip | Start Folklet.cmd | Windows preview; host and task checks exercised |
| Mac with Apple silicon | Folklet-Mac-AppleSilicon.zip | Folklet.app | Preview; requires macOS 15+; publisher signing outstanding |
| Mac with Intel | Folklet-Mac-Intel.zip | Folklet.app | Preview; requires macOS 15+; publisher signing outstanding |
| Linux x64 | Folklet-Linux-x64.zip | Folklet/Start Folklet.sh | Preview; glibc 2.38+, such as Ubuntu 24.04 or Debian 13 |

Windows needs [WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) and [.NET Framework 4.8](https://dotnet.microsoft.com/download/dotnet-framework/net48). Windows 11 is the recommended host. The Windows wrapper targets Windows 10/11 x64; current browser tooling may have narrower OS support. Native ARM Windows and ARM Linux builds are not included. Mac builds are unsigned and not notarized; Windows builds are unsigned. These are previews, not platform-certified installers.

Read the **[Quick start](QUICKSTART.md)** for setup, first tasks and common fixes, then **[Make Folklet more useful](FEATURES.md)** for everyday features. See **[Plugins](PLUGINS.md)** for portable Hermes/OpenClaw skills and external tools, **[Connections](PROVIDERS.md)** for accounts and models, or **[Private cloud hosting](HOSTING.md)** to keep Folklet running when your laptop is off.

On desktop, open **My workspace → Models & reasoning**; on the phone, use **Settings → Models & reasoning**. Choose a bot to change its connection, model and reasoning level. Its gear menu and model chip open the same editor. Folklet lists only supported reasoning choices; **Default** follows your connection's configuration. With ChatGPT, choose a named model to customize reasoning. Finish or stop an active task before saving changes. Your visible chat history stays saved.

## What Folklet does

- **A persistent team:** bots with roles, avatars, separate conversations and group chats.
- **Work that continues:** task queues, progress, stop/retry controls, questions, approvals and teammate handoffs.
- **Files and context:** uploads, downloads, bot workspaces, memory and shared notes.
- **Browser work:** separate persistent browser profiles, previews and manual control. A compatible browser must be available on the host.
- **Skills and reviewed memory:** reusable instruction skills, preference and note revisions, source links, history and undo. Skills must be accepted and enabled for each bot. Bots can recall their own past chats, with shared-channel recall under your control.
- **Plugins you review:** inspect portable plugin ZIPs and files, import pending skills and disabled MCP connections, then choose tools and bots. Every tool call asks for approval. Native OpenClaw tools require a separate running gateway; native Hermes code is not a drop-in import. Local MCP programs run only after explicit trust and can access the host account's files and network.
- **More predictable routines:** next-run explanations, missed-run choices, prior-result comparisons, quiet unchanged results and bounded retries before any answer or tool use. Accepted workflow proposals become paused routines.
- **Connections you approve:** read-only GitHub issues and pull requests, optional paired Telegram updates, and an explicit fallback model order. Fallback never adds tools or replays work that may have started.
- **Reviewable app drafts:** a separate source copy, visible changes, syntax checks and explicitly approved selected tests before you apply an exact revision. No automatic apply or restart. Run only trusted test code: Node restrictions are not a security sandbox, and network/local services remain reachable.
- **Your choice of model and reasoning:** per-bot connection, model and supported reasoning level. Use ChatGPT through official Codex, plus OpenAI, Anthropic, Gemini, OpenRouter, Ollama and compatible API connections. Model capabilities vary.
- **Optional desktop control:** explicit host opt-in for the current session, with approval before every model screenshot or input. This uses the real host desktop. See [native access requirements](native/README.md).
- **An iPhone companion:** pair privately through Tailscale and add Folklet to the Safari Home Screen. The host must stay online. This is a web app, not an App Store app or phone-only engine.

## What is still a preview

The Windows host and isolated ChatGPT tasks have been checked. Published desktop packages must also pass the native startup gate in [Checks](https://github.com/Spenz90/folklet/actions/workflows/ci.yml); read the matching run's evidence. Automated tests do not replace live checks on each device and provider. Interactive native control, external model APIs, real GitHub/Telegram integrations, upstream plugin services, a VPS deployment and physical iPhone pairing still need their respective live validation. The release workflow compiles the Mac desktop helper on each Mac architecture. See [release checks](RELEASE-CHECKS.md) for the exact evidence and remaining gates.

Closing the Windows/Mac window keeps Folklet running; Linux minimizes it so it remains reachable. Use **Quit Folklet** to stop the host. Keep the host awake for routines and phone access. The cloud kit can run a separate private Folklet under a Linux user service.

## Build from source

Clone this repository or extract Folklet-Source.zip. Open a terminal in the folder containing Setup.ps1 and Setup.sh, and quit any existing Folklet before running setup. Setup downloads pinned runtimes and dependencies from recorded sources; it does not require the Codex desktop app.

Windows, in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1
& '.\Start Folklet.cmd'
```

macOS 15+ or supported Linux x64, in a terminal:

```sh
sh Setup.sh
./runtime/node server.mjs
```

The Windows launcher opens Folklet's window. On Mac/Linux, leave the host command running and open http://127.0.0.1:4318 in your browser; this starts the web interface without building an Electron desktop bundle. See [contributing](CONTRIBUTING.md) and [release building](RELEASING.md) for developer checks and desktop packaging.

## Keep your workspace private

The main host listens only on 127.0.0.1:4318. It is a personal workspace with local owner access, not a public website with user accounts. Never publish that port or put it behind a public reverse proxy. Phone access uses a separate authenticated gateway and private Tailscale Serve. Your conversations, browser profiles, files and optional saved API keys stay in the host's private data folder; task content still goes to your selected model provider.

Publish the reviewed source archive or a clean checkout. **Do not upload a used Folklet installation, its data folder, browser profiles or account files.** Read [security and privacy](SECURITY.md) before sharing a release.

## Inspiration and license

Folklet is an independent community project inspired by [Grok Bot](https://x.ai/bot), [OpenMausBot](https://github.com/milind-soni/OpenMausBot) and [Luke The Dev's phone companion demonstration](https://x.com/iamlukethedev/status/2095334068808458686). It is not affiliated with xAI, OpenAI, Microsoft, Tailscale or the supported model providers.

The seven ideas reviewed from Hermes Agent and OpenClaw are implemented in the 0.6 source, with deliberate limits described in the [feature roadmap](FEATURE-ROADMAP.md). The separate app-change draft workflow adds a review and application step. Version 0.6.1 adds portable skill/plugin imports and external tool connections; the [compatibility matrix](PLUGINS.md#what-works) explains which parts need their original runtime.

Folklet's code and original assets use the [MIT license](LICENSE). Bundled and optional components have their own [third-party notices](THIRD-PARTY-NOTICES.md). The [business note](BUSINESS.md) describes the free local offering and a possible future managed service without implying that such a service exists today.
