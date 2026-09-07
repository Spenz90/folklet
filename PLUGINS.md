# Bring your tools and skills to Folklet

Open **My workspace → Plugins** on the computer or private server running Folklet. Import a reviewed ZIP, or add a tool connection directly. A paired phone can answer tool-approval requests, but plugin setup and credentials stay on the host.

Folklet supports portable instruction skills and external tools. A plugin's name or original host does not guarantee that all its features will work here.

## What works

| What you have | How to use it in Folklet | What carries over |
| --- | --- | --- |
| A Hermes or OpenClaw SKILL.md | Use **Skills → Import skill**, or include it in a supported ZIP. | Markdown instructions with simple name and description frontmatter. Review the draft, then enable it for selected bots. Host metadata and required programs need manual review. |
| A portable plugin bundle | Use **Plugins → Import plugin ZIP**. | Supported skills and MCP connection definitions from Agent Plugins 1.0.0, Codex, Claude or Cursor layouts. Review identifies unsupported parts. This is a subset of those formats. |
| An MCP server used by Hermes or OpenClaw | Use **Add tool connection**, or import its supported connection definition. | Tool discovery and approved tool calls over local stdio or Streamable HTTP. Set up its credentials and dependencies separately. |
| Native OpenClaw plugin tools | Install and run them in a separate OpenClaw gateway, then add an **OpenClaw gateway** connection. | Only the tool names and schemas you manually supply and allow. The gateway executes them with its own permissions and policies. |
| A native Hermes Python plugin | Keep it in Hermes, or obtain a separately implemented MCP adapter. | A ZIP may yield portable skills or MCP definitions if present. Python registration, hooks, channels and provider extensions are not loaded by Folklet. |
| Native hooks, channels, providers, agent definitions or command dispatch | Use their original host or a dedicated adapter. | Supporting files can be retained for review. Import does not activate these features. |

The upstream boundaries differ: [Hermes plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins/) register Python capabilities, while [OpenClaw plugins](https://docs.openclaw.ai/plugins) distinguish native runtime modules from compatible bundles. Folklet does not replace either runtime. Hermes's own [MCP support](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) also includes features that Folklet's tools-only client does not implement.

## Import a ZIP

1. Obtain a plugin ZIP from a source you trust. Review its license and remove credentials before sharing or importing it. Choose a ZIP under 8 MB with the plugin at its root or inside one outer folder.
2. Open **Plugins → Import plugin ZIP → Inspect package**. Inspection stores a private review copy; it does not run programs, install dependencies, activate skills or connect servers.
3. Read **Compatibility notes**, the skills and connection summaries, then choose files under **Included files** to read their contents. Long previews are marked as truncated; binary files have no text preview. The original files remain in the private copy.
4. Choose **Import supported parts** for that reviewed revision. If files changed after inspection, inspect them again. A package with no supported skills or connections cannot be activated through this importer.
5. Open **Skills**, review each pending revision and choose **Accept revision**. Select its bots separately. In **Plugins**, configure each imported connection: it starts disabled, with no allowed bots or tools.

For a single instruction file, **Skills → Import skill** accepts SKILL.md or Folklet skill JSON without a ZIP. Simple SKILL.md frontmatter must include name and description; advanced YAML is not supported. A skill may describe a tool or script that is unavailable here. Its text never grants permission to install or run that software.

The package view lists missing dependencies and unsupported components. Installer scripts, package dependencies and native entry points are never run during import. Original files may still contain secrets even when their credential values are omitted from the active connection definition. Keep imported packages and their backups out of public repositories.

## Connect MCP tools

1. Open **Add tool connection** and choose **MCP server URL** or **Local MCP program**.
2. Copy the endpoint or program settings from that server's documentation. Remote endpoints need HTTPS; HTTP is allowed only on loopback. Use the final endpoint without credentials, query strings or fragments. Redirects are refused.
3. For a local program, enter the executable and its arguments as a JSON list of strings. Install required runtimes and dependencies separately. General shell wrappers are refused. On Windows, npm/npx needs a separate Node.js/npm installation; Folklet's bundled Node alone does not include npm.
4. Enter credentials under **Credentials and advanced settings**. Review the endpoint or program, check **I trust this connection and approve starting it**, then choose **Save and connect**. This first connection discovers tools; none are automatically selected.
5. Select individual **Allowed tools** and **Available to these bots**, review the trust choice again, then **Save and connect**. No selected tools or no selected bots means no bot access. **Save disabled** keeps settings without starting the connection.

Starting a local server executes trusted code with your normal computer-account access, including files and the network. Recognized package runners such as npx, uvx and bunx also require **Allow this command to download and run packages**. That checkbox is consent for those runners, not network isolation: other trusted programs can use the network too. Review executable versions and arguments before starting them.

Folklet supports tools over stdio and [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), including bounded streamed responses. Legacy HTTP+SSE endpoints, MCP resources/prompts, server-requested sampling or elicitation, and automated MCP OAuth login are not supported. Use credentials the service officially supports; a service that requires an unsupported login flow needs a separate compatible setup.

## Connect native OpenClaw tools

First install, configure and start OpenClaw and the chosen native plugin yourself, following its publisher's instructions. Keep its gateway private. Folklet does not install OpenClaw or start its gateway.

In **Plugins → Add tool connection → OpenClaw gateway**, enter the gateway URL and its supported bearer credential. Under **OpenClaw tool definitions**, paste a JSON list containing the actual name, description and inputSchema of each tool you want, from the plugin's documentation or source. **Save disabled** first to display the declared tools, then select tools and bots, review trust and **Save and connect**.

The status **Configured; checked on first call** means only that these settings were accepted. Folklet does not discover gateway tools or make a test tool call. Ask for one small, suitable task and review its approval. The first approved call checks whether the endpoint accepts it.

The gateway's [tools-invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api) uses operator-level bearer access and its own tool policies. Folklet's allowlist limits what its bots can request; it does not narrow that credential at OpenClaw. A gateway can deny a tool even when it is selected here. Native hooks, channels and providers continue to belong to OpenClaw and do not become Folklet features.

## Approvals, restarts and removal

Every plugin tool call asks you to approve its connection, tool and arguments. Declining prevents that dispatch. Approved arguments go to the external server; returned content can go to the bot's model provider. Tool output is untrusted content. MCP tool details are checked again before dispatch; changed details require reconnection and review.

After Folklet restarts, reconnect each tool connection manually, even if credentials were remembered. Re-enter session-only credentials. A disconnected or expired session is not silently reconnected, and an uncertain call is not automatically replayed. **Stopping a task requests cancellation; an external action may already have happened. Check its result before retrying.**

To stop access, choose **Save disabled** or **Remove connection**. Removing a package stops its connections, disables its imported skills and removes its owned package files. Existing conversations remain. Removing local settings does not revoke a provider's token or uninstall software installed separately.

Credentials stay in memory by default. Explicitly remembered credentials are plaintext files in Folklet's private data folder, not an encrypted vault. Unix uses owner-only file permissions; Windows uses inherited folder permissions. Original imported config files and external programs may retain their own copies. Read [security and privacy](SECURITY.md).

These adapters have automated fixture coverage, including local protocol and cancellation checks. That is not certification of the Hermes/OpenClaw catalogs or every third-party server. Real upstream gateway, authenticated service and target-device checks remain separate work; consult [release checks](RELEASE-CHECKS.md) for the evidence attached to a release.
