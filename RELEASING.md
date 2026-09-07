# Publishing a release

The repository contains source and small assets. **Desktop ZIPs belong in GitHub Releases**, not in a source commit. GitHub blocks ordinary repository files above 100 MiB; bundled runtimes exceed that limit. [GitHub's large-file guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) recommends Releases for distributing binaries.

## Before publishing

1. Work from a clean source checkout. On Windows, run `Setup.ps1`; on macOS/Linux, run `sh Setup.sh --skip-browser` to prepare the runtime and locked packages. Quit an existing Crew installation before rebuilding it. Keep downloaded binaries, caches, data and profiles ignored.
2. Run the automated checks and inspect desktop/phone views using sample data. Update [RELEASE-CHECKS.md](RELEASE-CHECKS.md) with actual results and remaining limitations.
3. Review `LICENSE`, the public README and third-party notices. Keep dependency notices intact.
4. Build the source archive and each desktop target below. Run `npm test` if Node/npm are installed, or use the bundled Node commands shown below; both include the Electron shell tests.

Treat a source folder, its archives and their checksums as one release snapshot. If source or documentation changes after packaging, rebuild all affected downloads and repeat the archive checks before publishing.

The current source version is **0.6.1**. Match the package, Electron and Windows wrapper versions and use a matching release tag such as `v0.6.1`. Do not attach older 0.5 or 0.6.0 ZIPs to that release. Rebuild from the intended release commit; source changes invalidate earlier archive and startup evidence.

All features require **Node 24 or newer**; setup supplies the pinned Node 24 runtime. App-draft selected tests use its permission flags. Those tests are an owner-approved development aid, not a substitute for the complete suite and archive validation below. Run only trusted test code: Node restrictions are not a security sandbox, and network/local services remain reachable.

## Windows and source archives

```powershell
.\runtime\node.exe --test *.test.mjs electron/*.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Package.ps1 -Kind Source
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Package.ps1 -Kind Windows
```

The script creates `dist/Crew-Source.zip`, `dist/Crew-Windows.zip` and adjacent `.sha256` files. It selects known project files, refuses links/private paths and checks bundled runtime hashes. The source archive contains no dependencies or executable binaries; setup downloads dependencies and builds the wrappers. The Windows archive includes the runtime, wrapper and native control helper. The optional Tailscale installer is not in public archives; users install it from its official site or request it during source setup.

`Setup.ps1` builds the Windows native helper even with `-SkipDesktop`. To build only the wrapper, use `desktop/Build.ps1`; to build only the native helper, use `native/Build-Windows.ps1`. For an isolated rebuild while the original app executable is in use, `desktop/Build.ps1 -OutputDirectory <staging-folder>` and `scripts/Package.ps1 -Kind Windows -DesktopExecutable <staging-folder>/Crew.exe` select the rebuilt executable explicitly. Do not change running application files.

## Mac and Linux archives

The archive builder runs with Node 24 on any supported host and stages verified foreign runtimes without executing them. Source setup prepares the bundled Node runtime and locked development dependencies. From the repository root on macOS/Linux, run the tests, then build the targets you need:

```sh
./runtime/node --test *.test.mjs electron/*.test.cjs
./runtime/node scripts/Build-Unix.mjs --platform darwin-arm64
./runtime/node scripts/Build-Unix.mjs --platform darwin-x64
./runtime/node scripts/Build-Unix.mjs --platform linux-x64
```

This produces `Crew-Mac-AppleSilicon.zip`, `Crew-Mac-Intel.zip` and `Crew-Linux-x64.zip` in `dist`, with checksums. On Windows, substitute `.\runtime\node.exe` for `./runtime/node`. `--cache <folder>`, `--runtime-root <staged-root>`, `--output <folder>` and `--offline` support reuse of verified downloads and staged runtimes. To prepare runtimes separately:

```sh
./runtime/node scripts/Install-Platform.mjs --platform darwin-arm64 --root .build/darwin-arm64 --cache .cache/crew-setup
./runtime/node scripts/Build-Unix.mjs --platform darwin-arm64 --runtime-root .build/darwin-arm64
```

The builder compares every runtime receipt against the pinned publisher manifest, rechecks archived runtime hashes, preserves executable modes and framework symlinks, rejects duplicate paths, and includes only the locked Playwright libraries. macOS requires **15 or later**. Linux x64 requires **glibc 2.38+ and libtinfo.so.6**, plus Electron's desktop libraries; Ubuntu 24.04 and Debian 13 are reference targets. The Linux package is not an Alpine package, despite the upstream Codex archive's `musl` name.

Build the optional Mac native control helper **on a Mac with Apple's command-line developer tools**, before building that Mac ZIP:

```sh
sh native/Build-macOS.sh --arch arm64
./runtime/node scripts/Build-Unix.mjs --platform darwin-arm64
./runtime/node scripts/Sign-Mac.mjs --archive dist/Crew-Mac-AppleSilicon.zip --platform darwin-arm64
```

Use `x64`, `darwin-x64` and `Crew-Mac-Intel.zip` for Intel. The builder automatically includes `native/macos-control-<arch>` when present, or accepts `--native-helper <file>`. Its Mach-O header must match the target architecture. Without that compiled helper, browser tools still work, but native Mac control is unavailable.

`Sign-Mac.mjs` uses Apple `codesign` on the assembled application and verifies a local **ad-hoc signature**. It preserves pinned runtime bytes and regenerates the archive checksum. It does not use an Apple account, Developer ID certificate or notarization service. Windows-built Mac previews have not passed this native signing step. Before describing Mac builds as ready for general distribution, run the native build/signing checks and test them on both Mac architectures; Developer ID signing and notarization remain separate publication work. Do not tell users to disable Gatekeeper or other system protection.

## Validation and CI

The Checks workflow is configured to run tests on Windows x64, Apple Silicon, Intel Mac and Linux x64. It builds Windows helpers, compiles each Mac helper, checks bundled Unix executables with `--version`, assembles desktop archives and performs the Mac ad-hoc signing step. Its action references are pinned to verified official commits. [Runner labels](https://github.com/actions/runner-images#available-images) can change, so review them when updating CI. No job signs in to a model provider, invokes native control, or publishes a release. Check the actual workflow result after uploading; local checks do not establish a GitHub Actions pass.

Do not use a generic “zip this folder” action on a working Crew installation. It can contain chats, browser sessions, saved tokens, private app drafts and backups even when its source code is clean. Add new public source/assets to `scripts/release-files.mjs` when needed. Review exact archive membership against that list and verify that every source file matches the intended release revision.

The 0.6.1 Checks workflow also launches the extracted desktop with an empty, isolated workspace on its matching runner. It records the rendered workspace, startup/shutdown result and exact archive hash, retains evidence and checked downloads as temporary workflow artifacts, and checks the locked npm dependencies against the advisory registry. An artifact is available only after its job passes. Workflow artifacts are not a published GitHub Release.

Run the mechanical release gate on the matching artifact and its startup evidence:

```sh
node scripts/Check-Release.mjs --platform linux-x64 --artifacts dist --evidence test-results --channel preview
```

For a stable channel, use `--channel stable`. The gate also requires timestamped publisher signing on Windows, and valid signing, Gatekeeper acceptance and stapled notarization on Mac. It intentionally fails when those facts are missing. This gate does not replace physical phone/native-control checks or live provider checks. Windows publisher setup is described in [Microsoft's Artifact Signing quick start](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart); Mac distribution needs [Developer ID](https://developer.apple.com/developer-id/) and [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution). Configure those accounts and signing credentials privately; never commit them or paste them into issue reports.

For Linux binaries, prepare the pinned corresponding-source companion before distribution:

```sh
node scripts/Prepare-Corresponding-Source.mjs
```

Publish `Crew-Linux-Corresponding-Source.tar.gz`, its checksum and receipt beside the Linux ZIP. The Linux release gate verifies this companion. Keep its upstream notices and build instructions intact; do not substitute a nearby upstream revision for the source recorded for the bundled helper.

## Uploading to GitHub

1. Create a repository and upload/commit the **contents of the clean source folder**, including `.github`, `.gitignore` and `.gitattributes`. If using the prepared `crew-github` folder, use it as the repository root. Do not upload its surrounding working directory or the live `crew` installation.
2. Let the Checks workflow run. Enable GitHub private vulnerability reporting so people can report issues privately.
3. Create a tag and GitHub Release for the tested version. Mark this initial release as a **pre-release** while device testing remains outstanding.
4. Attach each tested desktop ZIP and its checksum. Keep untested Mac/Linux builds clearly labeled as previews. You may also attach `Crew-Source.zip` and its checksum; GitHub generates source archives from tags.
5. Copy the public changelog into the release notes and retain the stated requirements and limitations. Check that downloads work from a signed-out browser.

These scripts build local files only. They do not create a repository, push commits, publish a release or use GitHub credentials. See [GitHub release limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) before adding large assets.

## Verify a download

```powershell
Get-FileHash .\Crew-Windows.zip -Algorithm SHA256
```

Compare the value with `Crew-Windows.zip.sha256` from the same trusted release. A checksum identifies matching bytes; publisher signing is a separate future release task.

On macOS use `shasum -a 256 <archive>`; on Linux use `sha256sum <archive>`. Compare against the matching `.sha256` file.
