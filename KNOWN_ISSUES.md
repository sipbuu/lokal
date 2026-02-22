# Known Issues

This file tracks known bugs and limitations, some may be fixed, others may not. *Last updated: 2/22/2026*

---

## Graphic Instability
- **Transitions slow/laggy** — Electron is known for hardware acceleration, if you are playing a graphic intensive game, the program may lag/stutter, you can *try* and prevent this by promoting its priority order (for Windows)

## Playback

- **Shuffle + crossfade mismatch** — when shuffle is on, the crossfade pre-loader queues the wrong next track. Workaround: disable crossfade when using shuffle.
- **Going back while shuffle is on** — previous button may pick a random track instead of the actual previous one.
- **Word mid-transition flash** — when the active lyric line changes mid-word animation, chars briefly flash to their initial (dim) state before catching up.

## Library

- **Albums page not loading** — may not work depending on which IPC handlers were registered at startup. Some artists can mess up depending on the `,` between names. Use manual merge if an artist gets duplicated like this: `1 800 PAIN` and `1 800 PAIN, 1 800 PAIN`
- **Artist image not showing** — artist images fall back to track artwork automatically, but may not appear on first load before a scan or if one of the tracks loaded does not have an image.

## Downloader

- **Album art missing after download** — yt-dlp's `--embed-thumbnail` step occasionally fails silently. The app attempts to fetch the YouTube thumbnail as a fallback but this may not always succeed.
- **Playlist art is slightly off** — due to how yt-dlp downloads thumbnails, this can appear as a rectangle, obviously i will attempt a fix at a later date to crop thumbnails (if it is downloaded via youtube) 
- **Playlist download progress** — progress reporting for playlist downloads can be inconsistent depending on yt-dlp output format changes.

## Lyrics

- **Wrong lyrics version fetched** — LRCLIB may return lyrics for a different version of the track (live, radio edit, etc.). Use the manual search in the lyrics fullscreen view to find the correct version.
- **Lyrics are way off-sync** — this is likely because the song is unsynced, but due to my implementation it tries a *very rough* estimation of the lyrics so it can appear off sync.
- **Caching unclear** — lyrics are cached in SQLite after first fetch, but if the cache isn't being hit correctly it will re-fetch on every open. Check the console for cache hit/miss logs.

## Web Mode

- **Issues with localhost within the server** — this is a very prominent issue, i currently have a focus on the electron ver first, but once i find a feasible solution for the web version, i will implement it to fix such errors.
- **Artist images not serving** — if `LOKAL_DATA_DIR` is not set correctly, artist images won't load in the browser.
- **better-sqlite3 ABI mismatch** — if you switch between Electron and web server mode, you may need to rebuild: `npm rebuild better-sqlite3`. The `server/start.js` wrapper SHOULD do this automatically.

## Discord

- **Presence lingers after exit** — Discord rich presence may not clear immediately when the app closes, if it doesn't, it's best to kill/exit discord to remove it.
- **Crash if Discord not running** — if Discord is not open when the app starts, presence setup may throw. Should be handled silently but may not be in all cases.

## Queue
- **Queue doesn't save after Electron reload** — with the way queue switching is handled, it only does it on the front-end, however the back-end is not updated (this is for certain reasons, but may be updated), so a reload will reset the queue to normal.
---
- Mini player mode
- Playlist import (M3U)
- Play history export
