# Make Folklet more useful

Folklet 0.6 adds reusable skills, conversation recall, reviewed memory, routine reliability, GitHub reading, private Telegram updates and approved model fallback. Start with one feature and a small task. These are local workspace features; they do not require buying a Folklet service or a cloud host.

Open **My workspace** on desktop or **Settings** on the phone for workspace controls. Add integrations and notification credentials on the host. A paired phone uses the access already configured there. For first-time setup, read the [Quick start](QUICKSTART.md).

## Save a reusable skill

Open **Skills** to write instructions or ask a bot to propose a procedure after a useful task. Give it a title, when to use it, steps, examples and a checklist for checking the result.

Review and accept a revision, then enable the skill for the bots that should use it. Acceptance and enabling are separate choices. Later revisions remain drafts until reviewed. Import/export uses Folklet's instruction-skill JSON format; imported revisions also need review. Skills are instruction documents and never install executable packages or grant extra tool permissions.

## Find past work

Open **Past work**, choose a bot and search its saved conversation. Results include dates, snippets and links back to the conversation. The bot can use the same recall tool when you ask it to find earlier work.

A bot can search its own private chat. Shared-channel recall is optional and covers only channels that bot currently belongs to. It cannot search another bot's private chat. Retrieved excerpts may go to the model handling the task. This is separate from the existing user-facing **Search all work**.

## Review learning and notes

Open **Learning review** to review proposed preferences, workflows and changes to bot or team notes. Use the source link to see why something was proposed, edit a revision, inspect its history or undo an accepted revision. An owner can also edit the current notes directly.

Notes require review by default. The memory controls can separately allow automatic bot-note or team-note updates, with history retained. That choice does not automatically approve preferences or skills. These notes add context to later tasks; they do not train the underlying model.

Accepting a workflow creates a **paused routine**. Review its task and schedule, then enable it under **All routines** on desktop or **Routines** on the phone.

## Make routines predictable

Open a routine's **Reliability** settings to see its next-run explanation and choose:

- **Missed work:** run once after Folklet returns, or skip the missed run. Folklet does not replay a backlog of every missed occurrence. Normal short scheduler delays have a one-minute grace period.
- **Retries:** none by default, or up to three retries with increasing delay. Only temporary failures before any answer or tool use qualify. Once a ChatGPT turn has been submitted, it cannot be retried automatically because the engine may already have started work.
- **Updates:** report changed results and failures, or every completion. A first result and recovery from failure also count as updates. Result comparison ignores whitespace differences; it does not judge whether differently worded answers mean the same thing.

The previous and current result summaries help you compare outcomes. Paused routines remain paused. The host must stay online and awake; schedules use its local timezone.

## Read a GitHub repository

On the host, open **Integrations → Add GitHub repository**. Choose one owner/repository and explicitly allow the bots that need access. With no bots selected, no bot can use that integration.

This first integration reads repository issues and pull requests. It cannot post, edit, merge or run repository code. Public repositories can work without a token. For a private repository, use a token limited to that repository and the required read permissions. Review the visible access before saving, and remove the integration when it is no longer needed. Changing the repository clears the old token unless you provide it again.

GitHub content is untrusted input. Relevant text returned by the tool goes to the model handling the task. This is a dedicated integration, not a general Hermes, OpenClaw or MCP plugin importer.

## Receive private Telegram updates

On the host, open **Private notifications**. Supply a dedicated Telegram bot token, use the short-lived pairing code in your own private chat with that bot, review the recipient preview, then explicitly activate notifications for that recipient. Nothing is connected or messaged automatically during setup.

Updates say only that work finished, failed or needs input. They omit prompts, results, bot names and approval details. An optional private Folklet link lets you return to the app. Review questions and approvals inside Folklet; Telegram cannot approve actions or control the workspace.

Choose quiet hours and their timezone if needed. **Quiet hours skip notifications, including requests for input; skipped updates are not delivered later.** Turn notifications off or revoke the recipient on the host. Folklet must be running and able to reach Telegram. This optional channel is separate from Safari's Home Screen app, which has no background push service of its own. Live Telegram delivery still needs validation with a real configured recipient.

Integration and Telegram tokens are session-only by default. Remembering them is an explicit choice and uses plaintext files in Folklet's private data folder, not an encrypted vault. Unix files use owner-only permissions; Windows uses the folder's existing permissions. Protect that folder and its backups. See [security and privacy](SECURITY.md).

## Choose fallback models

Open a bot's **Fallback models** settings. Add up to three ordered connection/model/reasoning choices, confirm that the task's content may be shared with those connections, and enable fallback. It starts off. Changing the choices clears the sharing confirmation.

Folklet considers fallback only after a temporary connection, rate-limit or availability failure, before any answer or tool use. It rechecks that the task's permissions and relevant settings have not changed. Authentication errors and unsupported models need your attention instead of an automatic retry. The task records which fallback was used and why; your preferred model stays unchanged.

An API connection cannot automatically switch to ChatGPT/Codex because that would add tools. Once a Codex turn is submitted, fallback stops because work may already have begun. After output or any tool activity, review the task before retrying it yourself. Approved alternative providers can incur their own charges. See [Connections](PROVIDERS.md#approved-fallback).

## Review an app-change draft

An app-improvement proposal is still only a proposal. On the host, use **App changes** to create a separate source draft from it. Ask its bot to edit that draft, or edit an existing draft file yourself. Review the original and proposed text before proceeding.

1. Choose **Check syntax** for the current revision.
2. Select relevant existing tests, review the test-execution notice and approve **Run selected tests**.
3. Review the exact changes again. Finish or stop queued and active tasks, explicitly approve the revision, then choose **Apply reviewed revision**.
4. Restart Folklet yourself when ready. **Restore backup** can undo that draft's applied files if they have not changed again.

The draft copies only approved source files, without private chats, credentials, browser profiles, runtimes or dependencies. Edits are bounded to existing supported text files. Applying checks that the installed source still matches the original copy, and saves backups before replacement. A new edit invalidates earlier checks and approvals.

**Selected tests execute proposed code on the host.** They use Node file-access and child-process restrictions, with credentials removed from the environment. **Run only code you trust. These Node restrictions are not a security sandbox; network and local services remain reachable.** Dependencies are absent, so some tests may fail. Passing selected tests is not a complete release certification. Folklet does not automatically apply changes, install packages, restart itself or publish an update.

All features remain part of a community preview. See [release checks](RELEASE-CHECKS.md) for actual validation and [the feature roadmap](FEATURE-ROADMAP.md) for the inspiration and scope of this release.
