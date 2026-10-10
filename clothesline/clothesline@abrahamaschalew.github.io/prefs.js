import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClotheslinePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        const line = new Adw.PreferencesGroup({title: 'The Line'});
        page.add(line);

        const size = Adw.SpinRow.new_with_range(5, 25, 1);
        size.title = 'Screenshot Size';
        size.subtitle = 'Percent of the screen’s width each screenshot takes';
        settings.bind('card-size', size, 'value', Gio.SettingsBindFlags.DEFAULT);
        line.add(size);

        const edge = new Adw.SwitchRow({
            title: 'Push Against the Top Edge',
            subtitle: 'Bring the line down by pushing the pointer against the top of the screen',
        });
        settings.bind('edge-reveal', edge, 'active', Gio.SettingsBindFlags.DEFAULT);
        line.add(edge);

        const peek = new Adw.SwitchRow({
            title: 'Show New Screenshots',
            subtitle: 'The line comes down for a moment when a screenshot arrives',
        });
        settings.bind('peek-on-new', peek, 'active', Gio.SettingsBindFlags.DEFAULT);
        line.add(peek);

        const max = Adw.SpinRow.new_with_range(1, 20, 1);
        max.title = 'Screenshots on the Line';
        max.subtitle = 'The oldest one comes off when there is no room left';
        settings.bind('max-items', max, 'value', Gio.SettingsBindFlags.DEFAULT);
        line.add(max);

        const indicator = new Adw.SwitchRow({title: 'Top Bar Icon'});
        settings.bind('show-indicator', indicator, 'active', Gio.SettingsBindFlags.DEFAULT);
        line.add(indicator);

        const more = new Adw.PreferencesGroup({
            title: 'Advanced',
            description: 'Leave a field empty to use the default.',
        });
        page.add(more);

        more.add(this._entry(settings, 'toggle-line', 'Shortcut, such as <Shift><Super>l', {
            get: () => settings.get_strv('toggle-line')[0] ?? '',
            set: text => {
                const [ok, key, mods] = Gtk.accelerator_parse(text);
                if (!text)
                    settings.reset('toggle-line');
                else if (ok && (key !== 0 || mods !== 0))
                    settings.set_strv('toggle-line', [text]);
                else
                    return false;
                return true;
            },
        }));
        more.add(this._entry(settings, 'folder', 'Folder (default ~/Pictures/Screenshots)'));
        more.add(this._entry(settings, 'editor', 'Markup App, as a desktop file id'));
    }

    _entry(settings, key, title, {get, set} = {}) {
        get ??= () => settings.get_string(key);
        set ??= text => {
            settings.set_string(key, text.trim());
            return true;
        };
        const row = new Adw.EntryRow({title, use_markup: false, show_apply_button: true, text: get()});
        row.connect('apply', () => {
            if (set(row.text.trim()))
                row.remove_css_class('error');
            else
                row.add_css_class('error');
        });
        const id = settings.connect(`changed::${key}`, () => {
            if (row.text !== get())
                row.text = get();
        });
        row.connect('destroy', () => settings.disconnect(id));
        return row;
    }
}
