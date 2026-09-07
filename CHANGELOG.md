# Changelog

## 0.6.1 — release validation, September 7, 2026

- Prevent managed bot browsers from reaching Crew's owner and phone controls, including popups, subrequests and redirects. Both listeners reject marked browser requests before providing interface or API access.
- Reject events, approval requests and tool calls from retired tasks on a reused Codex connection.
- Restrict teammate task-result checks to owned, delegated or explicitly permitted shared-channel work, including after waiting.
- Preserve the last saved workspace state when a write fails; contain background storage failures and interrupt affected work instead of silently retaining unsaved tasks or settings.
- Add packaged desktop startup checks and retained platform evidence to release CI. Publisher signing and real-device checks remain release requirements.

This version is being validated for release. See [release checks](RELEASE-CHECKS.md) for actual test and publishing status.

## 0.6.0 — community preview, September 6, 2026

- Reusable instruction skills with reviewed revisions, per-bot enabling, checklists and Crew JSON import/export. Skills do not install code or grant permissions.
- Model-facing recall of a bot's own saved chats, dated snippets and source links. Shared-channel recall is optional and respects current membership.
- One learning and memory review view with canonical bot/team notes, source links, edit history and undo. Notes require review by default; automatic note updates are explicitly configurable by scope.
- Routine next-run explanations, missed-run skip/run-once choices, previous-result comparison and change-only success updates. Up to three bounded retries are available before any answer or tool use; accepted workflow proposals stay paused.
- Read-only GitHub issue/pull-request integration with explicit repository and bot access, plus revocation. No posting, merging or repository code execution.
- Optional Telegram private-chat notifications with pairing, recipient confirmation, generic content, quiet hours and revocation. Quiet hours skip updates rather than delivering them later. Approvals remain in Crew.
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
