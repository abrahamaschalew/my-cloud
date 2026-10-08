import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Card, CARD_WIDTH} from './card.js';
import {clearThumbnails} from './thumbnails.js';

const HEIGHT = 210;
const ROPE_TOP = 10;
const SPACING = 174;
const PIN_ABOVE = 9.5;
/** How long the pointer may be away before the line tucks itself away. */
const AWAY_MS = 450;

const {EASE_IN_QUAD, EASE_OUT_BACK} = Clutter.AnimationMode;

/** The rope hangs as a parabola from edge to edge of the screen. */
function sag(width) {
    return Math.min(30, width * 0.018);
}

function ropeY(x, width) {
    if (width <= 0)
        return ROPE_TOP;
    const f = x / width;
    return ROPE_TOP + 4 * sag(width) * f * (1 - f);
}

/**
 * The line along the top of the screen and what hangs on it.
 *
 * Tucked away, it waits hidden under the top bar and slides out from under
 * it, the way an auto-hiding dock does. It only takes clicks on the photos:
 * everywhere else, clicks go to the windows underneath.
 */
export class Line {
    constructor(settings, {onChanged}) {
        this.settings = settings;
        this._onChanged = onChanged;
        this._cards = [];
        this._revealed = false;
        this._pinned = false;
        this._visited = false;
        this._peekUntil = 0;
        this._awaySince = 0;
        this._width = 0;
        this.menuOpen = false;

        clearThumbnails();

        this._wrapper = new St.Widget({clip_to_allocation: true, visible: false});
        this._strip = new St.Widget({translation_y: -(HEIGHT + 12)});
        this._wrapper.add_child(this._strip);

        this._rope = new St.DrawingArea({height: 60});
        this._rope.connect('repaint', area => this._drawRope(area));
        this._strip.add_child(this._rope);

        this._hint = new St.Label({style_class: 'clothesline-hint', text: 'Take a screenshot and it will hang here'});
        this._strip.add_child(this._hint);

        // Above windows, below notifications, like the top bar. Each photo adds
        // itself to the input region (see hang), the line as a whole does not.
        Main.layoutManager.addChrome(this._wrapper, {affectsInputRegion: false});
        if (Main.messageTray.get_parent() === this._wrapper.get_parent())
            this._wrapper.get_parent().set_child_below_sibling(this._wrapper, Main.messageTray);

        this._signals = [
            [Main.overview, Main.overview.connect('showing', () => this._hideNow())],
            [Main.panel, Main.panel.connect('button-press-event', () => {
                this.tuck();
                return Clutter.EVENT_PROPAGATE;
            })],
            [global.display, global.display.connect('in-fullscreen-changed', () => {
                if (this._revealed && this._monitor?.inFullscreen)
                    this._hideNow();
            })],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._hideNow())],
        ];
    }

    destroy() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        this._stopTimers();
        this._wrapper.destroy();
        this._cards = [];
    }

    // MARK: What hangs

    get paths() {
        return this._cards.map(c => c.path);
    }

    has(path) {
        return this._cards.some(c => c.path === path);
    }

    /**
     * Hangs a screenshot. `arrive` drops it in with a swing, otherwise it is
     * simply there, as after unlocking the screen.
     */
    async hang(path, {arrive = true} = {}) {
        if (this.has(path))
            return;

        const card = new Card(this, path);
        this._cards.push(card);
        this._strip.add_child(card.actor);
        Main.layoutManager.trackChrome(card.frame, {affectsInputRegion: true});

        const max = Math.min(this.settings.get_int('max-items'), this._capacity());
        while (this._cards.length > max)
            this.unhang(this._cards[0].path, {fall: arrive});

        this._changed();
        try {
            await card.load();
        } catch (e) {
            console.warn(`Clothesline: cannot read ${path}: ${e.message}`);
            this.unhang(path, {fall: false});
            return;
        }
        if (card.destroyed)
            return;
        this._layout(arrive);
        if (arrive)
            card.dropIn();
        else
            card.appear();
    }

    unhang(path, {fall = true} = {}) {
        const card = this._cards.find(c => c.path === path);
        if (!card)
            return;
        this._cards = this._cards.filter(c => c !== card);
        if (fall && this._revealed && card.loaded)
            card.fall();
        else
            card.actor.destroy();
        this._layout(true);
        this._changed();
    }

    clear() {
        for (const card of [...this._cards])
            this.unhang(card.path, {fall: true});
    }

    /** The image changed on disk, after marking it up for example. */
    async reload(path) {
        const card = this._cards.find(c => c.path === path);
        if (!card)
            return;
        try {
            await card.load();
            this._layout(true);
            card.swing(2.2);
        } catch (e) {
            console.warn(`Clothesline: cannot reload ${path}: ${e.message}`);
        }
    }

    _changed() {
        this._hint.visible = this._cards.length === 0;
        this._onChanged(this.paths);
    }

    _capacity() {
        const width = this._width || Main.layoutManager.primaryMonitor?.width || 1920;
        return Math.max(1, Math.floor((width - 40 - CARD_WIDTH) / SPACING) + 1);
    }

    // MARK: Layout

    _place(monitor) {
        const isPrimary = monitor.index === Main.layoutManager.primaryIndex;
        const top = isPrimary ? Main.layoutManager.panelBox.height : 0;
        this._monitor = monitor;
        this._width = monitor.width;
        this._wrapper.set_position(monitor.x, monitor.y + top);
        this._wrapper.set_size(monitor.width, HEIGHT);
        this._strip.set_size(monitor.width, HEIGHT);
        this._rope.width = monitor.width;
        this._rope.queue_repaint();
        this._layout(false);
    }

    _layout(animate) {
        const width = this._width;
        if (!width)
            return;
        const cards = this._cards.filter(c => c.loaded);
        const total = Math.max(cards.length - 1, 0) * SPACING;
        cards.forEach((card, i) => {
            const cx = width / 2 - total / 2 + i * SPACING;
            card.moveTo(Math.round(cx - CARD_WIDTH / 2), Math.round(ropeY(cx, width) - PIN_ABOVE), animate);
        });

        const [, natWidth] = this._hint.get_preferred_width(-1);
        this._hint.set_position(Math.round((width - natWidth) / 2), Math.round(ropeY(width / 2, width) + 22));
    }

    /** A thin, neutral line that reads on light and dark wallpapers alike, fading out at both ends. */
    _drawRope(area) {
        const cr = area.get_context();
        const [width] = area.get_surface_size();
        const top = ROPE_TOP;
        const qx = width / 2, qy = top + 2 * sag(width);
        const x0 = -20, x1 = width + 20;

        const stroke = (r, g, b, a, lineWidth, dy) => {
            const fade = new Cairo.LinearGradient(0, 0, width, 0);
            fade.addColorStopRGBA(0, r, g, b, 0);
            fade.addColorStopRGBA(0.08, r, g, b, a);
            fade.addColorStopRGBA(0.92, r, g, b, a);
            fade.addColorStopRGBA(1, r, g, b, 0);
            cr.save();
            cr.translate(0, dy);
            cr.newPath();
            cr.moveTo(x0, top);
            // The quadratic curve through (qx, qy), written as a cubic one.
            cr.curveTo(
                x0 + (2 / 3) * (qx - x0), top + (2 / 3) * (qy - top),
                x1 + (2 / 3) * (qx - x1), top + (2 / 3) * (qy - top),
                x1, top);
            cr.setSource(fade);
            cr.setLineWidth(lineWidth);
            cr.stroke();
            cr.restore();
        };
        stroke(0, 0, 0, 0.22, 2.2, 1.2);
        stroke(0.55, 0.55, 0.55, 1, 1.2, 0);
        stroke(1, 1, 1, 0.45, 0.4, -0.35);
        cr.$dispose();
    }

    // MARK: Showing and tucking away

    get revealed() {
        return this._revealed;
    }

    /**
     * Slides the line down on the screen with the pointer.
     *
     * pinned: opened on purpose, it stays until the pointer has visited it
     * and left. peek: stays at least this many milliseconds.
     */
    reveal({pinned = false, peek = 0} = {}) {
        if (Main.overview.visible || Main.sessionMode.isLocked)
            return;
        const monitor = Main.layoutManager.currentMonitor;
        if (!monitor || monitor.inFullscreen)
            return;

        if (pinned) {
            this._pinned = true;
            this._visited = false;
        }
        if (peek)
            this._peekUntil = Math.max(this._peekUntil, Date.now() + peek);
        this._awaySince = 0;

        if (this._revealed && this._monitor === monitor)
            return;
        if (this._revealed)
            this._hideNow();

        this._revealed = true;
        this._place(monitor);
        this._wrapper.show();
        this._strip.remove_all_transitions();
        this._strip.ease({
            translation_y: 0,
            duration: 380,
            mode: EASE_OUT_BACK,
            onComplete: () => this._regionsChanged(),
        });
        this._startTimers();
    }

    tuck() {
        if (!this._revealed)
            return;
        this._revealed = false;
        this._pinned = false;
        this._peekUntil = 0;
        this._stopTimers();
        this._strip.ease({
            translation_y: -(HEIGHT + 12),
            duration: 220,
            mode: EASE_IN_QUAD,
            onComplete: () => {
                if (!this._revealed)
                    this._wrapper.hide();
                this._regionsChanged();
            },
        });
    }

    toggle() {
        if (this._revealed)
            this.tuck();
        else
            this.reveal({pinned: true});
    }

    _hideNow() {
        this._revealed = false;
        this._pinned = false;
        this._peekUntil = 0;
        this._stopTimers();
        this._strip.remove_all_transitions();
        this._strip.translation_y = -(HEIGHT + 12);
        this._wrapper.hide();
        this._regionsChanged();
    }

    /** On X11 the shell only gets clicks inside its input region; keep it in sync. */
    _regionsChanged() {
        Main.layoutManager._queueUpdateRegions?.();
    }

    _startTimers() {
        this._stopTimers();
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._checkPointer();
            return GLib.SOURCE_CONTINUE;
        });
        this._scheduleGust();
    }

    _stopTimers() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        if (this._gustId) {
            GLib.source_remove(this._gustId);
            this._gustId = 0;
        }
    }

    _checkPointer() {
        if (this.menuOpen || this._cards.some(c => c.pressed))
            return;
        const [x, y] = global.get_pointer();
        if (this._pointerInside(x, y)) {
            this._visited = true;
            this._awaySince = 0;
            return;
        }
        if (Date.now() < this._peekUntil || (this._pinned && !this._visited))
            return;
        const now = Date.now();
        if (!this._awaySince)
            this._awaySince = now;
        else if (now - this._awaySince > AWAY_MS)
            this.tuck();
    }

    _pointerInside(x, y) {
        const m = this._monitor;
        if (!m || x < m.x || x >= m.x + m.width || y < m.y)
            return false;
        // The top bar above the line counts as part of it.
        if (y <= this._wrapper.y + 2)
            return true;
        const targets = this._cards.filter(c => c.loaded).map(c => c.frame);
        if (this._hint.visible)
            targets.push(this._hint);
        return targets.some(actor => {
            const [ax, ay] = actor.get_transformed_position();
            const [aw, ah] = actor.get_transformed_size();
            const pad = 16;
            return x >= ax - pad && x <= ax + aw + pad && y >= ay - pad - 30 && y <= ay + ah + pad;
        });
    }

    /** Every now and then a little wind goes through the line. */
    _scheduleGust() {
        this._gustId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 7000 + Math.random() * 8000, () => {
            this._gustId = 0;
            for (const card of this._cards) {
                if (card.loaded && !card.pressed)
                    card.breeze();
            }
            if (this._revealed)
                this._scheduleGust();
            return GLib.SOURCE_REMOVE;
        });
    }
}
