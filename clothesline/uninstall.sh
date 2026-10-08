#!/usr/bin/env bash
# Removes Clothesline and everything it stored. Your screenshots are not touched.
set -euo pipefail

uuid="clothesline@abrahamaschalew.github.io"
gnome-extensions disable "$uuid" 2>/dev/null || true
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/clothesline"
dconf reset -f /org/gnome/shell/extensions/clothesline/ 2>/dev/null || true
echo "Clothesline removed. Log out and back in to unload it completely."
