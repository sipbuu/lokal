# Lokal
![lokal icon](https://i.ibb.co/pjrCyKNF/lokal-icon.png)
![convient photo of toro](https://i.imgur.com/KgjwTvk.png)


Local-first music player built w/ Electron and React. Designed for people with large local music libraries who'd like a modern listening experience w/o the burdens of streaming subscriptions.

![Lokal Music](https://img.shields.io/badge/version-1.0-blue) ![Electron](https://img.shields.io/badge/Electron-latest-47848F) ![React](https://img.shields.io/badge/React-18-61DAFB) ![License](https://img.shields.io/badge/license-MIT-green)

---
## Before reading further, check the Common links:


>See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) for known issues. 

>Report any [issues/bugs](https://github.com/sipbuu/lokal/issues) you find.

>Download the [latest up-to-date release.](https://github.com/sipbuu/lokal/releases/latest)

>Read the [contribution guide](./CONTRIBUTING.md) if you'd want to help!

>Read the [FAQ](./FAQ.md) for any questions you have.
---

## Major Features

**Library**

Your local music folder indexed and scanned for files that have metadata. Lokal tries to filter out drum kits, sample packs, and loop files, with the option to opt out if some get incorrectly flagged (*via the minimum time requirement*).

![library example](https://i.imgur.com/n26m1Xr.png)

---

**Synced Lyrics**

Line level (or word-level with a toggle) karaoke animation powered by LRCLIB. Supports manual search if the auto-fetch is wrong, and local import of `.lrc` and `.ttml` files for an Apple Music-style syllable sync.

(*note: most word-level lyrics are estimation based on the time between lines, if it is a slow song with many pauses, the word-sync will be off*)

![synced lyrics gif](https://i.imgur.com/1tEycTU.gif)

`.ttml` file example: 

![apple music lyris gif](https://i.imgur.com/iXFGywW.gif)
---

**Downloader**

![downloader screenshot](https://i.imgur.com/4vM8RS0.png)

Search and download from YouTube via yt-dlp. Auto-indexes the track immediately after download, no need to rescan your whole library.

(*yt-dlp not included on install*)

---

**Artist & Album Pages**

![artist page screenshot](https://i.imgur.com/Wab0iFI.png)

Dedicated artist and album pages with artwork, bio, top tracks, and discography view.

(*artists will use the most recent indexed song's image, however you can freely adjust their profile to match their spotify page if you'd like*) 

---

**Mixes**

![home screenshot](https://i.imgur.com/jZPLDgB.png)

Auto-generated mixes built from your listening history and liked tracks, as well as some random artists as well. Includes a Discovery Weekly of tracks you haven't played yet. 

(*may auto-regenerate on restart, will likely be fixed/set on a later date*)

---

## Other Features

- **Playlist Importer (beta/half-complete)** — import playlists from other platforms (once you have indexed your music) to a playlist.  
- **Crossfade** — smooth transitions between tracks, configurable within **settings**
- **Discord Rich Presence** — shows what you're listening to in real time. (use the one provided, or grab your custom id from discord's development panel)
- **Duplicate detection** — smart merge that scores each copy by bitrate, artwork, and metadata completeness, then keeps the best one. (best for situations where you can contain duplicates of the same music)
- **Playlists** — create, manage, reorder
- **Play history & stats** — tracks listening time, top artists, top genres (top left)
- **Web mode** — run as a web server to access your library from another device on your network (currently in hiatus, main focus on app ver.)
- **Artist name exceptions** — prevents names like "Tyler, the Creator" from being incorrectly split into multiple artists, configurable via **settings**. 
- **Queue & Shuffling** — move around your queue as needed and shuffle with the ability to fully go back without issue.
- **Last.FM Scrobbling (in alpha, half-done implementation)** — scrobble your music with *last.fm* to keep your profile up-to-date (requires 50% listened)

---

## Possible Features to Come

- **"Replay" feature** — ability to recieve a "replay" for each quarter of the year, allowing you to look back at your history.
- **Custom Plugins** — Give users the ability to create custom add-ons for the program to give more accessibility.
- **TTML API** — An API (*like Spicy Lyrics for Spotify*) that automatically provides TTML files for the best-sync possible. 
   
---

## Requirements

- [Node.js](https://nodejs.org/) v18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — for the downloader (optional)
- [ffmpeg](https://ffmpeg.org/) — for audio conversion via yt-dlp (optional)

---

## Getting Started

```bash
git clone https://github.com/sipbuu/lokal/
cd lokal
npm install
```

**Electron app (desktop):**
```bash
# rebuild sqlite3 for electron
npm run rebuild:electron 

npm run dev
```

**Web mode (access from another device):**
```bash
# Copy .env.example to .env and set LOKAL_DATA_DIR to your Electron app's data folder
# copy .env.example .env (for windows)
cp .env.example .env 


# rebuild sqlite 3 for web
npm run rebuild:web 

npm run dev:web
# Open http://localhost:3421
```

---

## Web Mode Setup

If you want to access your library from another device (e.g. devices on the go/laptops), run the web server on your home machine and point it at your existing Electron data:

1. Copy `.env.example` to `.env`
2. Set `LOKAL_DATA_DIR` to your data folder:
   - Windows: `C:\Users\<you>\AppData\Roaming\lokal-music\data`
   - macOS: `~/Library/Application Support/lokal-music/data`
   - Linux: `~/.config/lokal-music/data`
3. Optionally set `API_KEY` to a random string to protect remote access
4. Run `npm run dev:web`

---

## Downloader Setup

*Lokal will attempt an auto install, but if it fails, please refer to the following below*

The downloader requires `yt-dlp` and `ffmpeg` to be installed and available on your PATH

- **yt-dlp:** https://github.com/yt-dlp/yt-dlp#installation
- **ffmpeg:** https://ffmpeg.org/download.html

On Windows, the easiest way is to drop both `.exe` files somewhere and add that folder to your PATH, or place them in the project root.

If Lokal still struggles to find your *ffmpeg* or *yt-dlp*, then you can point to it manually in settings as well.

---

## Project Structure

```
electron/         Electron main process
  ipc/            IPC handlers (scanner, lyrics, downloader, discord)
  preload.js      Context bridge
server/           Express web server (web mode)
  routes/         API routes
src/              React frontend
  components/     Reusable components
  pages/          Page components
  store/          Zustand state
```

---

## Built With (and much thanks to)

- [Electron](https://electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [music-metadata](https://github.com/borewit/music-metadata)
- [Framer Motion](https://www.framer.com/motion/)
- [Tailwind CSS](https://tailwindcss.com/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [LRCLIB](https://lrclib.net/) — lyrics provider

---

## License

[MIT](https://opensource.org/license/mit)