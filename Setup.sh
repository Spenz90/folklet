#!/bin/sh
# Local macOS/Linux source bootstrap. No sudo, system installation or account changes.
set -eu
crew_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
crew_cache="$crew_root/.cache/crew-setup"
crew_offline=0
crew_browser=auto
while [ "$#" -gt 0 ]; do
    case "$1" in
        --cache)
            [ "$#" -ge 2 ] || { echo 'Missing --cache directory.' >&2; exit 1; }
            crew_cache=$2; shift 2 ;;
        --offline) crew_offline=1; shift ;;
        --skip-browser) crew_browser=skip; shift ;;
        --install-browser) crew_browser=always; shift ;;
        --help)
            echo 'Usage: sh ./Setup.sh [--cache directory] [--offline] [--skip-browser | --install-browser]'
            echo 'Quit Crew first. The default installs Chromium only if no suitable browser is found.'
            exit 0 ;;
        *) echo "Unknown setup option: $1" >&2; exit 1 ;;
    esac
done
case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)
        crew_platform=darwin-arm64
        crew_archive_sha=8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d
        crew_node_sha=27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1 ;;
    Darwin-x86_64)
        crew_platform=darwin-x64
        crew_archive_sha=d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316
        crew_node_sha=1052eb9c7d6c60a79b968e09f75af55a73462b0f6dff0964336d63b5e13eb63c ;;
    Linux-x86_64)
        crew_platform=linux-x64
        crew_archive_sha=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4
        crew_node_sha=bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12 ;;
    *) echo 'Supported source hosts: macOS 15+ (Apple Silicon or Intel), or Linux x64 with glibc 2.38+.' >&2; exit 1 ;;
esac
if [ "$(uname -s)" = Darwin ]; then
    crew_macos=$(/usr/bin/sw_vers -productVersion)
    [ "${crew_macos%%.*}" -ge 15 ] || { echo 'Crew requires macOS 15 or later.' >&2; exit 1; }
fi
command -v tar >/dev/null 2>&1 || { echo 'Install tar before running setup.' >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
    crew_hash() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    crew_hash() { shasum -a 256 "$1" | awk '{print $1}'; }
else
    echo 'Setup requires sha256sum or shasum to verify downloads.' >&2; exit 1
fi
mkdir -p "$crew_cache"
crew_cache=$(CDPATH= cd -- "$crew_cache" && pwd)
crew_archive="node-v24.19.0-$crew_platform.tar.gz"
crew_archive_path="$crew_cache/$crew_archive"
crew_temp=$(mktemp -d "$crew_cache/extract-bootstrap-XXXXXXXX")
crew_cleanup() {
    case "$crew_temp" in "$crew_cache"/extract-bootstrap-*) rm -rf -- "$crew_temp" ;; esac
}
trap crew_cleanup EXIT HUP INT TERM
if [ ! -f "$crew_archive_path" ]; then
    [ "$crew_offline" -eq 0 ] || { echo "Offline Node archive is missing: $crew_archive" >&2; exit 1; }
    command -v curl >/dev/null 2>&1 || { echo 'Install curl before running setup.' >&2; exit 1; }
    echo "Downloading $crew_archive..."
    curl --proto '=https' --tlsv1.2 --fail --location --retry 2 --output "$crew_temp/node.tar.gz" "https://nodejs.org/dist/v24.19.0/$crew_archive"
    [ "$(crew_hash "$crew_temp/node.tar.gz")" = "$crew_archive_sha" ] || { echo 'Node archive checksum mismatch.' >&2; exit 1; }
    mv "$crew_temp/node.tar.gz" "$crew_archive_path"
fi
[ "$(crew_hash "$crew_archive_path")" = "$crew_archive_sha" ] || { echo 'Cached Node archive checksum mismatch.' >&2; exit 1; }
tar -xzf "$crew_archive_path" -C "$crew_temp" "node-v24.19.0-$crew_platform/bin/node"
crew_node="$crew_temp/node-v24.19.0-$crew_platform/bin/node"
[ "$(crew_hash "$crew_node")" = "$crew_node_sha" ] || { echo 'Node executable checksum mismatch.' >&2; exit 1; }
chmod 755 "$crew_node"
set -- "$crew_root/scripts/Install-Platform.mjs" --platform "$crew_platform" --root "$crew_root" --cache "$crew_cache" --install-dependencies
[ "$crew_offline" -eq 0 ] || set -- "$@" --offline
case "$crew_browser" in auto) set -- "$@" --browser-if-needed ;; always) set -- "$@" --install-browser ;; esac
"$crew_node" "$@"
echo 'Crew source dependencies are ready. See README.md for starting the host or building the desktop app.'
