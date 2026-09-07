# Run your own private Folklet server

A private server lets Folklet keep working while your laptop is off. It runs its own workspace, files and browsers. It does not control your home computer.

This is an optional setup kit for **one trusted owner on an Ubuntu 24.04 x64 VPS**. It is not a public multi-user service, a server purchase, or a managed hosting subscription. No server is ordered or deployed by opening this guide. The kit has automated configuration checks; it has not been exercised on a real VPS in this preview.

## Before you start

Use a server you administer, with a regular SSH user and systemd user services. Do not run Folklet as root. An administrator must prepare the server, SSH access, security updates and required system software first.

For planning, start around 4 GB RAM for light API-based work; browsers and concurrent bots may need 8 GB or more. This is a starting estimate, not a benchmark. Local models need substantially different hardware. Storage grows with browser profiles, uploads and task history.

Buy hosting directly from your chosen provider. Compare current plans, region, backups, taxes and traffic allowances on the official [Hetzner](https://www.hetzner.com/cloud/) or [DigitalOcean](https://www.digitalocean.com/pricing/droplets) pages, or use another provider. Folklet does not include hosting or model credits and quotes no fixed infrastructure price.

Keep Folklet's ports **4318 and 4320 private**. Do not open them in your cloud firewall, publish them through a reverse proxy, or use Tailscale Funnel. Use SSH for the owner interface and, optionally, private Tailscale for the phone companion.

## 1. Put the source on the server

Upload the reviewed Folklet source archive from the release you trust and extract it to a folder you own, for example a folder named crew in your home directory. Alternatively, clone your own chosen repository. Do not upload a used installation or its account files.

In an SSH session, change into that folder and run:

```sh
sh Setup.sh --skip-browser
```

This downloads pinned Node, official Codex and JavaScript dependencies. It does not sign you in or install system packages. Keep this application folder in place; the service uses its absolute path. The Linux runtime requires glibc 2.38 or newer, satisfied by Ubuntu 24.04.

## 2. Install and start your private service

Still in the Folklet folder, preview setup and then install:

```sh
sh hosting/install-user-service.sh --dry-run
sh hosting/install-user-service.sh
systemctl --user enable --now crew.service
systemctl --user status crew.service
```

The installer writes a service, a launcher and a small path configuration under your own home directory. It keeps data separate in ~/.local/share/crew. It does not run sudo, install packages, modify a firewall, enable lingering, or start the service for you. Existing differing service files are refused so you can review them first.

If systemd says it cannot connect to the user manager, reconnect with a normal SSH login for that user. An administrator may need to configure user services on your image. For Folklet to remain running after the last logout and to start at boot, explicitly arrange **lingering** for that user with your administrator:

```sh
loginctl enable-linger YOUR_USER
loginctl show-user YOUR_USER --property=Linger
```

Replace YOUR_USER with the actual service user. Your system may require administrator permission. Do not change this to running Folklet as root. The installer deliberately leaves this host-wide account setting to you.

## 3. Open Folklet privately from your computer

On your own computer, keep this SSH tunnel open, replacing YOUR_USER and YOUR_SERVER:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4318:127.0.0.1:4318 YOUR_USER@YOUR_SERVER
```

Open **http://127.0.0.1:4318** in your usual browser. That is now the server's Folklet. Stop another local Folklet first if it already occupies port 4318. The local and remote ports must match for Folklet's host checks.

Open **My workspace → Connections**, connect your account and create a bot. Try the small file task in Quick start before enabling routines.

API keys are session-only by default and disappear if the service restarts. For unattended work you can explicitly remember a key, understanding that it is saved in a private plaintext file. Set usage limits with the provider. OpenRouter sign-in can return through this SSH tunnel.

### Optional ChatGPT sign-in on a server

Use the same OS user as the service. In the Folklet folder on the server, the bundled official engine supports this command:

```sh
./runtime/codex/bin/codex login --device-auth
```

Follow its official browser link and one-time code. Device authentication may need enabling in your ChatGPT security settings or workspace permissions. Do not paste account tokens into Folklet chat, GitHub, this guide or an environment file. After sign-in, restart the Folklet service and check Connections.

If device authentication is unavailable, OpenAI documents forwarding the browser callback on port 1455 over SSH and then running codex login. See [official headless authentication guidance](https://learn.chatgpt.com/docs/auth#login-on-headless-devices). Access and usage limits remain those of your account.

## 4. Optional: install a browser

A fresh server setup skips browser installation. Choose to add it when you want bots to browse. From the Folklet folder, install Chromium into the same private location the service uses:

```sh
PLAYWRIGHT_BROWSERS_PATH="$HOME/.local/share/crew/browsers" ./runtime/node node_modules/playwright/cli.js install --no-shell chromium
```

Linux may need additional operating-system libraries. This read-only command checks what is missing:

```sh
./runtime/node node_modules/playwright/cli.js install-deps --dry-run chromium
```

Ask your administrator to review and install any missing libraries using [Playwright's Linux dependency instructions](https://playwright.dev/docs/browsers#install-system-dependencies). The real install-deps command changes system packages and may request administrator access; this kit does not run it. Do not disable browser sandboxing or weaken system security to bypass an error.

Restart Folklet after the browser is ready. Folklet may also discover installed Edge/Chrome. Browser access is activated by tasks or manual browser actions, rather than a separate global browser permission switch. Only request browser work when you intend to use it.

## 5. Optional: connect your iPhone

Have your administrator install Tailscale using its official instructions. Sign the server and iPhone into the same private Tailscale network. A server account may need explicit permission to manage Tailscale Serve; Folklet does not grant itself that permission or run sudo.

While using Folklet through the SSH tunnel, open **My workspace → Connect iPhone**, then start setup. The helper requires Tailscale already installed and signed in. If HTTPS permission is needed, it shows the official Tailscale action link.

The connection is private HTTPS on port 8443 to a separate authenticated gateway at 127.0.0.1:4320. Setup preserves conflicting Serve entries and refuses public Funnel. It does not repurpose another service.

Open the displayed address in Safari, enter a new pairing code, then choose **Share → Add to Home Screen**. Phone sessions can use your workspace and existing connections; adding accounts and enabling native access stay in the owner interface. Keep the server and Tailscale online. Full physical iPhone pairing still needs device validation in this preview.

## Optional native desktop access

A bare VPS has no desktop to control. Browser automation above works without a desktop. Native control requires a separately administered, unlocked **local X11 session** with xdotool and ImageMagick, plus explicit enabling in **Computer access** after every host restart. Every model screenshot and input still needs approval.

The service must be deliberately configured to access that desktop's session and authorization; this kit does not create one, expose remote desktop ports, or set DISPLAY for you. Wayland, forwarded SSH displays and locked sessions are unsupported. See native/README.md before setting this up. Never claim that a VPS desktop controls your home PC.

## Stop, update and back up

```sh
systemctl --user stop crew.service
systemctl --user start crew.service
systemctl --user restart crew.service
journalctl --user -u crew.service -n 50 --no-pager
```

Stop the service before taking a private backup of ~/.local/share/crew. Treat browser cookies, saved keys, phone sessions, files and conversations as sensitive. The official engine's account cache belongs to the OS user separately; sign in again when migrating rather than distributing credentials.

For an update, stop Folklet, back up private data, replace the application code with a reviewed release, rerun setup if dependencies changed, then start it and run a small check. The application folder path must remain the same unless you review and update ~/.config/crew/crew.env. Paused workflows stay paused; enabling a routine is your choice.

To stop automatic startup, run:

```sh
systemctl --user disable --now crew.service
```

Service files are ~/.config/systemd/user/crew.service, ~/.config/crew/crew.env and ~/.local/lib/crew/start-host.sh. Removing a service does not erase your private data. Review those exact files before removing them, and preserve any backups you need. Log output can contain private task information; redact it before sharing.