# Changelog

## Unreleased — reliability and portable workspaces

- Add encrypted backups, idle schedules, authenticated archive inspection, and restoration into a separate workspace with routines paused and connections disabled.
- Add optional device-local draft autosave, bounded history pages and state deltas. No automatic send or approval replay.
- Protect remembered Folklet credentials through a password vault or OS-backed master key. Add explicit legacy migration and restart unlock status.
- Add opt-in generic Web Push, paired-device subscription controls and quiet hours using pinned web-push 3.6.7.
- Meter API requests and provider token usage, configure estimated USD prices and block new requests at selected daily limits. ChatGPT subscription usage is not measured.
- Add a starter catalog with a pinned upstream filesystem MCP recipe and portable instruction examples, manual GitHub release checks, publisher signing preparation, and recovery/real-world validation guides.
- Extend restart readiness to fallback providers, repository/Telegram tokens, disconnected plugins, vaults, backups and push.


## Unreleased — mobile connection and private hosting upgrade

- Add a live connection indicator and a Host status view on desktop and phone, showing capacity, work counts, host time zone and restart-related checks. Read-only Linux probes verify service ownership, boot startup, lingering and crash restart policy. Temporary API keys are called out before relying on unattended work.
- Add a five-step Always-on setup view with copyable, reviewable commands, plus a read-only hosting checker. Setup never buys, deploys or changes a server from the app.
- Reconnect on foreground/network return with bounded backoff, pause background polling, and stop retrying expired sessions. Preserve drafts in the open page and offer Copy draft before a required reload. Never automatically replay a send or approval; uncertain sends require checking task history.
- Keep phone administration restrictions, private Tailscale access and the public-only offline cache unchanged. This is development source; real VPS and physical iPhone validation remain outstanding.

## 0.6.1 — release validation, September 7, 2026

- Rename the app to Folklet, including desktop windows, phone installation and download names. Preserve existing workspaces and connection settings.
- Add portable plugin ZIP inspection with individual file previews, supported SKILL.md imports and disabled MCP connection definitions. Imported skills remain pending until reviewed and separately enabled for bots. Unsupported native components are listed without execution or dependency installation.
- Add local stdio and Streamable HTTP MCP tools, plus a separately running OpenClaw gateway adapter with manual tool definitions. Require explicit connection trust, individual bot/tool grants and approval for every call. Native Hermes Python, hooks, channels and providers are not drop-in extensions.
- Keep tool connections disconnected after restart; recheck MCP tool details before dispatch, cancel pending work when access changes, and avoid automatic replay after uncertain failures. Credentials are session-only unless explicitly remembered in private plaintext files. Local programs retain normal host-account access; recognized package runners require separate consent.
- Explain compatibility, setup and external-runtime limits in the new [plugin guide](PLUGINS.md).
- Prevent managed bot browsers from reaching Folklet's owner and phone controls, including popups, subrequests and redirects. Both listeners reject marked browser requests before providing interface or API access.
- Reject events, approval requests and tool calls from retired tasks on a reused Codex connection.
- Restrict teammate task-result checks to owned, delegated or explicitly permitted shared-channel work, including after waiting.
- Preserve the last saved workspace state when a write fails; contain background storage failures and interrupt affected work instead of silently retaining unsaved tasks or settings.
- Add packaged desktop startup checks and retained platform evidence to release CI. Publisher signing and real-device checks remain release requirements.
- Preserve verified dependency notices byte for byte in Git checkouts, and use canonical temporary paths for restricted tests on macOS.
- Add an optional exact-path AppArmor setup for Linux desktop sandbox startup on affected Ubuntu hosts. Keep Electron sandboxing enabled and ordinary source setup free of administrator actions.

This version is being validated for release. See [release checks](RELEASE-CHECKS.md) for actual test and publishing status.

## 0.6.0 — community preview, September 6, 2026

- Reusable instruction skills with reviewed revisions, per-bot enabling, checklists and Folklet JSON import/export. Skills do not install code or grant permissions.
- Model-facing recall of a bot's own saved chats, dated snippets and source links. Shared-channel recall is optional and respects current membership.
- One learning and memory review view with canonical bot/team notes, source links, edit history and undo. Notes require review by default; automatic note updates are explicitly configurable by scope.
- Routine next-run explanations, missed-run skip/run-once choices, previous-result comparison and change-only success updates. Up to three bounded retries are available before any answer or tool use; accepted workflow proposals stay paused.
- Read-only GitHub issue/pull-request integration with explicit repository and bot access, plus revocation. No posting, merging or repository code execution.
- Optional Telegram private-chat notifications with pairing, recipient confirmation, generic content, quiet hours and revocation. Quiet hours skip updates rather than delivering them later. Approvals remain in Folklet.
- Approved per-bot fallback model/reasoning order, explicit provider content-sharing consent and visible reasons. Fallback is off by default, preserves permissions and preferred model settings, and stops after output or tool use. API-to-Codex transitions and retries after Codex turn dispatch are blocked.
- Separate app-change source drafts, exact revision review, syntax checks, explicitly approved selected tests, guarded application with backups and restoration. Node test restrictions are not a security sandbox; network and local services remain reachable. No automatic apply, dependency installation or restart.
- A [feature guide](FEATURES.md) and updated [roadmap](FEATURE-ROADMAP.md) explain what is implemented and its limits. Tokens remain session-only by default; explicitly remembered tokens are plaintext private files.

This snapshot passed 372 automated tests and an isolated live ChatGPT task using skills, recall and canonical memory. The matching source and desktop archives contain these changes. See [release checks](RELEASE-CHECKS.md) for the evidence and remaining live-test limits.

## 0.5.0 — community preview

- Standalone Windows app with bundled Node and official Codex, using ChatGPT sign-in without the Codex desktop app.
- Mac Apple silicon, Mac Intel and Linux x64 desktop preview packaging with pinned platform runtimes and Electron. Mac requires 15+; Linux requires glibc 2.38+. Foreign packages are assembled and inspected, not yet natively exercised.
- Six API connection types: OpenAI, Anthropic, Gemini, OpenRouter, Ollama and custom compatible endpoints, with per-bot model choice. OpenRouter adds official PKCE browser authorization. API keys are session-only unless explicitly remembered.
- **Models & reasoning** is available under My workspace on desktop and Settings on the phone, as well as a bot's gear menu and model chip. Each bot can choose its connection, model and supported effort level. Default follows the connection's configuration, visible history is retained, and active tasks must finish or stop before a change.
- Codex effort is validated against its live catalog. OpenRouter uses model capability metadata; other supported APIs use verified model mappings. Unknown, custom and Ollama models retain Default. Returning to Default clears a previous Codex thread override.
- Native OpenAI GPT-5/GPT-6 and supported o-series API tool tasks use Responses, including tool-result and image continuations. Compatible providers retain their own supported protocols. Paid-provider behavior remains subject to live validation.
- Persistent bots, groups, queues, handoffs, files, memory, browser control and scheduled routines.
- Reviewed learning: preference proposals, workflows that become paused routines on acceptance, and app-change proposals that never automatically edit code.
- Optional native desktop adapters for Windows, macOS and Linux X11. Access is off at startup and requires approval for every model screenshot/action. Windows helper compiled; Mac helper requires a native build. Real desktop input remains unverified.
- Safari Home Screen companion with private Tailscale pairing, revocable sessions and a separate mobile gateway. Mac/Linux setup supports an already configured Tailscale CLI.
- Optional Ubuntu 24.04 user-service deployment kit with private SSH access, separate data, explicit startup and optional Tailscale phone access.
- First-run connection guidance, a quick start, provider/storage explanations and honest cloud/business documentation.
- September 6 polish: removable message attachments with readable filenames, clearer empty search results and group details, improved model labels and retry controls, accessible modal labels and reduced-motion behavior, safer settings forms, and connection status that identifies stale information. First-run guidance appears only for an empty team.
- Setup guides now match the desktop and phone navigation, explain configured Default reasoning, and use the bundled runtime in source-build commands.
- Release packaging with an explicit source file list, dependency provenance, privacy checks and archive checksums.
- Audit fixes for task startup/cancellation, browser discovery and takeover, provider errors, repeated API tool IDs, complete bounded file-tool output, queued drafts, Unicode bodies, download failures, file/link boundaries and moved workspace locations.

All packages remain community previews. Live external-provider coverage, Mac/Linux startup, native input, real VPS deployment and physical iPhone pairing have outstanding gates. See [RELEASE-CHECKS.md](RELEASE-CHECKS.md) for current evidence rather than treating packaging or mocks as end-to-end validation.
