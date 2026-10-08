import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Small copies of the screenshots, so the line never keeps full size images
 * in memory. They live in ~/.cache/clothesline and are thrown away with the
 * photo they belong to.
 */
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'clothesline']);

export function clearThumbnails() {
    const dir = Gio.File.new_for_path(CACHE_DIR);
    let enumerator;
    try {
        enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return;
    }
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        if (info.get_name().endsWith('.png'))
            deleteThumbnail(GLib.build_filenamev([CACHE_DIR, info.get_name()]));
    }
    enumerator.close(null);
}

export function deleteThumbnail(path) {
    if (!path)
        return;
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch {}
}

/**
 * Scales the image down to fit maxWidth x maxHeight logical pixels, at the
 * screen's scale factor, and saves it to the cache.
 *
 * Resolves with {path, uri, width, height}, size in logical pixels.
 */
export async function makeThumbnail(path, maxWidth, maxHeight, scale, cancellable = null) {
    const file = Gio.File.new_for_path(path);
    const info = file.query_info('time::modified,standard::size', Gio.FileQueryInfoFlags.NONE, null);
    const key = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,
        `${path}\n${info.get_modification_date_time()?.to_unix() ?? 0}\n${info.get_size()}\n${scale}`, -1);

    const stream = await new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (f, res) => {
            try {
                resolve(f.read_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });

    let pixbuf;
    try {
        pixbuf = await new Promise((resolve, reject) => {
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, Math.round(maxWidth * scale), Math.round(maxHeight * scale), true, cancellable,
                (_o, res) => {
                    try {
                        resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    } finally {
        stream.close_async(GLib.PRIORITY_DEFAULT, null, null);
    }

    GLib.mkdir_with_parents(CACHE_DIR, 0o700);
    const thumbPath = GLib.build_filenamev([CACHE_DIR, `${key}.png`]);
    pixbuf.savev(thumbPath, 'png', [], []);

    return {
        path: thumbPath,
        uri: Gio.File.new_for_path(thumbPath).get_uri(),
        width: pixbuf.get_width() / scale,
        height: pixbuf.get_height() / scale,
    };
}
