# Security and privacy

## Reporting an issue

Crew is a community preview. Report against the latest source or release with the Crew version, host OS and a small reproduction using fabricated data.

Private vulnerability reporting is enabled for [Spenz90/crew](https://github.com/Spenz90/crew/security/advisories/new). Use **Security → Report a vulnerability**. Do not include credentials, real chats, pairing codes, browser profiles or an exploit against someone else's installation in a public issue. If a fork has no private reporting, ask its maintainer to enable it without posting sensitive details.

## Host and phone boundaries

The main host binds only to 127.0.0.1, checks the Host header and requires a per-run token for API access. It is a workspace for one trusted OS user. Software already running with that user's access can reach the local interface; its token is not protection from a malicious local process.

Managed bot browsers cannot open Crew's owner or phone control origins. Context-wide request checks cover popups and subrequests; a browser request marker is rejected by both listeners before serving their interface or APIs. Service workers are blocked in these managed profiles. Other local development sites remain available. This protects the browser tool boundary, not against arbitrary code or another process already running as the OS user.

Phone access starts off. Its separate loopback gateway is intended for private Tailscale Serve HTTPS. Pairing codes expire and are single-use; attempts are limited. Device secrets are stored as hashes. Session cookies use Secure, HttpOnly and SameSite; changing requests also require a device CSRF token. Pairing gives a device access to the personal workspace.

Paired phones cannot manage provider secrets or ChatGPT sign-in, configure integration or notification credentials, apply app drafts, enable native desktop access, administer pairing or shut down the host. Never publish the main host port, expose either loopback port on a public interface, or use Tailscale Funnel. The cloud kit uses a private SSH tunnel for owner access. A shared public server with separate customer logins is outside this architecture.

## Models and credentials

ChatGPT authentication belongs to the bundled official Codex engine. Crew's status omits email and credential values and accepts only approved official sign-in destinations. Other official Codex clients for the same OS user can share that credential cache. Signing out may affect them.

API keys stay in process memory by default. Explicitly remembered keys are written to provider-secrets.json in Crew's private data folder, with owner-only permissions on macOS/Linux. On Windows, access follows the data folder’s existing Windows permissions; Crew does not install a separate access-control rule. This is plaintext storage, not an encrypted vault or OS keychain. Protect the OS account, disk and backups. Removing a key locally does not revoke it with its provider.

OpenRouter authorization uses its official S256 PKCE flow with an expiring one-time state and exchanges the result for a user-controlled API key. Crew does not implement unofficial consumer subscription login for other providers. Custom API endpoints receive the key and task content sent to them; remote endpoints require HTTPS.

Prompts, tool output, chosen files and submitted screenshots go to the selected model provider. Browser websites receive their normal page interactions. Crew is not an offline privacy boundary merely because its interface runs locally. Provider retention, billing and account controls are governed by that provider.

Fallback is off until the owner explicitly approves a connection/model order and sharing task content with it. It runs only for temporary failures before any answer or tool use and checks that the task's permissions and relevant settings have not changed. An API connection cannot automatically switch to Codex. No fallback or automatic routine retry occurs after Codex turn dispatch, because actions may already have started before their events become visible.

## Files, tools and the real desktop

Official Codex tasks use workspace-write sandboxing and on-request approvals. API bots receive Crew's bounded tools, not an arbitrary terminal. The workspace file tool checks containment, linked paths and size; writes are confined to the bot workspace. Other engine operations can request additional access through the engine's approval flow.

Bots share an OS account. Separate workspaces and browser profiles organize work; they are not hardened tenant isolation. A private VPS isolates that host from a home computer, but Crew itself does not create a VM. Treat downloaded files, webpages and model output as untrusted.

Native desktop control is off at every host start. A trusted local owner must enable it for that session. Each model screenshot and input needs a real approval. Inputs require the latest short-lived frame. Disable cancels pending work but cannot undo input already delivered to the OS. Screenshots can include any visible app and go to the model provider.

Native control uses the shared real desktop, not a protected browser. Windows secure/elevated sessions, macOS permission restrictions and Linux X11 requirements still apply. Do not use sensitive apps concurrently with native automation. See [native access](native/README.md) for platform requirements and testing limits.

## Learning, recall and external integrations

Learning records stay private. Preferences and skill revisions require review; skills must also be enabled for each bot. Bot/team notes use canonical reviewed revisions with history and undo. Automatic updates for either note scope require a separate explicit setting. Imported skills are instruction documents, remain pending and cannot grant tools or install executable packages. Accepting a workflow creates a paused routine; review and enable scheduled work separately.

Conversation recall limits a bot to its own private conversation and, when explicitly allowed, shared channels it currently belongs to. It cannot retrieve another bot's private chat. Returned snippets include source links and may be sent to the current model. These application checks are not hardened isolation from another process using the same OS account.

Checking another teammate's task result follows its own access checks: the bot must own the task, have delegated it, or have opted into recall of its current shared channel. Access is checked again after waiting for a result. Knowing a task ID does not grant access to a private result.

A handoff to a bot outside the current channel passes the bounded assignment without copying that channel's history or adding a member. The assignment itself is shared with the chosen teammate and its model provider.

The initial integration reads GitHub issues and pull requests for an explicitly configured repository and allowed bot list. It cannot write to GitHub or execute repository code. Repository text is untrusted model input. Integration and Telegram tokens are session-only by default; remembered tokens use plaintext private files with owner-only Unix permissions and inherited Windows folder permissions, matching the limits described above.

Telegram notifications require a short-lived pairing code, a recipient preview and explicit activation on the host. They omit task content, bot names and approval details; the optional Crew link must be private. Telegram cannot approve actions. Quiet hours suppress notifications, including input requests, without delayed delivery. Revoke access when a token or recipient should no longer be used. Telegram still receives normal delivery metadata.

## App-change drafts

Marking an app-change proposal reviewed does not edit the app. A separate source draft copies only the positive public-source list into private storage. Draft editing is bounded to existing supported text files, without installing dependencies or copying private data. Bots cannot authorize running tests or applying their changes.

On the host, selected tests require explicit approval tied to the current review hash. They execute proposed code using Node file-access and child-process restrictions, with credentials removed from the environment. **Run only code you trust. These Node restrictions are not a security sandbox; network and local services remain reachable.** Review that code before authorizing execution. Passing a selected subset is not a full release or security certification.

Applying requires current passing syntax and selected-test checks, explicit approval of the exact revision, no queued or active tasks, and unchanged original source. Backups support restoration only while the applied files still match. Draft edits invalidate earlier checks. Crew does not automatically apply, install packages, restart or publish an update. Private draft copies, test output and backups remain excluded from releases. See [the app-change workflow](FEATURES.md#review-an-app-change-draft).

## Desktop wrappers and storage

The Windows WebView2 wrapper restricts embedded navigation and provides no general native host-object/message bridge. Mac/Linux Electron windows use sandboxing, context isolation, no Node integration and restrictive navigation/permission policies. Ordinary permitted external links open in the user's regular browser.

The phone PWA caches public icons and an offline page only, not chats, API responses or token-bearing HTML. Browser profiles, however, can retain website cookies and sign-ins on the host.

Default data folders are data beside the source/Windows installation, ~/Library/Application Support/Crew/data for the Mac app, and ~/.config/Crew/data for the Linux app (platform configuration can affect Electron's app-data root). The service kit uses ~/.local/share/crew. A CREW_DATA override changes the host data folder. Desktop web profiles and optional browser downloads may sit beside that data folder. Official Codex credential storage is separate.

## Publishing and updates

Use the positive file-list release tools and inspect the result. .gitignore is a second defense, not proof that an entire working folder is safe to share. Exclude data, browser sessions, generated logs, diagnostics, .codex folders and keys. Reproduce problems using a new CREW_DATA directory with sample data.

Setup verifies pinned downloads before use and disables npm lifecycle scripts. Preserve runtime provenance, licenses and corresponding-source notices when redistributing binaries. Re-check updated dependencies on their actual target platforms.

The Windows app is unsigned. Mac previews assembled on Windows are unsigned and unnotarized; a native ad-hoc signing step is documented for local testing, not equivalent to Developer ID notarization. A checksum identifies a file, not a trusted publisher or a security guarantee. Native input, foreign OS startup, real VPS operation and physical iPhone pairing retain the unverified limits in [release checks](RELEASE-CHECKS.md).
