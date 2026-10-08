#!/usr/bin/env bash
# Checks the extension before it is installed, so you can trust what runs
# inside your desktop. It fails if any file:
#   - is not plain text (no compiled code, libraries or hidden binaries),
#   - talks to the network (HTTP, sockets, web libraries),
#   - runs other programs or shell commands,
#   - builds code at runtime (eval, new Function),
#   - imports anything other than GNOME's own libraries and its own files.
# Then it prints a SHA-256 checksum of every file, so you can compare it with
# the one in the repository.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ext="$here/clothesline@abrahamaschalew.github.io"
fail=0

problem() {
    echo "  ✗ $1"
    fail=1
}

echo "Auditing $ext"

# 1. Only the files we expect, and all of them plain text.
while IFS= read -r -d '' f; do
    rel="${f#"$ext"/}"
    case "$rel" in
        *.js | *.json | *.css | *.svg | schemas/*.gschema.xml | schemas/gschemas.compiled) ;;
        *) problem "unexpected file: $rel" ;;
    esac
    [[ "$rel" == schemas/gschemas.compiled ]] && continue # made by glib-compile-schemas on your machine
    if LC_ALL=C grep -qP '[\x00-\x08\x0E-\x1F]' "$f"; then
        problem "not plain text: $rel"
    fi
done < <(find "$ext" -type f -print0)

# 2. Nothing that reaches the network, runs programs or evaluates code.
forbidden=(
    'Soup'                 # HTTP library
    'Gio\.Socket'          # raw sockets
    'SocketClient'
    'SocketService'
    'Gio\.Resolver'
    'NetworkMonitor'
    'WebKit'
    'https?://'            # any web address
    'Subprocess'           # running programs
    'spawn'
    'GLib\.spawn'
    'Util\.spawn'
    'trySpawn'
    'eval\s*\('            # code built at runtime
    'new Function'
    'imports\.'            # legacy imports could load arbitrary code
    'Gio\.Resource'
    'GIRepository'
    'set_attribute'        # changing file permissions or attributes
    'chmod'
)
for pattern in "${forbidden[@]}"; do
    if hits=$(grep -nEH "$pattern" "$ext"/*.js 2>/dev/null); then
        problem "forbidden pattern '$pattern':"
        echo "$hits" | sed 's/^/      /'
    fi
done

# 3. Imports: only GNOME libraries, GNOME Shell's own modules and our own files.
while IFS= read -r line; do
    module=$(sed -E "s/.*from '([^']+)'.*/\1/" <<<"$line")
    case "$module" in
        gi://Adw | gi://Clutter | gi://GdkPixbuf | gi://Gio | gi://GLib | gi://GObject | gi://Gtk | gi://Meta | gi://Shell | gi://St) ;;
        cairo | gettext) ;;
        resource:///org/gnome/shell/* | resource:///org/gnome/Shell/Extensions/js/*) ;;
        ./*.js) ;;
        *) problem "unexpected import: $line" ;;
    esac
done < <(grep -hE "^import .* from '" "$ext"/*.js)

# 4. The only D-Bus call asks the Files app to show a file.
for f in $(grep -lE 'DBus' "$ext"/*.js || true); do
    if [[ "$(basename "$f")" != actions.js ]]; then
        problem "D-Bus used in $(basename "$f")"
    fi
done
if grep -E 'DBus' "$ext/actions.js" | grep -vE "Gio\.DBus(\.session\.call\(|CallFlags)" >/dev/null; then
    problem "unexpected D-Bus use in actions.js"
fi
if grep -oE "'org\.[A-Za-z0-9.]+'" "$ext/actions.js" | grep -v "\.desktop'$" | grep -v "'org.freedesktop.FileManager1'" >/dev/null; then
    problem "D-Bus call to something other than the Files app"
fi

if [[ $fail -ne 0 ]]; then
    echo "Audit FAILED. Do not install this copy."
    exit 1
fi

echo "  ✓ plain text only, no network, no programs run, no code evaluated, known imports only"
echo
echo "SHA-256 of every file:"
(cd "$ext" && find . -type f ! -name gschemas.compiled -print0 | sort -z | xargs -0 sha256sum)
echo
echo "Audit passed."
