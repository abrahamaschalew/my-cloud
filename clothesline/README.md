# Clothesline

Screenshots, hung out to dry, on Ubuntu.

Every screenshot you take hangs on a line just under the top bar. Push the
pointer against the top edge of the screen and the line slides down. Move
away and it tucks itself back.

![Five screenshots hanging on a thin line under the GNOME top bar](docs/screenshot.png)

A GNOME Shell extension for Ubuntu 24.04 and later (GNOME 45 to 50). Inspired by
[Tendedero](https://github.com/alejandrobujan/tendedero) for macOS, rewritten
from scratch for GNOME.

## A gesture for everything

| | |
|:--|:--|
| Click | Copy the image |
| Double click | Open it in the image viewer |
| Press and hold | Open it to mark up (in [Drawing](https://flathub.org/apps/com.github.maoschanz.drawing), Pinta, KolourPaint or GIMP) |
| Right click | Copy, Open, Mark Up, Show in Files, Take Off the Line, Move to Trash |
| Click the cross | Take it off the line (the file stays where it is) |
| Push the pointer against the top edge | Bring the line down |
| Click the top bar | Put it away |
| <kbd>Shift</kbd> <kbd>Super</kbd> <kbd>L</kbd> | Show or hide the line |

## Works with what Ubuntu already does

- **Same screenshot keys.** Press <kbd>Print</kbd> as usual. Ubuntu saves the
  file to `~/Pictures/Screenshots` and Clothesline picks it up from there.
  Nothing about your screenshot settings changes.
- **Native.** It runs inside GNOME Shell, so it works on Wayland (Ubuntu's
  default) and on X11. The top edge works the same way as the Activities hot
  corner and the auto-hiding dock.
- **Stays out of the way.** It hides in full-screen apps and in the
  Activities overview, sits below notifications, and only takes clicks on the
  photos themselves.
- **Remembers.** What is on the line survives locking the screen, logging out
  and restarting.

## Private and safe

- No network access. No account. No analytics.
- It never runs other programs or shell commands. It only opens files in the
  apps you already have, the same way the Files app does.
- It only reads the screenshots folder. It never deletes anything: "Move to
  Trash" uses the normal Trash, so you can restore files from there.
- Every file is plain, readable JavaScript or text. There is nothing compiled
  and nothing downloaded.

`scripts/audit.sh` checks this every time you install. It refuses to
continue if any file is not plain text, uses the network, runs programs,
evaluates code at runtime, or imports anything other than GNOME's own
libraries. It then prints a SHA-256 checksum of every file. You can run it on
its own:

```sh
scripts/audit.sh
```

## Install

```sh
git clone https://github.com/abrahamaschalew/clothesline.git
cd clothesline
./install.sh
```

The script audits the code, copies it to
`~/.local/share/gnome-shell/extensions/` and turns it on. You don't need root.
On Wayland, GNOME only loads new extensions when you log in, so log out and
back in once.

To change the settings, click the line icon in the top bar and choose
**Preferences**, or open the **Extensions** app.

To update, pull the new code, run `./install.sh` again, and log out and back in.

To remove it and everything it stored (your screenshots stay where they are):

```sh
./uninstall.sh
```

## Inside the extension

| File | Role |
|:--|:--|
| `extension.js` | Turns everything on and off: top bar icon, shortcut, top edge |
| `line.js` | The line along the top of the screen, sliding down and tucking away |
| `card.js` | One photo: frame, clip, swing, breeze and gestures |
| `watcher.js` | Notices new screenshots in the folder |
| `thumbnails.js` | Makes small copies, so full-size images are never kept in memory |
| `actions.js` | Copy, open, mark up, show in Files, move to Trash |
| `prefs.js` | The Preferences window |

To read the logs while trying it out:

```sh
journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i clothesline
```

## License

MIT. The idea and the look come from
[Tendedero](https://github.com/alejandrobujan/tendedero) by Alejandro Buján,
also MIT. The name and icon here are different, as Tendedero's licence asks.
