# Make Folklet yours

Folklet runs on a computer or private server that you control. Your phone connects to that host. The Codex desktop app can be closed or absent.

On desktop, workspace controls are under **My workspace** at the bottom of the sidebar. On the phone layout, use the **Settings** tab. Add accounts and API keys on the host; a paired phone can choose connections that are already set up.

## 1. Open the app

Extract the whole release archive for your platform. On Windows, open **Start Folklet.cmd**. On Mac, open **Folklet.app**. On Linux, open **Start Folklet.sh** inside the extracted Folklet folder. If your file manager does not offer Run, open a terminal there and run `sh 'Start Folklet.sh'`.

Windows needs the Microsoft WebView2 Runtime and .NET Framework 4.8. Mac requires macOS 15 or later. The Linux preview needs x64, glibc 2.38 or newer, libtinfo.so.6 and Electron's desktop libraries; Ubuntu 24.04 and Debian 13 are reference targets. Check the matching release's [platform evidence](RELEASE-CHECKS.md) before downloading. These previews lack publisher signing and may trigger your OS's checks; use a release you trust and [verify its checksum](RELEASING.md#verify-a-download).

If an Ubuntu desktop reports a sandbox startup error, the extracted Linux archive includes an optional **Setup Linux sandbox.sh**. From that folder, run `sudo sh "./Setup Linux sandbox.sh"` once, then start Folklet normally as your own user. This explicit administrator step verifies the Electron executable and installs an AppArmor user-namespace exception for its exact path. It requires AppArmor with ABI 4 support, preserves the system-wide policy and keeps Electron sandboxing enabled. Repeat it after moving the app; an administrator can remove an obsolete Folklet profile when retiring that path. Do not start Folklet itself with sudo or disable its sandbox. Ordinary `Setup.sh` source setup performs no administrator actions.

Starting from source instead? Follow the [source setup commands](README.md#build-from-source). Quit any existing Folklet before setup, rebuilding or updating it.

## 2. Connect a model

Open **My workspace → Connections** on the host.

- **ChatGPT:** choose ChatGPT, start sign-in, and continue on OpenAI's website. Folklet uses the bundled official Codex engine. Account eligibility and usage limits still apply.
- **OpenRouter:** add OpenRouter and choose **Sign in with OpenRouter**, then complete its browser authorization. You can also paste an API key.
- **Another API:** add OpenAI, Anthropic, Google Gemini or a custom compatible connection and paste that provider's API key.
- **A local model:** choose Ollama after installing and starting Ollama separately. Its default address is http://127.0.0.1:11434/v1 on the computer running Folklet.

Leave **Remember this key on this computer** unchecked for a session-only API key. Check it only if you want the host to retain the key after Folklet quits. Retained keys are stored as plaintext in Folklet's private data folder, with access governed by the host's file permissions. See [Connections](PROVIDERS.md#keys-billing-and-limits) for storage details, costs and model limitations.

## 3. Create your first teammate

Choose **+**, give your bot a name, and describe its job. For example: “Help me plan projects. Ask when a decision is missing. Keep your replies short.”

Open **My workspace → Models & reasoning** on desktop, or **Settings → Models & reasoning** on the phone, and choose your bot. You can also use its gear menu or model chip. Choose the connection, browse or enter a model ID, select a supported **Reasoning level**, then choose **Save model & reasoning**. If your provider's model list is unavailable, you can enter the exact model ID from that provider.

Start with **Default** reasoning to follow your connection's configuration. For ChatGPT, choose a named model if you want an explicit reasoning level; **Default model** follows Codex's configuration. Higher effort can take longer and use more tokens, while tools and account access stay the same. Some models and custom/local connections offer Default only. Changing the connection or model resets the choice to Default unless you pick another supported level before saving.

Finish or stop an active task before changing these settings. Changes apply to the next task and keep your visible chat history. A model that supports tool calling is needed for actions; vision is needed for screenshot-based work.

Try a small first task:

> Create a file called hello.txt in your workspace containing Hello from Folklet. Tell me when it is saved.

Check the bot's **Files** to open or download the result. File tasks use that bot's own workspace on the host.

## 4. Add browser work when you need it

Ask your bot to open a website, then use its browser preview to follow along. Each bot gets a separate browser profile; log in only to accounts you want that bot to use. **Take control** lets you interact manually.

Folklet can use installed Edge/Chrome or its own Playwright Chromium. On Mac/Linux desktop packages, use **Folklet → Install browser** if none is available. Source setup can install Chromium with `sh Setup.sh --install-browser`; on Linux an administrator may also need to install the browser's operating-system libraries. The hosting guide covers that step for a server. Browser download is separate from installing or enabling native desktop control.

## 5. Teach preferences and routines

Ask “Remember that I prefer short answers” or “Propose a workflow I can reuse for this.” Open **My workspace → Learning review** on desktop or **Settings → Learning review** on the phone to review the proposal. The same view includes current bot/team notes, revision history and undo. Note updates require review by default; automatic note updates are a separate, explicit setting.

An accepted preference becomes context for later work. An accepted workflow creates a **paused** routine: review its task, schedule and bot under **My workspace → All routines** on desktop or **Settings → Routines** on the phone, then enable it yourself. Schedules use the host's local time, which may be UTC on a server.

Open a routine's **Reliability** settings to choose whether missed work runs once or is skipped, whether safe temporary failures may retry, and whether successful results should notify only when changed. Accepted workflows stay paused until you enable them. Folklet never automatically repeats a task after an answer or tool use; Codex retries also stop once its turn has been submitted.

Use **Skills** for an instruction library: review a skill revision, then enable it for selected bots. Use **Past work** to search a bot's earlier conversations and decide whether its shared channels can be included. These controls do not grant new tool permissions.

To bring a skill or tool from Hermes/OpenClaw, start with the [plugin setup guide](PLUGINS.md). **Skills → Import skill** reads a single SKILL.md. On the host, **Plugins** can inspect ZIPs and configure MCP or OpenClaw gateway connections. Imported skills need review; connections start disabled, require bot/tool selection and ask before every tool call. Native plugins may need their original runtime. Local server programs require trust and can access the host's files and network.

Marking an app improvement reviewed does not change the app. The host's separate **App changes** workflow lets you prepare a source draft, review it, approve selected tests and explicitly apply an exact revision with backups. Run only trusted test code: Node restrictions are not a security sandbox, and network/local services remain reachable. Folklet never applies or restarts automatically. Read [the feature guide](FEATURES.md) before using drafts, GitHub integrations, Telegram updates or fallback models.

## 6. Optional: connect your iPhone

1. Keep Folklet running on the host. Install Tailscale on the host and iPhone, sign in to the same private network, and connect both devices.
2. On the host, open **My workspace → Connect iPhone** and choose the setup button. On Mac/Linux, Tailscale must already be installed and signed in. Setup does not install system software there.
3. If Tailscale asks for HTTPS permission, open the official setup link shown, enable HTTPS, then retry setup.
4. Open Folklet's displayed private address in **Safari** on the iPhone. On the host, create a pairing code and enter it on the phone. Codes expire after five minutes and work once.
5. In Safari, choose **Share → Add to Home Screen**. Keep **Open as Web App** enabled if offered. If the installed app asks to pair again, create a new code.

Folklet and Tailscale must stay online on the host. The phone can use existing bot connections, but adding keys/accounts and enabling native desktop access stay on the host. The Home Screen app has no background push service or phone-only engine. Optional [Telegram updates](FEATURES.md#receive-private-telegram-updates) use a separately paired private chat; quiet hours skip updates rather than delaying them. A complete physical iPhone pairing and Home Screen session still needs device validation in this preview.

Revoke a lost phone on the host under **Connect iPhone → Paired devices**, or turn phone access off. A phone can disconnect itself under **Settings → This iPhone**. Pairing gives access to your personal workspace; share codes only with devices you control.

## Optional: use the real desktop

Open **My workspace → Computer access** on the host. If supported and available, enable it for this session. Your bot must ask before every screenshot, click, keystroke or scroll. Screenshots can include other applications and go to the model you selected. Restarting Folklet turns this off again.

This controls the host's real, shared desktop. A VPS controls its own desktop, not your home computer. Windows helper compilation has been checked but real input has not been exercised. Mac needs a separately compiled helper and OS permissions. Linux needs a local X11 desktop and additional system tools; a bare VPS terminal is insufficient. Check the [native access requirements](native/README.md) before using this preview feature.

## Common fixes

| What you see | What to do |
| --- | --- |
| Folklet cannot start, or port 4318 is occupied | Quit the other Folklet instance or application using that port, then reopen Folklet. Do not end unfamiliar processes. |
| A bot needs an account or key | Open Connections on the host. Session-only API keys disappear when the host stops. Reconnect, then retry the task. |
| A model is unavailable or cannot call tools | Choose a model your account can access that supports tools. Enter its exact ID if the list cannot load. |
| Only Default reasoning is offered | For ChatGPT, choose a named model first. Other models or connections may have no verified adjustable levels in Folklet. Default still lets them work normally. |
| Reasoning is unsupported, or settings cannot change during a task | Refresh the model choices and choose a listed level or Default. Finish or stop the active task before saving. |
| The browser cannot start | Install a compatible browser; on Linux also check its system-library and sandbox requirements. Folklet does not disable the browser sandbox to make an unsupported setup work. |
| A plugin says Needs connection | Reconnect it under Plugins on the host. Re-enter session-only credentials, select allowed tools and bots, and confirm trust. Connections do not restart automatically. |
| A ZIP has unsupported components | Read its compatibility notes and [plugin guide](PLUGINS.md). Native hooks, channels or providers need their original runtime; importing files does not activate them. |
| Phone address does not load | Keep the host awake, connect Tailscale on both devices, and check the connection in Folklet. Use the displayed HTTPS address, including port 8443. |
| Phone setup reports a conflicting service | Folklet leaves that service intact. Review the existing Tailscale Serve configuration yourself before retrying. Never use public Funnel for Folklet. |
| A routine runs at the wrong hour | Check the host's timezone and the routine's schedule. |
| Mac or Linux native control is unavailable | Complete that platform's [native access requirements](native/README.md); model choice alone does not enable desktop access. |

Closing a packaged desktop window keeps Folklet available; use **Quit Folklet** to stop it. A source host stays running in its terminal, and a server service uses the stop command in the [hosting guide](HOSTING.md). Back up your private data before updates and keep it out of GitHub.
