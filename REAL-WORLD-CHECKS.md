# Before the next public release

Automated fixtures and a resized desktop browser do not replace these checks. Record the exact commit, platform, app version, test account type and pass/fail result. Use sample data and redact account details. Keep the existing release available until the new packaged artifacts pass.

## New desktop installation

On a separate Windows machine and both supported Mac architectures, install the extracted release with no existing Folklet data. Complete a new account sign-in, select a model and reasoning setting, and finish a sample task. Test built-in files, browser navigation, permission denial, native-control permission prompts and restart behavior. Repeat on the supported Linux desktop; Wayland native control remains unsupported. Test the packaged app with the OS credential store both locked and unlocked, then verify a password-vault fallback.

## Physical iPhone

Pair through private Tailscale HTTPS, add Folklet to the Home Screen and open it there. Check keyboard, text selection, attachment upload, scrolling and reading older messages. Enable draft autosave, type a sample draft, close and reopen the app, and confirm the text and attachment reference. Turn off autosave and verify the stored draft is removed. Switch Wi-Fi/cellular, stop/restart the host, revoke the phone and verify that no send or approval is replayed.

Enable host push with a protected vault, subscribe this phone after its notification prompt, complete a sample task and observe delivery with the app closed. Confirm quiet hours, disabled push, revoked pairing and expired subscriptions. The current implementation uses generic alerts through Apple/Google/Mozilla push services; real APNs delivery is a separate pass/fail check.

## Future private Ubuntu server

The owner chose preparation for a future server; no VPS has been bought or deployed. Follow [Hosting](HOSTING.md) on a server you control. Verify the user service after SSH logout and an actual reboot. Check private access, timezone, available storage, password-vault unlock and optional systemd credentials. Confirm temporary keys and disconnected plugins appear in Host status. Test a sample routine, an interrupted task, idle scheduled backups and restoration into a separate workspace. Reconnect tools manually and ensure the restored routines stay paused.

## Real model accounts and plugins

Complete fresh supported sign-ins and test each provider/model combination advertised as verified. Record exact model IDs and reasoning choices. Check provider-reported usage, an unpriced model, daily request caps, and provider-side spending limits. Folklet’s USD estimate is not a provider bill or a strict dollar cap.

The catalog pins the official MCP filesystem server at 2026.8.31; its smoke check uses a sample folder and checks refusal outside it. Hermes-style and OpenClaw-style starter skills are Folklet-authored instruction-format examples. Native Hermes Python plugins and native OpenClaw gateway tools still need their separate runtimes and real upstream checks. Do not present those examples as certification of either catalog.

## Publisher signing

The owner does not yet have Windows publisher signing or Apple Developer ID/notarization set up. The existing ad-hoc Mac seal is not a publisher identity. Do not label unsigned builds signed or stable.

`scripts/Publisher-Sign.mjs` prints a reviewable command plan by default. On the matching host, supply the extracted release, the public certificate identity and, on Windows, the publisher’s timestamp URL. Only `--apply` runs the plan. Windows uses an installed certificate thumbprint; Mac uses an installed Developer ID Application identity and optionally an existing notarytool keychain profile. The script accepts no private key or certificate password. Bundled pinned Node/Codex executables are not resigned by the Windows plan; the Mac plan follows the existing nested Electron bundle plan.

After signing, repackage, regenerate checksums, run the matching package validators, and verify clean-machine launch. Mac hardened-runtime entitlements and notarization must be validated on the actual signed app before distribution. Apple notarization requires a real developer account and a Mac runner with its signing credentials configured.

Reference: [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool), [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
