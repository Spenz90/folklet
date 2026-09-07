# Crew desktop windows

The Windows application wraps the local Crew host with .NET Framework 4.8, Windows Forms and WebView2. Mac/Linux preview windows use the separate Electron code in electron/. Both use bundled Node and the official Codex runtime; the Codex desktop app is not required.

## Windows

Extract the complete Windows package to a writable folder and open **Start Crew.cmd**. Keep the desktop folder beside the host, interface and runtime files. Windows needs WebView2 Evergreen Runtime and .NET Framework 4.8. The portable app is unsigned.

Closing the window leaves Crew in the tray. Double-click the tray icon to return. Choose **Quit Crew** to stop the owned host and its tasks. Keep the computer awake for routines and phone access.

Source setup downloads pinned dependencies, builds the optional native helper and builds the wrapper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1
```

For a wrapper-only rebuild after setup, quit Crew and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\Build.ps1
```

The wrapper restricts navigation to the verified local Crew origin, handles ordinary external links through the default browser and exposes no general native script bridge. Its managed/native WebView2 dependencies and SDK license must remain with Crew.exe.

Read-only diagnostic modes are documented in the source and release process. Use a fresh, isolated host and sample data for window tests; a screenshot of a used workspace can disclose chats. Do not attach diagnostics from a personal installation to a public issue.

## Mac and Linux previews

See [RELEASING.md](../RELEASING.md) for the exact Build-Unix command and native Mac ad-hoc signing step. Current Mac/Linux archives were assembled on Windows and inspected, not launched on their target OS. Mac requires macOS 15+; Linux x64 requires glibc 2.38+, such as Ubuntu 24.04 or Debian 13. Mac releases are not Developer ID signed/notarized.

The Electron window uses sandboxing, context isolation, no Node integration and restricted navigation/permissions. External links open in the user's usual browser. **Crew → Install browser** installs a matching Playwright Chromium into that user's app-data directory. Browser operating-system libraries may still be needed on Linux.

Closing the Mac window hides it; Linux minimizes it so it remains reachable even without a tray. **Quit Crew** stops the local host that the shell verified. One host uses the standard local port at a time.

The Mac app keeps private data under ~/Library/Application Support/Crew and Linux under the platform app-data location, normally ~/.config/Crew. The Windows portable app keeps data beside the host and its WebView2 profile in desktop/profile. Do not put these folders in release archives.

## Native computer control

The app window and native automation are separate features. Native access starts disabled and needs explicit owner enabling plus approval before every model screenshot or input. Windows helper compilation is verified; real desktop input is not. Mac helper compilation must happen on a Mac and is not included in the Windows-assembled preview. Linux needs an unlocked local X11 desktop and extra tools. See [native/README.md](../native/README.md).

Publish using the positive file-list release tools. Never zip a working desktop profile or private data folder. The [Quick start](../QUICKSTART.md) is the user-facing setup guide.