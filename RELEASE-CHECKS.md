# Release checks — 0.6.1 validation

## September 7 hardening pass

The 0.6.1 source is undergoing release validation. A source upload or a successful automated test is not a signed production release. The 0.6.0 evidence below is a dated baseline, not evidence for every changed 0.6.1 path.

- A fresh npm advisory audit reported **zero known vulnerabilities** in the locked installed dependencies (optional packages excluded). This does not audit bundled native runtimes or establish that no unknown vulnerability exists.
- **398 automated tests passed on Windows** after the hardening changes, with no failed, skipped or cancelled tests. These include the packaged-startup evidence checks and the task identity/completion-save regressions.
- A fresh live ChatGPT check completed two consecutive tasks on the same official Codex connection. The first listed/loaded an enabled skill, searched fixture history and read reviewed notes; the second returned its exact requested answer. Both replies matched, no shell commands ran, and all test processes closed. This verifies compatibility of the stricter event checks using isolated sample data.
- An isolated real Chromium check verified that managed browsers can still use an ordinary local preview, while Crew owner navigation, popups, subrequests and redirected owner access cannot obtain the interface or bootstrap token. Both host and phone listeners also reject the managed-browser marker before authentication.
- Focused core tests cover retired Codex turns, delayed requests, storage failures, persisted-state rollback and private teammate results. A handoff to a nonmember sends only the bounded assignment; it does not silently add that bot to a private channel or copy its history.
- GitHub private vulnerability reporting is enabled for [Spenz90/crew](https://github.com/Spenz90/crew/security/advisories/new). Platform jobs and release artifacts must be checked against their actual workflow result after upload.

Publisher signing has not been configured. Mac and Windows publisher identities, Mac notarization, physical iPhone checks and the live-account/device checks listed below remain outstanding. No stable release or production launch claim is justified by this hardening pass alone.

Snapshot: **0.6.0 community preview, September 6, 2026.** The seven feature additions and separate app-change drafts are included in the source and matching desktop archives. All packages retain the live-device and external-service limits below.

The new feature suite, interface checks and shared-tool ChatGPT task were checked on September 6. Earlier ChatGPT reasoning, Windows setup and platform-download checks were performed on September 5. The dated baseline checks below do not mean every new path has had a live account or device test.

## Completed for 0.6

- **372 automated tests passed on Windows**, including the Electron shell. The suite covers existing host/account/provider/browser/phone behavior plus skill review and enabling, recall ownership and shared-channel limits, canonical memory revisions, routine missed-run and retry policy, output/tool replay prevention, permission-preserving fallback, GitHub read-only access, Telegram pairing/quiet hours and app-draft revision checks. Tests use temporary workspaces and local HTTP/provider fixtures rather than paid provider calls.
- A real **bundled Codex 0.153.4** task using an existing ChatGPT sign-in and **shared-tool version 5** listed and loaded an enabled skill, searched its own sample chat with recall, and read canonical memory in an isolated workspace. The exact final reply and tool events were verified. It issued no shell commands, and all owned test processes closed. This validates the shared-tool protocol without claiming a live GitHub, Telegram or paid API-provider test.
- Desktop and **390 × 844** phone layouts were inspected for skill details/source links, recall search and navigation, learning edits/history, routine reliability settings, GitHub setup and app-draft creation/review gates. The running Windows host remained connected with its existing workspace preserved and native access off.
- The Windows **0.6.0** wrapper rebuilt from verified cached dependencies and passed its self-test: 14 navigation cases, Crew page identity, bundled-engine selection and Windows GUI subsystem. The running executable was left untouched; packaging used the separate rebuilt executable.
- Nine public guides passed all **40 relative links**, including nine heading links. Their targets are included in the public source list. Recognized guide links also open as in-app buttons, with HTTP/UI regression coverage.

App-draft checks exercise separate source copies, exact revision approval, syntax checks, selected test execution, backup/apply/restore guards and path/link rejection using fixture source. They do not certify arbitrary proposed code as safe. **Run only code you trust. Node restrictions are not a security sandbox; network and local services remain reachable.** No test applies changes to the user's running installation.

## Earlier baseline checks

- **256 automated tests passed for the earlier 0.5 snapshot on Windows**, including the Electron shell. Coverage includes account lifecycle, provider key handling and PKCE, OpenAI Responses and compatible API adapters, model/reasoning settings and UI races, tool execution/cancellation, files and attachments, learning review, native-action approval, browser control, schedules, phone gateway, cloud service planning, HTTP integration and archive validation, including an actual PowerShell 5.1 source ZIP build and working guide paths in the Mac/Linux download instructions.
- Final interface checks cover attachment removal and filenames, model labels and loading/retry states, safe settings submission and late-response handling, keyless custom-connection status, and onboarding restricted to an empty team. Desktop/phone guide navigation was reviewed against the current source; all 22 local links in the six reviewed setup, provider and release guides resolve correctly.
- API adapter checks reject duplicate tool-call IDs before replaying an action, both within one reply and across later rounds. They also verify complete bounded file-tool output. Exceptional results that exceed the adapter's text cap include an explicit truncation notice. These protocol checks use local mocks and do not make paid provider requests.
- The real HTTP integration suite started an isolated Crew server and local fake API provider. It completed file-tool work, tested provider changes, reviewed learning, denied native control, and checked phone/host administration boundaries. It made no paid API call and performed no real native screen capture or input.
- A real task completed through the **bundled Codex 0.153.4 engine**, using an existing ChatGPT sign-in and the version 4 shared file tool. The requested file contents matched exactly; no installed Codex executable was on PATH and the task issued no shell command. A brand-new account login was not completed.
- Two further isolated ChatGPT tasks verified explicit reasoning and resetting to **Default**. Low was sent to the live engine and reported in status. Returning to Default started a new thread, omitted the override, retained visible chat history and restored the account's configured effort. The configured default differed from the catalog's suggested default, confirming why Crew distinguishes them. Both exact replies matched, no tool or command ran, and all test processes closed. These used the ChatGPT connection; no paid API-provider request was made.
- Windows source setup succeeded with installed Node/npm/Codex removed from PATH, followed by a cached offline repeat. Downloads passed pinned hashes and Windows publisher checks where available. Corrupt or missing cache entries and unsafe cleanup targets were rejected. This used an isolated source folder on the development machine, not a clean Windows VM.
- The Windows WebView2 wrapper compiled and passed its self-test, including navigation restrictions and portable runtime selection. The optional Windows native helper compiled; it was not used to capture or control the real desktop.
- Official Node, Codex and Electron downloads for both Mac architectures and Linux x64 were checksum-verified. Staged runtime file hashes, executable modes, package layout and full-runtime minimum requirements were checked. Foreign executables were not run on Windows.
- Desktop and 390-pixel phone layouts were inspected in a browser. Provider connection save, model selection, reasoning settings with save/reopen, navigation, learning review and native access initially off were exercised. Physical Safari installation remains outstanding.

## Release packaging checks

The 0.6.1 public source list contains **165 explicitly listed files**: modules, tests, setup scripts, native helper source, cloud templates and documentation. The earlier 0.6.0 source folder and ZIP contained 158 files; those older desktop archives are not 0.6.1 release assets. Source bytes are checked against the intended app source in every new desktop archive. Releases exclude local chats, account files, browser profiles, private app drafts/backups and generated logs. The source archive also excludes downloaded dependencies and compiled binaries. The scanner rejects personal absolute paths and common secret formats; this is a safeguard, not a general secret-detection guarantee.

Windows packaging checks the positive file list and bundled runtime hashes. Mac/Linux packaging additionally verifies the exact runtime receipt against pinned publisher manifests, archived runtime hashes, executable permissions, safe framework links and absence of duplicate paths. Every output gets a SHA-256 checksum. The optional Tailscale installer is omitted from public archives.

The cross-assembled Mac previews do **not** contain a compiled native Mac control helper and have **not** passed Apple codesign or a Mac launch test. The source provides a matching-architecture helper build and a Mac-only ad-hoc signing script. The GitHub workflow is configured to compile/sign/check both Mac targets after upload; it has not run yet.

## Still to validate

- Full installation on a separate clean Windows machine or VM.
- Native launch, first-run behavior and browser tasks on macOS 15 Apple Silicon, macOS 15 Intel and a supported Linux desktop. The Mac native helper, ad-hoc signing script, Screen Recording/Accessibility prompts and Linux X11 native controls need target-machine testing. Wayland native control is not supported.
- Physical iPhone pairing through Tailscale, Safari Add to Home Screen, keyboard behavior and reconnect after switching networks.
- A new user's completed ChatGPT login, real OpenRouter OAuth callback and paid OpenAI/Anthropic/Gemini/OpenRouter requests. Mocked protocol checks do not validate an account's model access, billing or provider-specific model behavior. Ollama/custom endpoints also need validation against a real selected model.
- Real GitHub token/repository access, private Telegram pairing/delivery and fallback against live external-provider failures. Tests use fake responses; no Telegram recipient was messaged and no GitHub account was connected by these checks.
- An Ubuntu cloud host, systemd user service, private remote access and restart behavior. The cloud kit was inspected and tested with generated plans/mocks; no server was purchased, provisioned or deployed.
- Publisher signing for Windows, and Developer ID signing/notarization for Mac. A local Mac ad-hoc signature is not publisher signing or notarization.

Publish this initial distribution as a **preview/pre-release**, with these limits visible. GitHub-hosted CI will run after upload; local checks do not mean that GitHub Actions has passed.
