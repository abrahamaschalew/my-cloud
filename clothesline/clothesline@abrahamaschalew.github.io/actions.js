import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Image editors tried in order for "mark up", if installed. */
const EDITORS = [
    'com.github.maoschanz.drawing.desktop',
    'com.github.PintaProject.Pinta.desktop',
    'pinta.desktop',
    'org.kde.kolourpaint.desktop',
    'org.gimp.GIMP.desktop',
    'gimp.desktop',
];

function launchContext() {
    return global.create_app_launch_context(0, -1);
}

/** Puts the image itself on the clipboard, the way the screenshot tool does. */
export function copyImage(path) {
    const file = Gio.File.new_for_path(path);
    return new Promise((resolve, reject) => {
        file.load_contents_async(null, (f, res) => {
            try {
                const [, contents] = f.load_contents_finish(res);
                const [type] = Gio.content_type_guess(path, null);
                const mime = Gio.content_type_get_mime_type(type) ?? 'image/png';
                St.Clipboard.get_default().set_content(
                    St.ClipboardType.CLIPBOARD, mime, new GLib.Bytes(contents));
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

/** Opens the image in the default image viewer. */
export function openImage(path) {
    try {
        Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(path).get_uri(), launchContext());
    } catch (e) {
        Main.notifyError('Clothesline', `Cannot open the screenshot: ${e.message}`);
    }
}

/** Opens the image in an editor, so it can be marked up. */
export function editImage(path, preferred) {
    const ids = preferred ? [preferred, ...EDITORS] : EDITORS;
    for (const id of ids) {
        let app = null;
        try {
            app = Gio.DesktopAppInfo.new(id);
        } catch {}
        if (app) {
            try {
                app.launch([Gio.File.new_for_path(path)], launchContext());
                return;
            } catch (e) {
                console.warn(`Clothesline: ${id} failed to start: ${e.message}`);
            }
        }
    }
    openImage(path);
    Main.notify('Clothesline', 'To mark up screenshots, install “Drawing” from the App Center.');
}

/** Shows the file selected in the Files app. */
export function showInFiles(path) {
    const uri = Gio.File.new_for_path(path).get_uri();
    Gio.DBus.session.call(
        'org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1', 'ShowItems',
        new GLib.Variant('(ass)', [[uri], '']), null,
        Gio.DBusCallFlags.NONE, -1, null,
        (conn, res) => {
            try {
                conn.call_finish(res);
            } catch {
                const folder = Gio.File.new_for_path(GLib.path_get_dirname(path)).get_uri();
                Gio.AppInfo.launch_default_for_uri(folder, launchContext());
            }
        });
}

/** Moves the file to the Trash, where it can still be restored from. */
export function trashImage(path) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).trash_async(GLib.PRIORITY_DEFAULT, null, (f, res) => {
            try {
                f.trash_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}
