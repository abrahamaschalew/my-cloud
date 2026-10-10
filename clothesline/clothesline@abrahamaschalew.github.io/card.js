import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Actions from './actions.js';
import {makeThumbnail, deleteThumbnail} from './thumbnails.js';

/** The photo's box is this much narrower than the card, and this tall for its width. */
const PHOTO_MARGIN = 14;
const PHOTO_BOX_RATIO = 0.765;
const INSET = 4;
const RADIUS = 16;
/** Room around the frame for its shadow. */
const PAD = 10;
const CLIP_WIDTH = 9;
const CLIP_HEIGHT = 26;
const CLOSE_SIZE = 20;
/** From the top of the card actor (the clip) down to the frame. */
const FRAME_TOP = CLIP_HEIGHT - 12;
const LONG_PRESS_MS = 600;
const DOUBLE_CLICK_MS = 400;

const {EASE_OUT_QUAD, EASE_IN_QUAD, EASE_IN_OUT_QUAD, EASE_IN_OUT_SINE, EASE_OUT_BACK} =
    Clutter.AnimationMode;

export function cardHeightFor(cardWidth) {
    return FRAME_TOP + photoBox(cardWidth).height + INSET * 2 + 44;
}

function photoBox(cardWidth) {
    const width = cardWidth - PHOTO_MARGIN;
    return {width, height: Math.round(width * PHOTO_BOX_RATIO)};
}

/**
 * One photo with its clip. All the charm lives here: it drops onto the line,
 * swings, sways with the breeze and falls when you let it go.
 */
export class Card {
    constructor(line, path) {
        this.line = line;
        this.path = path;
        this.tilt = Math.random() * 5 - 2.5;
        this.loaded = false;
        this.placed = false;
        this.pressed = false;
        this._timeouts = new Set();
        this._lastClick = 0;

        // The actor turns around the clip, at the top centre. It is sized by fit().
        this.actor = new St.Widget({opacity: 0, visible: false});
        this.actor.set_pivot_point(0.5, 0);
        this.actor.rotation_angle_z = this.tilt;

        // The frame, photo and close button are drawn with Cairo into one
        // texture. Unlike styled St boxes, a texture stays smooth when the
        // card tilts and swings.
        this.frame = new St.DrawingArea({
            reactive: true,
            track_hover: true,
            y: FRAME_TOP - PAD,
        });
        this.frame.connect('repaint', area => this._drawFrame(area));
        this.actor.add_child(this.frame);

        this._clip = new St.DrawingArea({
            width: CLIP_WIDTH + 4,
            height: CLIP_HEIGHT + 4,
            y: -2,
        });
        this._clip.connect('repaint', area => drawClip(area));
        this.actor.add_child(this._clip);

        this._copied = new St.Label({
            style_class: 'clothesline-copied',
            text: 'Copied',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._copiedBin = new St.Bin({child: this._copied, opacity: 0});
        this.actor.add_child(this._copiedBin);

        this.frame.connect('notify::hover', () => this._hoverChanged());
        this.frame.connect('button-press-event', (_a, event) => this._buttonPress(event));
        this.frame.connect('button-release-event', (_a, event) => this._buttonRelease(event));
        this.frame.connect('touch-event', (_a, event) => this._touch(event));
        this.frame.connect('popup-menu', () => this._openMenu());

        this.actor.connect('destroy', () => this._onDestroy());
    }

    // MARK: Loading

    /** Loads the photo at the card size of the widest screen, so fit() only ever scales it down. */
    async load() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const largest = photoBox(this.line.largestCardWidth);
        const thumb = await makeThumbnail(this.path, largest.width, largest.height, scale);
        if (this.destroyed) {
            deleteThumbnail(thumb.path);
            return;
        }
        // Keep the small image in memory and drop the file straight away.
        this._photo = Cairo.ImageSurface.createFromPNG(thumb.path);
        deleteThumbnail(thumb.path);
        this._thumbWidth = thumb.width;
        this._thumbHeight = thumb.height;
        this.fit(this.line.cardWidth);
        this.loaded = true;
    }

    /** Sizes the card to cardWidth and scales the photo to fit its box. */
    fit(cardWidth) {
        const box = photoBox(cardWidth);
        const shrink = Math.min(box.width / this._thumbWidth, box.height / this._thumbHeight);
        this._photoWidth = Math.round(this._thumbWidth * shrink);
        this._photoHeight = Math.round(this._thumbHeight * shrink);

        this.actor.set_size(cardWidth, cardHeightFor(cardWidth));
        this._clip.x = (cardWidth - CLIP_WIDTH) / 2 - 2;
        this._copiedBin.width = cardWidth;

        const w = this._photoWidth + INSET * 2, h = this._photoHeight + INSET * 2;
        this.frame.set_size(w + PAD * 2, h + PAD * 2);
        this.frame.set_pivot_point(0.5, PAD / (h + PAD * 2));
        this.frame.x = Math.round((cardWidth - w) / 2) - PAD;
        this._copiedBin.y = FRAME_TOP + h + 10;
        this.frame.queue_repaint();
    }

    // MARK: Motion

    /** Arriving: drops from above the line and swings into place. */
    dropIn() {
        this.actor.show();
        this.actor.translation_y = -46;
        this.actor.ease({translation_y: 0, opacity: 255, duration: 420, mode: EASE_OUT_BACK});
        this.swing(16);
    }

    /** Restored after a lock or a login: already hanging. */
    appear() {
        this.actor.show();
        this.actor.ease({opacity: 255, duration: 200, mode: EASE_OUT_QUAD});
    }

    /** A damped swing around the resting tilt, like a spring settling. */
    swing(degrees) {
        const steps = [1, -0.62, 0.38, -0.22, 0.12, -0.05, 0].map(f => this.tilt + degrees * f);
        const next = i => {
            if (i >= steps.length || this.destroyed)
                return;
            this.actor.ease({
                rotation_angle_z: steps[i],
                duration: i === 0 ? 260 : 340,
                mode: i === 0 ? EASE_OUT_QUAD : EASE_IN_OUT_SINE,
                onComplete: () => next(i + 1),
            });
        };
        next(0);
    }

    breeze() {
        this._later(Math.random() * 350, () => this.swing(1.6 + Math.random() * 1.8));
    }

    moveTo(x, y, animate) {
        if (animate && this.placed) {
            this.actor.ease({x, y, duration: 450, mode: EASE_OUT_QUAD});
        } else {
            this.actor.remove_transition('x');
            this.actor.remove_transition('y');
            this.actor.set_position(x, y);
        }
        this.placed = true;
    }

    /** Leaving the line: drops with a little spin and fades. */
    fall() {
        this.frame.reactive = false;
        const spin = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 16);
        this.actor.ease({
            translation_y: 140,
            rotation_angle_z: this.tilt + spin,
            opacity: 0,
            duration: 480,
            mode: EASE_IN_QUAD,
            onStopped: () => this.actor.destroy(),
        });
    }

    // MARK: Gestures

    _hoverChanged() {
        const hover = this.frame.hover;
        const scale = this.pressed ? 0.95 : hover ? 1.035 : 1;
        this.frame.ease({scale_x: scale, scale_y: scale, duration: 180, mode: EASE_OUT_QUAD});
        this.frame.queue_repaint();
        if (!hover && this.pressed)
            this._cancelPress();
    }

    _beginPress() {
        this.pressed = true;
        this._longFired = false;
        this.frame.ease({scale_x: 0.95, scale_y: 0.95, duration: 450, mode: EASE_IN_OUT_QUAD});
        this._clearLongPress();
        this._longPressId = this._later(LONG_PRESS_MS, () => {
            this._longPressId = 0;
            this._longFired = true;
            this._cancelPress();
            Actions.editImage(this.path, this.line.settings.get_string('editor'));
            this.line.tuck();
        });
    }

    _endPress() {
        const wasPressed = this.pressed;
        this._cancelPress();
        if (!wasPressed || this._longFired)
            return;

        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastClick < DOUBLE_CLICK_MS) {
            this._lastClick = 0;
            Actions.openImage(this.path);
            this.line.tuck();
        } else {
            this._lastClick = now;
            this.copy();
        }
    }

    _cancelPress() {
        this._clearLongPress();
        if (!this.pressed)
            return;
        this.pressed = false;
        const scale = this.frame.hover ? 1.035 : 1;
        this.frame.ease({scale_x: scale, scale_y: scale, duration: 300, mode: EASE_OUT_BACK});
    }

    _clearLongPress() {
        if (this._longPressId) {
            GLib.source_remove(this._longPressId);
            this._timeouts.delete(this._longPressId);
            this._longPressId = 0;
        }
    }

    _buttonPress(event) {
        const button = event.get_button();
        if (button === Clutter.BUTTON_SECONDARY) {
            this._openMenu();
            return Clutter.EVENT_STOP;
        }
        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (this._onCloseButton(event)) {
            this.line.unhang(this.path, {fall: true});
            return Clutter.EVENT_STOP;
        }
        this._beginPress();
        return Clutter.EVENT_STOP;
    }

    _buttonRelease(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        this._endPress();
        return Clutter.EVENT_STOP;
    }

    _touch(event) {
        const type = event.type();
        if (type === Clutter.EventType.TOUCH_BEGIN && this._onCloseButton(event))
            this.line.unhang(this.path, {fall: true});
        else if (type === Clutter.EventType.TOUCH_BEGIN)
            this._beginPress();
        else if (type === Clutter.EventType.TOUCH_END)
            this._endPress();
        else if (type === Clutter.EventType.TOUCH_CANCEL)
            this._cancelPress();
        else
            return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    }

    _onCloseButton(event) {
        const [sx, sy] = event.get_coords();
        const [ok, x, y] = this.frame.transform_stage_point(sx, sy);
        const c = PAD + 3 + CLOSE_SIZE / 2;
        return ok && Math.hypot(x - c, y - c) <= CLOSE_SIZE / 2 + 2;
    }

    // MARK: Drawing

    /** A dark glass frame with a thin edge lit from above, the photo, and the close button on hover. */
    _drawFrame(area) {
        if (!this._photo)
            return;
        const cr = area.get_context();
        const hover = this.frame.hover;
        const x = PAD, y = PAD;
        const w = this._photoWidth + INSET * 2, h = this._photoHeight + INSET * 2;

        // A soft shadow below.
        const layers = hover ? 9 : 7;
        for (let i = layers; i >= 1; i--) {
            roundedRect(cr, x - i * 0.6, y + (hover ? 6 : 4) - i * 0.4, w + i * 1.2, h + i * 1.2, RADIUS + i);
            cr.setSourceRGBA(0, 0, 0, (hover ? 0.05 : 0.04));
            cr.fill();
        }

        roundedRect(cr, x, y, w, h, RADIUS);
        cr.setSourceRGBA(0.16, 0.16, 0.18, 0.62);
        cr.fill();

        // The photo, with corners concentric to the frame's.
        cr.save();
        roundedRect(cr, x + INSET, y + INSET, this._photoWidth, this._photoHeight, RADIUS - INSET);
        cr.clip();
        cr.translate(x + INSET, y + INSET);
        cr.scale(this._photoWidth / this._photo.getWidth(), this._photoHeight / this._photo.getHeight());
        cr.setSourceSurface(this._photo, 0, 0);
        cr.getSource().setFilter(Cairo.Filter.GOOD);
        cr.paint();
        cr.restore();
        roundedRect(cr, x + INSET + 0.25, y + INSET + 0.25, this._photoWidth - 0.5, this._photoHeight - 0.5, RADIUS - INSET);
        cr.setSourceRGBA(1, 1, 1, 0.18);
        cr.setLineWidth(0.5);
        cr.stroke();

        // The glass edge, brighter at the top.
        const edge = new Cairo.LinearGradient(0, y, 0, y + h);
        edge.addColorStopRGBA(0, 1, 1, 1, hover ? 0.7 : 0.55);
        edge.addColorStopRGBA(1, 1, 1, 1, hover ? 0.2 : 0.12);
        roundedRect(cr, x + 0.5, y + 0.5, w - 1, h - 1, RADIUS - 0.5);
        cr.setSource(edge);
        cr.setLineWidth(1);
        cr.stroke();

        if (hover && !this.pressed) {
            const c = x + 3 + CLOSE_SIZE / 2;
            cr.arc(c, c, CLOSE_SIZE / 2, 0, 2 * Math.PI);
            cr.setSourceRGBA(0.12, 0.12, 0.14, 0.8);
            cr.fillPreserve();
            cr.setSourceRGBA(1, 1, 1, 0.35);
            cr.setLineWidth(0.75);
            cr.stroke();
            const r = 3.2;
            cr.moveTo(c - r, c - r);
            cr.lineTo(c + r, c + r);
            cr.moveTo(c + r, c - r);
            cr.lineTo(c - r, c + r);
            cr.setSourceRGBA(1, 1, 1, 0.95);
            cr.setLineWidth(1.6);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.stroke();
        }
        cr.$dispose();
    }

    // MARK: Actions

    async copy() {
        try {
            await Actions.copyImage(this.path);
        } catch (e) {
            Main.notifyError('Clothesline', `Cannot copy the screenshot: ${e.message}`);
            return;
        }
        if (this.destroyed)
            return;
        this.swing(3);
        this._copiedBin.remove_all_transitions();
        this._copiedBin.translation_y = -4;
        this._copiedBin.ease({opacity: 255, translation_y: 0, duration: 180, mode: EASE_OUT_QUAD});
        if (this._copiedId) {
            GLib.source_remove(this._copiedId);
            this._timeouts.delete(this._copiedId);
        }
        this._copiedId = this._later(1300, () => {
            this._copiedId = 0;
            this._copiedBin.ease({opacity: 0, duration: 250, mode: EASE_OUT_QUAD});
        });
    }

    _openMenu() {
        if (!this._menu) {
            this._menu = new PopupMenu.PopupMenu(this.frame, 0.5, St.Side.TOP);
            Main.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();
            this._menuManager = new PopupMenu.PopupMenuManager(this.frame);
            this._menuManager.addMenu(this._menu);

            this._menu.addAction('Copy', () => this.copy());
            this._menu.addAction('Open', () => Actions.openImage(this.path));
            this._menu.addAction('Mark Up', () =>
                Actions.editImage(this.path, this.line.settings.get_string('editor')));
            this._menu.addAction('Show in Files', () => Actions.showInFiles(this.path));
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._menu.addAction('Take Off the Line', () => this.line.unhang(this.path, {fall: true}));
            this._menu.addAction('Move to Trash', async () => {
                try {
                    await Actions.trashImage(this.path);
                    this.line.unhang(this.path, {fall: true});
                } catch (e) {
                    Main.notifyError('Clothesline', `Cannot move the screenshot to the Trash: ${e.message}`);
                }
            });
            this._menu.connect('open-state-changed', (_m, open) => {
                this.line.menuOpen = open;
            });
        }
        this._menu.toggle();
    }

    // MARK: Housekeeping

    _later(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(ms), () => {
            this._timeouts.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    _onDestroy() {
        this.destroyed = true;
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        if (this._menu) {
            this.line.menuOpen = false;
            this._menu.destroy();
            this._menu = null;
        }
        this._photo = null;
    }
}

function roundedRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

/** A minimal aluminium clip: a brushed metal pill with a slot where it grips the line. */
function drawClip(area) {
    const cr = area.get_context();
    const x = 2, y = 2;

    roundedRect(cr, x, y + 1.5, CLIP_WIDTH, CLIP_HEIGHT, 3.5);
    cr.setSourceRGBA(0, 0, 0, 0.25);
    cr.fill();

    const metal = new Cairo.LinearGradient(x, 0, x + CLIP_WIDTH, 0);
    metal.addColorStopRGB(0, 0.70, 0.70, 0.70);
    metal.addColorStopRGB(0.35, 0.93, 0.93, 0.93);
    metal.addColorStopRGB(0.65, 0.82, 0.82, 0.82);
    metal.addColorStopRGB(1, 0.62, 0.62, 0.62);
    roundedRect(cr, x, y, CLIP_WIDTH, CLIP_HEIGHT, 3.5);
    cr.setSource(metal);
    cr.fillPreserve();

    const rim = new Cairo.LinearGradient(0, y, 0, y + CLIP_HEIGHT);
    rim.addColorStopRGBA(0, 1, 1, 1, 0.9);
    rim.addColorStopRGBA(1, 0, 0, 0, 0.18);
    cr.setSource(rim);
    cr.setLineWidth(0.6);
    cr.stroke();

    roundedRect(cr, x + (CLIP_WIDTH - 5) / 2, y + 8, 5, 1.4, 0.7);
    cr.setSourceRGBA(0, 0, 0, 0.32);
    cr.fill();
    cr.$dispose();
}
