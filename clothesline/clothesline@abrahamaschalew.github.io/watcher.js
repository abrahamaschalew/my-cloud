import Gettext from 'gettext';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp', 'avif', 'heic']);

/**
 * The folder GNOME Shell saves screenshots to: ~/Pictures/Screenshots, with
 * both parts in the user's language, exactly as the screenshot tool builds it.
 */
export function defaultScreenshotFolder() {
    return GLib.build_filenamev([
        GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || GLib.get_home_dir(),
        Gettext.dgettext('gnome-shell', 'Screenshots'),
    ]);
}

export function isImage(path) {
    const name = GLib.path_get_basename(path);
    if (name.startsWith('.'))
        return false;
    const dot = name.lastIndexOf('.');
    return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Watches the screenshot folder and reports new images. Clothesline never
 * takes screenshots itself: you keep the Print key (or any other tool) and
 * the line just picks up what lands in the folder.
 */
export class ScreenshotWatcher {
    constructor(path, {onNew, onChanged, onGone}) {
        this.path = path;
        this._onNew = onNew;
        this._onChanged = onChanged;
        this._onGone = onGone;
        this._known = new Set();
        this._dirty = new Set();
        this._gone = new Set();
        this._flushId = 0;
    }

    start() {
        const dir = Gio.File.new_for_path(this.path);
        try {
            dir.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                console.warn(`Clothesline: cannot create ${this.path}: ${e.message}`);
        }

        // Whatever is already there counts as old. Only what arrives from now on hangs.
        this._known = new Set(this._listing());

        this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitor.connect('changed', this._onEvent.bind(this));
    }

    stop() {
        if (this._flushId) {
            GLib.source_remove(this._flushId);
            this._flushId = 0;
        }
        this._monitor?.cancel();
        this._monitor = null;
    }

    _listing() {
        const paths = [];
        let enumerator;
        try {
            enumerator = Gio.File.new_for_path(this.path).enumerate_children(
                'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            return paths;
        }
        let info;
        while ((info = enumerator.next_file(null)) !== null)
            paths.push(GLib.build_filenamev([this.path, info.get_name()]));
        enumerator.close(null);
        return paths;
    }

    _onEvent(_monitor, file, other, type) {
        const E = Gio.FileMonitorEvent;
        switch (type) {
        // A new file is only picked up once it has been written completely.
        case E.CHANGES_DONE_HINT:
        case E.MOVED_IN:
            this._dirty.add(file.get_path());
            break;
        case E.RENAMED:
            this._gone.add(file.get_path());
            if (other)
                this._dirty.add(other.get_path());
            break;
        case E.DELETED:
        case E.MOVED_OUT:
            this._gone.add(file.get_path());
            break;
        default:
            return;
        }

        if (this._flushId)
            GLib.source_remove(this._flushId);
        this._flushId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._flushId = 0;
            this._flush();
            return GLib.SOURCE_REMOVE;
        });
    }

    _flush() {
        for (const path of this._gone) {
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                continue;
            this._known.delete(path);
            this._onGone(path);
        }
        for (const path of this._dirty) {
            if (!isImage(path) || !GLib.file_test(path, GLib.FileTest.IS_REGULAR))
                continue;
            if (this._known.has(path)) {
                this._onChanged(path);
            } else {
                this._known.add(path);
                this._onNew(path);
            }
        }
        this._gone.clear();
        this._dirty.clear();
    }
}
