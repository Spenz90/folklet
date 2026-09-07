# Optional Ubuntu user service

Start with [HOSTING.md](../HOSTING.md). This kit targets one trusted owner on Ubuntu 24.04 x64. It installs user-owned files only; it does not buy or provision a VPS, install system packages, change networking, enable native control or start a service automatically.

From the Crew application folder, after source setup:

```sh
sh hosting/install-user-service.sh --dry-run
sh hosting/install-user-service.sh
systemctl --user enable --now crew.service
```

The shell wrapper uses Crew's bundled Node to run the installer. The installer validates its platform, runtime and target files, refuses differing existing settings and symbolic links, writes a systemd user unit/launcher/environment file, and reloads the current user's manager. The explicit systemctl command starts and enables Crew.

Data: ~/.local/share/crew. Configuration: ~/.config/crew/crew.env. Service: ~/.config/systemd/user/crew.service. Launcher: ~/.local/lib/crew/start-host.sh. API keys are entered through the owner interface, not this environment file.

The launcher keeps the service on Crew's standard loopback ports, points optional browser downloads at the private data directory, and removes Node injection overrides. The service uses restrictive default file permissions, restarts a failed host and stops its own child processes as a group.

There is no automatic removal or data deletion. Stop/disable the service first and review these exact files before manually removing them. Existing custom settings need review rather than forced overwrite.

Automated tests cover configuration generation and refusal of conflicting files. Shell syntax is checked. No actual Ubuntu systemd service or VPS was started during development on Windows. See the main hosting guide for SSH access, account sign-in, browser dependencies, explicit lingering, updates and phone pairing.