#!/usr/bin/env bash
# Installs Clothesline for the current user. No root, no downloads.
set -euo pipefail

uuid="clothesline@abrahamaschalew.github.io"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"

# 1. Check the code first. Nothing is copied if the audit fails.
"$here/scripts/audit.sh"
echo

# 2. Check the GNOME version.
version=$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
if [[ -z "$version" ]]; then
    echo "GNOME Shell not found. Clothesline is a GNOME Shell extension." >&2
    exit 1
fi
if ((version < 45 || version > 50)); then
    echo "Warning: GNOME Shell $version is not in the supported range (45 to 50)."
fi

# 3. Copy and compile the settings schema.
rm -rf "$dest"
mkdir -p "$dest"
cp -r "$here/$uuid/." "$dest/"
glib-compile-schemas "$dest/schemas"
echo "Installed to $dest"

# 4. Turn it on.
gnome-extensions enable "$uuid" 2>/dev/null || true
if gnome-extensions info "$uuid" 2>/dev/null | grep -qE 'State: (ACTIVE|ENABLED)'; then
    echo "Clothesline is on. Take a screenshot with the Print key."
    exit 0
fi

# GNOME on Wayland only discovers new extensions when you log in, so mark it
# to start then.
current=$(gsettings get org.gnome.shell enabled-extensions)
if [[ "$current" != *"'$uuid'"* ]]; then
    if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
        gsettings set org.gnome.shell enabled-extensions "['$uuid']"
    else
        gsettings set org.gnome.shell enabled-extensions "${current%]}, '$uuid']"
    fi
fi
echo
echo "Almost there: log out and back in. Clothesline starts on its own after that."
