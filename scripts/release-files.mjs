import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// A positive file list keeps local data out even when packaging a used installation.
export const sourceFiles = [
  "credential-vault.mjs", "native/Vault-Windows.ps1", "backups.mjs", "draft-storage.mjs", "state-sync.mjs", "sync-client.mjs", "usage.mjs", "push-notifications.mjs", "plugin-catalog.mjs", "updates.mjs", "reliability-ui.mjs", "reliability.test.mjs", "hosting/restore-backup.mjs", "scripts/Publisher-Sign.mjs", "RECOVERY.md", "REAL-WORLD-CHECKS.md",
  '.gitignore', '.gitattributes', '.github/workflows/ci.yml', '.github/dependabot.yml',
  'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  'RELEASING.md', 'THIRD-PARTY-NOTICES.md', 'RELEASE-CHECKS.md',
  'QUICKSTART.md', 'PROVIDERS.md', 'HOSTING.md', 'BUSINESS.md', 'FEATURE-ROADMAP.md', 'FEATURES.md',
  'package.json', 'package-lock.json', 'PLUGINS.md',
  'host-status.mjs', 'host-status.test.mjs', 'hosting-ui.mjs', 'hosting-ui.test.mjs',
  'connection-state.mjs', 'connection-state.test.mjs', 'hosting/check-host.mjs',
  'plugins-ui.mjs', 'plugins-ui.test.mjs', 'plugin-connections.mjs', 'plugin-connections.test.mjs',
  'mcp-client.mjs', 'mcp-client.test.mjs', 'plugin-packages.mjs', 'plugin-packages.test.mjs', 'engine-plugins.test.mjs',
  'scripts/Linux-Sandbox.mjs', 'linux-sandbox.test.mjs',
  'account.mjs', 'app.js', 'calendar.mjs', 'computer.mjs', 'engine.mjs', 'http.mjs',
  'markdown.mjs', 'mobile.mjs', 'runtime.mjs', 'server.mjs', 'store.mjs',
  'settings-ui.mjs', 'providers.mjs', 'api-agent.mjs', 'learning.mjs', 'native-computer.mjs', 'attachments.mjs',
  'model-settings.mjs', 'model-settings-ui.mjs', 'reasoning.mjs',
  'review-data.mjs', 'review-ui-common.mjs', 'skills.mjs', 'skills-ui.mjs', 'learning-review-ui.mjs',
  'recall.mjs', 'recall-ui.mjs', 'routine-policy.mjs', 'routine-policy-ui.mjs',
  'fallback.mjs', 'fallback-ui.mjs', 'integrations.mjs', 'integrations-ui.mjs',
  'notifications.mjs', 'notifications-ui.mjs', 'app-changes.mjs', 'app-changes-ui.mjs',
  'index.html', 'style.css', 'pair.html', 'manifest.webmanifest',
  'service-worker.js', 'pwa.js', 'offline.html',
  'account.test.mjs', 'computer.test.mjs', 'client-state.test.mjs', 'engine.test.mjs', 'http.test.mjs',
  'markdown.test.mjs', 'mobile.test.mjs', 'runtime.test.mjs', 'schedule.test.mjs',
  'store.test.mjs', 'release.test.mjs', 'release-pipeline.test.mjs',
  'providers.test.mjs', 'api-agent.test.mjs', 'learning.test.mjs', 'learning-tools.test.mjs',
  'native-computer.test.mjs', 'phone-setup.test.mjs', 'platform-setup.test.mjs',
  'server-integration.test.mjs', 'unix-release.test.mjs', 'attachments.test.mjs', 'hosting.test.mjs',
  'model-settings.test.mjs', 'model-settings-ui.test.mjs', 'settings-ui.test.mjs', 'reasoning.test.mjs',
  'skills.test.mjs', 'review-ui.test.mjs', 'recall.test.mjs', 'routine-policy.test.mjs',
  'fallback.test.mjs', 'fallback-ui.test.mjs', 'engine-roadmap.test.mjs',
  'integrations.test.mjs', 'integrations-ui.test.mjs', 'notifications.test.mjs', 'app-changes.test.mjs',
  'Setup.ps1', 'Setup.sh', 'Launch.ps1', 'Start Crew.cmd', 'Start Folklet.cmd', 'Connect iPhone.cmd',
  'scripts/dependencies.json', 'scripts/Dependencies.ps1', 'scripts/Install-Runtime.ps1',
  'scripts/Package.ps1', 'scripts/release-files.mjs',
  'scripts/Install-Platform.mjs', 'scripts/platform-dependencies.json',
  'scripts/Build-Unix.mjs', 'scripts/Sign-Mac.mjs', 'scripts/electron-releases.json',
  'scripts/Smoke-Desktop.mjs', 'scripts/Check-Release.mjs', 'scripts/Prepare-Corresponding-Source.mjs', 'scripts/corresponding-source.json',
  'electron/package.json', 'electron/main.cjs', 'electron/host.cjs', 'electron/policy.cjs', 'electron/shell.test.cjs', 'electron/smoke.cjs', 'electron/smoke.test.cjs',
  'native/README.md', 'native/Build-Windows.ps1', 'native/windows-control.cs',
  'native/Build-macOS.sh', 'native/macos-control.swift',
  'hosting/README.md', 'hosting/crew.service', 'hosting/install-user-service.sh', 'hosting/crew.env.example',
  'hosting/install-user-service.mjs', 'hosting/start-host.sh',
  'desktop/Build.ps1', 'desktop/Crew.cs', 'desktop/Crew.manifest',
  'desktop/Crew.exe.config', 'desktop/README.md', 'desktop/Make-Icon.ps1',
  'desktop/crew.ico', 'desktop/WebView2-LICENSE.txt',
  'icons/crew.svg', 'icons/crew.ico', 'icons/crew-192.png', 'icons/crew-512.png',
  'icons/crew-maskable-512.png', 'icons/apple-touch-icon.png',
  'mobile/Setup-iPhone.ps1', 'mobile/Setup-iPhone.mjs', 'runtime/LICENSE.txt',
  'runtime/codex/runtime-source.json', 'runtime/codex/LICENSE', 'runtime/codex/NOTICE',
  'runtime/codex/RIPGREP-COPYING', 'runtime/codex/RIPGREP-LICENSE-MIT', 'runtime/codex/RIPGREP-UNLICENSE',
  'runtime/codex/ZSH-LICENCE', 'runtime/codex/BUBBLEWRAP-COPYING', 'runtime/codex/UNIX-SOURCES.md'
];
const windowsFiles = [
  'runtime/node.exe', 'runtime/codex/codex.exe', 'runtime/codex/codex-code-mode-host.exe',
  'runtime/codex/codex-command-runner.exe', 'runtime/codex/codex-windows-sandbox-setup.exe',
  'runtime/codex/rg.exe', 'desktop/Crew.exe', 'desktop/Microsoft.Web.WebView2.Core.dll',
  'desktop/Microsoft.Web.WebView2.WinForms.dll', 'desktop/WebView2Loader.dll', 'native/windows-control.exe'
];

export function validateRelativeFile(relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || path.posix.isAbsolute(relative) ||
      relative.split('/').some(p => !p || p === '.' || p === '..') || relative.includes(':')) {
    throw Error('Invalid release path');
  }
  if (/(^|\/)(data|profile|browser-profiles|\.git|\.codex)(\/|$)/i.test(relative) ||
      /(^|\/)(auth|credentials|mobile)\.json$/i.test(relative) ||
      /(^|\/)\.env(?:\.|$)/i.test(relative) || /\.(log|pem|key|pfx|p12)$/i.test(relative)) {
    throw Error('Private or generated file is not allowed in a release');
  }
  return relative;
}

function regularFile(root, relative) {
  validateRelativeFile(relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error(`Release symlink refused: ${relative}`);
  }
  if (!fs.statSync(current).isFile()) throw Error(`Release entry is not a file: ${relative}`);
  return current;
}

function tree(root, relative) {
  if (fs.lstatSync(path.join(root, relative)).isSymbolicLink()) throw Error('Dependency symlink refused');
  return fs.readdirSync(path.join(root, relative), {withFileTypes: true}).flatMap(entry => {
    const child = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw Error(`Dependency symlink refused: ${child}`);
    return entry.isDirectory() ? tree(root, child) : [child];
  });
}

export function checkSourceText(relative, text) {
  // Fail with a path only: never echo potentially sensitive contents into build logs.
  const privatePath = /[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+(?!Public(?:[\\/]|$))[^\\/\s"']+/i;
  const unixPrivatePath = /(?:^|[\s"'`=(])\/(?:Users|home)\/(?!Shared(?:\/|$))[^\/\s"'`]+(?:\/|$)/m;
  const credential = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/;
  if (privatePath.test(text) || unixPrivatePath.test(text) || credential.test(text)) throw Error(`Potential private content in ${relative}; inspect locally before sharing.`);
}

export function collectReleaseFiles(root, kind = 'Source') {
  if (!['Source', 'Windows'].includes(kind)) throw Error('Choose Source or Windows');
  root = fs.realpathSync(root);
  const files = [...sourceFiles];
  if (kind === 'Windows') {
    files.push(...windowsFiles);
    for (const [dependency,version] of Object.entries({playwright:'1.62.1','playwright-core':'1.62.1',yauzl:'3.4.0',pend:'1.2.0'})) {
      const packageFile = regularFile(root, `node_modules/${dependency}/package.json`);
      if (JSON.parse(fs.readFileSync(packageFile)).version !== version) throw Error(`Unexpected ${dependency} version`);
      files.push(...tree(root, `node_modules/${dependency}`));
    }
    const pins = JSON.parse(fs.readFileSync(regularFile(root, 'scripts/dependencies.json')));
    const nodeHash = createHash('sha256').update(fs.readFileSync(regularFile(root, 'runtime/node.exe'))).digest('hex');
    if (nodeHash !== pins.node.executableSha256.toLowerCase()) throw Error('Runtime hash mismatch: node.exe');
    const provenance = JSON.parse(fs.readFileSync(regularFile(root, 'runtime/codex/runtime-source.json')));
    for (const component of [...provenance.files, ...provenance.licenseFiles]) {
      const p = regularFile(root, `runtime/codex/${component.file}`);
      const actual = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      if (actual.toLowerCase() !== component.sha256.toLowerCase()) throw Error(`Runtime hash mismatch: ${component.file}`);
    }
  }
  return [...new Set(files)].sort().map(relative => {
    const absolute = regularFile(root, relative);
    const size = fs.statSync(absolute).size;
    if (kind === 'Source' && size > 10 * 1024 * 1024) throw Error(`Source file too large: ${relative}`);
    if (sourceFiles.includes(relative) && !/\.(png|ico)$/.test(relative)) checkSourceText(relative, fs.readFileSync(absolute, 'utf8'));
    return relative;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  console.log(JSON.stringify(collectReleaseFiles(root, process.argv[3] || 'Source')));
}
