import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Line} from './line.js';
import {ScreenshotWatcher, defaultScreenshotFolder, isImage} from './watcher.js';

/** Pushing this many pixels against the top edge within a second brings the line down. */
const PRESSURE_THRESHOLD = 120;
const PRESSURE_TIMEOUT = 1000;
/** Keep the corners free for the Activities hot corner and the system menu. */
const EDGE_INSET = 120;
/** A new screenshot shows itself for this long, then the line tucks away. */
const PEEK_MS = 2500;

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Clothesline');
        this._extension = extension;

        this.add_child(new St.Icon({
            gicon: Gio.FileIcon.new(extension.dir.get_child('icons').get_child('clothesline-symbolic.svg')),
            style_class: 'system-status-icon',
        }));

        this.menu.addAction('Show the Line', () => extension.line.reveal({pinned: true}));
        this.menu.addAction('Open Screenshots Folder', () => {
            Gio.AppInfo.launch_default_for_uri(
                Gio.File.new_for_path(extension.folder).get_uri(),
                global.create_app_launch_context(0, -1));
        });
        this.menu.addAction('Take Everything Off', () => extension.line.clear());
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Preferences', () => extension.openPreferences());
    }
});

export default class ClotheslineExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this.line = new Line(this._settings, {
            onChanged: paths => this._settings.set_strv('hanging', paths),
        });

        // What was hanging before locking the screen or logging out.
        for (const path of this._settings.get_strv('hanging')) {
            if (isImage(path) && Gio.File.new_for_path(path).query_exists(null))
                this.line.hang(path, {arrive: false});
        }

        this._startWatcher();

        Main.wm.addKeybinding('toggle-line', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                if (Main.overview.visible)
                    Main.overview.hide();
                this.line.toggle();
            });

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => this._updateBarriers());
        this._updateBarriers();
        this._updateIndicator();

        this._settingsIds = [
            this._settings.connect('changed::folder', () => this._startWatcher()),
            this._settings.connect('changed::edge-reveal', () => this._updateBarriers()),
            this._settings.connect('changed::show-indicator', () => this._updateIndicator()),
        ];
    }

    disable() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = null;
        Main.layoutManager.disconnect(this._monitorsChangedId);
        Main.wm.removeKeybinding('toggle-line');
        this._removeBarriers();
        this._indicator?.destroy();
        this._indicator = null;
        this._watcher?.stop();
        this._watcher = null;
        this.line.destroy();
        this.line = null;
        this._settings = null;
    }

    get folder() {
        return this._settings.get_string('folder') || defaultScreenshotFolder();
    }

    _startWatcher() {
        this._watcher?.stop();
        this._watcher = new ScreenshotWatcher(this.folder, {
            onNew: path => {
                if (this._settings.get_boolean('peek-on-new'))
                    this.line.reveal({peek: PEEK_MS});
                this.line.hang(path);
            },
            onChanged: path => this.line.reload(path),
            onGone: path => this.line.unhang(path, {fall: true}),
        });
        this._watcher.start();
    }

    _updateIndicator() {
        const show = this._settings.get_boolean('show-indicator');
        if (show && !this._indicator) {
            this._indicator = new Indicator(this);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!show && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    // MARK: The top edge

    _updateBarriers() {
        this._removeBarriers();
        if (!this._settings.get_boolean('edge-reveal'))
            return;

        this._pressureBarrier = new Layout.PressureBarrier(
            PRESSURE_THRESHOLD, PRESSURE_TIMEOUT, Shell.ActionMode.NORMAL);
        this._pressureBarrier.connect('trigger', () => this.line.reveal({pinned: true}));
        this._barriers = [];
        for (const monitor of Main.layoutManager.monitors) {
            if (monitor.width <= EDGE_INSET * 3)
                continue;
            // Only where nothing sits above: a monitor stacked under another one has no top edge.
            const covered = Main.layoutManager.monitors.some(other => other !== monitor &&
                other.y + other.height === monitor.y &&
                other.x < monitor.x + monitor.width && other.x + other.width > monitor.x);
            if (covered)
                continue;
            const barrier = this._makeBarrier({
                x1: monitor.x + EDGE_INSET, x2: monitor.x + monitor.width - EDGE_INSET,
                y1: monitor.y, y2: monitor.y,
                directions: Meta.BarrierDirection.POSITIVE_Y,
            });
            this._pressureBarrier.addBarrier(barrier);
            this._barriers.push(barrier);
        }
    }

    _makeBarrier(params) {
        try {
            // GNOME 46 and later.
            return new Meta.Barrier({backend: global.backend, ...params});
        } catch {
            // GNOME 45.
            return new Meta.Barrier({display: global.display, ...params});
        }
    }

    _removeBarriers() {
        this._pressureBarrier?.destroy();
        this._pressureBarrier = null;
        for (const barrier of this._barriers ?? [])
            barrier.destroy();
        this._barriers = [];
    }
}
