# Folklet 0.6: from ideas to features

## Next upgrade: mobile and private hosting (development source)

The next increment adds a Host status screen, five-step Always-on setup, a read-only server checker and connection recovery for the phone. It checks actual service settings, highlights temporary model keys, shows the host clock, preserves drafts in the open page during disconnections and does not replay tasks. See [Quick start](QUICKSTART.md#mobile-and-hosting-improvements-in-the-development-version) and [Hosting](HOSTING.md#follow-setup-inside-folklet). These changes are not in the published 0.6.1 downloads. Real VPS and physical iPhone validation, publisher signing and managed hosting remain separate work.

The seven ideas researched on September 5, 2026 are implemented in the **0.6.0 community-preview source**. An additional source-draft workflow makes app improvements reviewable before application. Use [the feature guide](FEATURES.md) for instructions and [release checks](RELEASE-CHECKS.md) for validation status. Implementation does not mean every device, provider or external service has had a live test.

“Hermes” means Nous Research's Hermes Agent; “Clawbot” was interpreted as OpenClaw. Their documentation informed the ideas below. Folklet implements its own bounded versions. Version 0.6.1 adds portable imports and external tool connections, with the compatibility limits described below; it does not promise feature parity.

| Feature | Included in 0.6 | Deliberate limits |
| --- | --- | --- |
| **Reusable skills** | Instruction documents with steps, examples, a checklist, revisions, review, per-bot enabling and Folklet JSON import/export. | Accepted and enabled are separate choices. Imports remain pending. Skills cannot install code or grant permissions. |
| **Let bots recall past work** | A model-facing local chat search with dated snippets and conversation links, plus a Past work review view. | Own private chat only; shared channels require opt-in and current membership. Other bots' private chats stay outside recall. Retrieved context goes to the selected model when used. |
| **Review and correct learning** | Canonical bot/team notes, proposed revisions, sources, history, editing and undo. | Review is the default. Automatic notes are an explicit separate setting; preferences and skills remain reviewed. This is stored context, not model training. |
| **Reliable recurring work** | Next-run explanations, skip/run-once missed-work choices, result comparisons, bounded retries and updates for changed results or failures. | Host must be online. Whitespace-normalized comparison is not semantic analysis. No automatic retry after output/tool use or Codex turn dispatch. Accepted workflows stay paused. |
| **Useful integrations** | Read-only GitHub repository issue and pull-request access, configured on the host and assigned to selected bots. | No external writing, merging, repository code execution or general plugin catalog. Optional tokens are session-only unless explicitly remembered. |
| **Private completion notifications** | Telegram private-chat pairing, recipient preview and activation, generic status updates, quiet hours and revocation. | No automatic setup messages, task content or approval details. Approval stays inside Folklet. Quiet hours suppress updates with no catch-up delivery. Real delivery still needs validation. |
| **Controlled model fallback** | Up to three approved alternatives, model/reasoning selection, explicit content-sharing consent and visible failure reasons. | Off by default. Only temporary failures before any answer or tool use; task permissions must stay unchanged. API-to-Codex transitions and fallback after Codex dispatch are blocked. |

## Separate app-change drafts

App improvement proposals can become separate source drafts. Bots can edit bounded existing text files in their drafts; the host owner reviews exact changes, checks syntax, explicitly approves selected tests, and applies a tested revision only while queued and active work is stopped. Folklet checks for source drift, makes backups and supports guarded restoration. It does not automatically apply or restart.

Draft tests use Node file-access and child-process restrictions, with credentials removed from their environment. **Run only code you trust. These Node restrictions are not a security sandbox; network and local services remain reachable.** Selected tests execute proposed code and require review; a pass is not full release certification. No dependencies, private chats, credentials or runtime binaries are copied into the draft. See [the app-change guide](FEATURES.md#review-an-app-change-draft).

## Portable plugins and connected tools in 0.6.1

**Plugins** adds ZIP inspection, individual file previews and import of supported instruction skills and MCP connection definitions. Imported skills wait for review and per-bot enabling; connections start disabled. The host owner separately chooses tools and bots, approves starting each connection, and approves every tool call. Restarts require manual reconnection.

Local stdio and Streamable HTTP MCP servers can supply tools. Native OpenClaw tools need a separate running gateway and manually entered tool schemas. Native Hermes Python plugins, hooks, channels and provider extensions need their original runtime or a dedicated adapter. Importing never runs those entry points or installs dependencies. Starting an approved local MCP program does execute trusted code with host-account access; recognized package runners need additional consent.

See [Plugins](PLUGINS.md) for the compatibility matrix and setup. Automated fixtures do not establish compatibility with every upstream package or service; actual upstream integration checks remain separate validation work.

## Inspiration sources

- Skills: [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) and [OpenClaw skills](https://docs.openclaw.ai/tools/skills).
- Recall and reviewed memory: [Hermes memory and session search](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory#session-search) and [memory-write controls](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory#controlling-memory-writes-write_approval).
- Recurring work: [Hermes Agent](https://github.com/NousResearch/hermes-agent) and [OpenClaw automations](https://docs.openclaw.ai/automation/cron-jobs).
- Integrations and notifications: [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) and [OpenClaw channels](https://docs.openclaw.ai/channels).
- Fallback: [OpenClaw model failover](https://docs.openclaw.ai/concepts/model-failover).

Folklet remains a personal local workspace with optional private hosting. This release does not create a public managed service, purchase a host, deploy a server or publish an App Store app. Plugin import does not install third-party packages; an explicitly approved local server command can do so when started. Platform and provider testing, upstream service checks, publisher signing and real-device checks remain outstanding release work; no dates are promised.
