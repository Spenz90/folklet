# Contributing

Start with [README.md](README.md) and [QUICKSTART.md](QUICKSTART.md). Crew's interface is plain HTML/CSS/JavaScript, its host uses Node, the Windows window uses WebView2, and the Mac/Linux preview uses Electron.

Use a new clone or source archive, then run Setup.ps1 on Windows or Setup.sh on a supported Unix host. Windows setup also compiles the optional native helper. The Mac helper must be compiled on a Mac; see [native/README.md](native/README.md). Avoid running development checks against a personal Crew installation.

## Checks

On Windows:

```powershell
.\runtime\node.exe --test *.test.mjs
.\runtime\node.exe --test electron/shell.test.cjs
```

On Mac/Linux:

```sh
./runtime/node --test *.test.mjs
./runtime/node --test electron/shell.test.cjs
```

Use a new CREW_DATA folder with fabricated examples for manual host checks. Never commit API keys, account caches, personal chats, browser cookies or screenshots of other people's data. Tests that simulate a provider must use a local mock and should not charge an account.

Add focused regressions for task lifecycle, cancellation, approval, provider errors, files and networking. Interface checks should cover desktop and 375–390 px phone layouts, both appearances, keyboard navigation, drafts and the software keyboard. Browser changes need bot and Take control checks. Native changes need strict approval/frame tests and, before claiming support, a real run on that OS.

## Review and releases

Keep pull requests focused: describe the problem, resulting behavior and what actually ran. Include only sample-data screenshots. Crew contributions use the MIT license; preserve component notices and attribution.

Dependencies are pinned in scripts/dependencies.json, scripts/platform-dependencies.json, scripts/electron-releases.json and package-lock.json. Runtime receipts record provenance. Updates need matching pins, hashes, license review and checks on the target architecture. A passing mock test is not a successful provider connection or platform launch.

Follow [RELEASING.md](RELEASING.md) for source/Windows/Unix packaging, Mac signing and archive inspection. CI is credential-free and has no release publishing or paid model task. It cannot replace live device and provider validation; record that evidence honestly in RELEASE-CHECKS.md.

For the VPS kit, review generated service files in an isolated user account before running systemd commands. The installer must keep existing conflicting files, leave system package installation and lingering to the owner, and never expose the local host publicly.

## Learning is reviewed context

Preserve the distinction between proposed and accepted preferences. Workflow acceptance must create a paused routine; bots cannot enable it by accepting their own suggestion. App-change proposals are review records only. Applying code changes belongs in a separate human-reviewed development workflow.