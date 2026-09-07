# Folklet runtime components

Folklet's original code and assets use the repository's MIT license. Bundled and optional components below retain separate licenses. Source archives include provenance/notices but exclude runtime executables and installed npm packages. Setup reconstructs pinned dependencies from their recorded sources.

## Included runtimes and libraries

- **OpenAI Codex 0.153.4:** unmodified official runtime and helper executables. Windows uses runtime/codex; Unix preserves the official bin, codex-path and codex-resources layout. Apache 2.0: runtime/codex/LICENSE and NOTICE. [Source release](https://github.com/openai/codex/releases/tag/rust-v0.153.4), commit 3d2ee51ca2d5db578f328aa75e20aa22c0197c9a. Pins and checksums appear in scripts/dependencies.json, scripts/platform-dependencies.json and runtime receipts. The Codex desktop app is not included or required.
- **ripgrep 15.2.0:** the executable supplied for Codex, licensed under MIT or the Unlicense. See runtime/codex/RIPGREP-COPYING, RIPGREP-LICENSE-MIT and RIPGREP-UNLICENSE. [Source](https://github.com/BurntSushi/ripgrep/tree/15.2.0).
- **Unix zsh and Linux bubblewrap helpers:** included through the official Codex package. Preserve runtime/codex/ZSH-LICENCE, BUBBLEWRAP-COPYING and [UNIX-SOURCES.md](runtime/codex/UNIX-SOURCES.md), which records exact upstream source and modifications. The Linux helper's GNU Library General Public License and corresponding-source obligations remain separate from Folklet's MIT code.
- **Node.js 24.19.0:** runtime/LICENSE.txt contains its license and bundled third-party notices. [Source](https://github.com/nodejs/node/tree/v24.19.0). Setup checks the pinned official platform archive and executable hashes; Windows additionally checks publisher signatures.
- **Playwright and playwright-core 1.62.1:** Apache 2.0; LICENSE and NOTICE in each installed node_modules package. [Source](https://github.com/microsoft/playwright). package-lock.json pins versions and npm integrity. Setup disables lifecycle scripts and omits optional packages. Browser executables downloaded separately retain their own Chromium/third-party notices; retain those files when redistributing a browser.
- **Electron 44.2.0:** included in Mac/Linux desktop archives. The upstream archive's LICENSE and LICENSES.chromium.html remain with the release (Electron-Licenses beside the Mac app; within the Linux Folklet folder). [Source release](https://github.com/electron/electron/releases/tag/v44.2.0). scripts/electron-releases.json pins official archive checksums. Electron uses MIT plus bundled component licenses; Folklet's branding does not replace those notices.
- **Microsoft WebView2 SDK 1.0.4191.47:** required assemblies and loader accompany the Windows wrapper; see desktop/WebView2-LICENSE.txt. The build verifies the pinned NuGet package before extraction. The WebView2 Evergreen browser runtime is installed separately. [Microsoft WebView2](https://developer.microsoft.com/microsoft-edge/webview2/).
- **Build-only ZIP utilities:** yauzl 3.4.0 and yazl 3.3.1, with locked transitive dependencies, are used to assemble/inspect Unix archives. They are not installed as application browser libraries in the runtime bundle. See their npm package licenses and package-lock.json.

## Optional phone and native dependencies

The default Windows archive does not contain a Tailscale installer. Users can install it from [Tailscale](https://tailscale.com/download). Source setup's IncludePhoneInstaller option downloads the pinned official Tailscale 1.102.3 Windows installer for a later interactive installation; setup does not execute it. scripts/dependencies.json records its URL, checksum and publisher requirement. Tailscale keeps [its own terms](https://tailscale.com/terms).

Native helper source files are part of Folklet under MIT. No third-party native library is bundled by those helpers. Optional Linux desktop tools are separately installed by the administrator: [xdotool](https://github.com/jordansissel/xdotool) uses BSD-3-Clause and [ImageMagick](https://imagemagick.org/license/) uses the ImageMagick License. System frameworks, OS permissions and platform developer tools are provided separately.

## Accounts and attribution

Microsoft Edge/Chrome, .NET Framework, model accounts, API credits and hosting are not granted by Folklet's license. Optional installed browsers and services retain their respective terms. ChatGPT authentication stays with the official Codex engine; user credentials are never part of the distributable.

Folklet is an independent community application, not an official xAI, OpenAI, Microsoft, Electron, Tailscale or model-provider product. See README.md for inspiration credits.