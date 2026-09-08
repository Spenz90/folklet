# Keep your Folklet workspace recoverable

These features are development source after 0.6.1. The published 0.6.1 downloads do not contain them.

## Protect remembered credentials

On the host, open **My workspace → Data & reliability → Credential protection**. Choose a method:

- **Password vault:** use a unique password of at least 12 characters and keep it in your password manager. Unlock it after Folklet restarts. This works on desktop and headless servers.
- **OS protection:** Windows uses current-user DPAPI; Mac uses Keychain; Linux desktop uses Secret Service through `secret-tool`. The OS store must be installed and unlocked. A headless Linux server should use the password option.

Choose **Configure and encrypt remembered credentials**. Existing remembered Folklet provider, GitHub, Telegram and plugin credentials are migrated. New remembered credentials require an unlocked vault; session-only credentials still work without one. Status distinguishes protected, locked, temporary and legacy plaintext credentials. Old backup copies are not erased. Imported plugin packages can still contain their original configuration files; inspect them separately.

This protects stored copies, not a compromised running computer account. Credential values must be available in memory while a connection uses them. The official Codex engine manages its own account cache separately. Removing a stored key does not revoke it at the provider.

## Create and download a backup

1. Finish or stop queued and active tasks. Stop other programs from changing bot files during the snapshot.
2. Open **Data & reliability → Backups & migration**. Enter a backup password of at least 12 characters. If you have protected credentials, unlock the vault first.
3. Choose **Create encrypted backup**, then download the new entry. Store a copy on a different disk or computer and keep the password separately.

Backups use authenticated AES-256-GCM encryption with a scrypt-derived password key. The format checks file hashes, sizes and paths before restoring. It includes chats, managed bot files, skills, learned notes, app drafts and connection settings. It excludes browser profiles, phone pairings, existing backup/restore folders and backup schedules. Browser and ChatGPT sign-ins must be set up again on the new host. Protected Folklet credentials are rewrapped for portability; the restored vault uses the **backup password**.

The current bounded snapshot supports **64 MB of files and 10,000 files**. Larger workspaces need a private disk backup. Symbolic links, hard-linked files and special files are rejected. A same-disk backup alone does not protect against loss of that disk.

To schedule backups, enable the checkbox, choose an interval and retention count, then save. The backup password is stored inside your unlocked vault. Backups run only while tasks are idle; a locked vault or storage error is shown in Host status. Retention applies to the local snapshot list. Download independent copies before relying on unattended work.

## Restore without replacing your working installation

1. In **Backups & migration**, choose the encrypted backup file and enter its password.
2. Choose **Inspect backup**, review the file count and date, then **Restore a separate workspace**.
3. Folklet shows the new folder. Your current workspace stays open. Routines in the restored copy are paused, queued/active tasks become interrupted, and plugin/integration connections are disabled.

Stop Folklet before opening the restored copy. Launch from the application folder with `CREW_DATA` set to the displayed folder. On Windows PowerShell:

```powershell
$env:CREW_DATA = 'C:\path\to\restored-workspace'
& .\runtime\node.exe .\server.mjs
```

On Mac/Linux source installations:

```sh
CREW_DATA='/path/to/restored-workspace' ./runtime/node server.mjs
```

Replace the example path with the exact restored folder. Unlock the vault with the backup password, reconnect accounts and tools, pair your phone again, and review routines before enabling them. No interrupted task is automatically replayed. A restored task may already have performed an external action before the backup; review its history first.

For a server without the UI, `hosting/restore-backup.mjs` supports `inspect BACKUP` and `restore BACKUP NEW_FOLDER`; supply the password on standard input using your secret manager. Never put the password in a command argument or shell history. The destination must not exist. The tool never overwrites a running workspace.

## Mobile autosave

On the phone, open **Settings → Data & reliability → Draft autosave**. Opt in separately for each browser/device. Unsent text and existing attachment references are saved in that browser profile for seven days, up to 30 drafts / 512 KB. They are not a backup of the attachments themselves and are never sent automatically. Anyone using that browser profile can access them. Turn off autosave to remove stored drafts, or use **Clear saved drafts**. Clearing browser data removes them; keep important work elsewhere.

## Private server unlock after restart

A password vault normally requires a manual unlock after restart. Folklet can also read the service credential named `folklet-vault` inside `CREDENTIALS_DIRECTORY`. The optional **user-scoped encryption flow requires systemd 256 or newer**, working host credential protection and a regular service user. Check `systemd-creds --version` and `systemd-creds --help` for `--user`; do not assume an Ubuntu 24.04 image supports it. Older hosts can use manual vault unlock. See the upstream [systemd credential documentation](https://github.com/systemd/systemd/blob/main/man/systemd-creds.xml).

On a compatible server, a regular service user can prepare a new encrypted credential in Bash. These commands prompt privately; the password is not placed in command arguments or shell history:

```bash
umask 077
mkdir -p "$HOME/.config/crew"
test ! -e "$HOME/.config/crew/vault.cred" || { echo 'A credential already exists; review it first.'; exit 1; }
set +x
read -r -s -p 'Folklet vault password: ' folklet_vault_password
printf '\n'
printf '%s' "$folklet_vault_password" | systemd-creds encrypt --user --name=folklet-vault - "$HOME/.config/crew/vault.cred"
unset folklet_vault_password
```

Continue only if encryption succeeds. Never substitute `--with-key=null` or a plaintext environment variable to bypass an unavailable credential store. Open `systemctl --user edit crew.service` and add this reviewed override:

```ini
[Service]
LoadCredentialEncrypted=folklet-vault:%h/.config/crew/vault.cred
```

After current tasks finish, run `systemctl --user daemon-reload` and `systemctl --user restart crew.service`. Check Host status and complete a sample task. If systemd cannot decrypt the credential, it can refuse to start the service; remove this one override and use manual unlock while diagnosing it. The encrypted file is tied to the host/user; recreate it after migration. These are preparation instructions, not evidence from a deployed VPS.

Treat that setup as access to the vault. Test a restart with sample credentials before using real keys. A service can restart successfully while its vault stays locked, and plugin programs still require manual reconnection. Read [Hosting](HOSTING.md) and check **Host status** after each change.
