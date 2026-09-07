#!/bin/sh
set -eu
if [ "$(uname -s)" != "Darwin" ]; then printf '%s\n' 'Build this helper on macOS with Apple command line developer tools.' >&2; exit 1; fi
if [ "$#" -ne 2 ] || [ "$1" != '--arch' ]; then printf '%s\n' 'Usage: ./native/Build-macOS.sh --arch arm64|x64' >&2; exit 1; fi
case "$2" in arm64) crew_target='arm64-apple-macosx12.0';; x64) crew_target='x86_64-apple-macosx12.0';; *) printf '%s\n' 'Choose arm64 or x64.' >&2; exit 1;; esac
crew_native_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
crew_sdk=$(xcrun --sdk macosx --show-sdk-path)
xcrun swiftc -O -sdk "$crew_sdk" -target "$crew_target" -framework ApplicationServices -framework CoreGraphics "$crew_native_root/macos-control.swift" -o "$crew_native_root/macos-control-$2"
printf '%s\n' "Built native/macos-control-$2. Package only the matching architecture as native/macos-control."
