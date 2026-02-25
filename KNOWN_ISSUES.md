# ![KNOWN ISSUES](https://i.imgur.com/7O8qpvQ.png)

This file tracks known bugs and limitations. Some may be fixed in future updates.
*Last updated: 2/25/2026*

---

## Scanning

* **Converted videos detected as songs** — Files that were originally videos but converted to audio (e.g, MP4 to MP3) may still be indexed as normal tracks. These can be removed manually from settings.

---

## Performance

* **UI slow/laggy under heavy system load** — Electron relies on hardware acceleration. Running graphic-intensive applications or games alongside Lokal may cause UI stutter. Raising the process priority (Windows) may help.

* **Rapid track skipping during crossfade** — Skipping multiple tracks quickly while a transition is active may briefly interrupt smoothing.

---

## Playback

* **Volume automation edge cases** — Rapidly pausing/unpausing or changing volume during an active crossfade may cause minor volume jumps while the transition engine re-syncs.

* **Transition instability under extreme load** — While the new crossfade system is decently stable, heavy CPU usage may affect transition smoothness.

* **Media Controls and UI** — The new crossfade introduces a weird error that causes it to become inresponsive for every 2nd transition, where it looks like it's not playing but it is, and makes it unable for skipping via keybinds.
*  
---

## Library

* **Albums page may fail in rare startup edge cases** — If certain IPC handlers fail to register properly at launch, album loading can be affected. Restarting the app resolves this.

* **Artist duplication from metadata formatting** — Artists separated inconsistently (e.g., `1 800 PAIN` vs `1 800 PAIN, 1 800 PAIN`) may appear duplicated. You can merge them via settings.

* **Artist image not showing immediately** — Artist images fall back to track artwork. On first load before a full scan, some artists may appear without images.

---

## Metadata

* **Genre detection inconsistency** — Genre tags depend on either available embedded metadata, or an API call. The automatic genre may display genre as "Music" if none weren't automatically found.

---

## Downloader

* **Playlist download progress inconsistency** — Progress reporting for large playlists may change depending on `yt-dlp` output behavior.

* **Downloader failures without detailed feedback** — If `ffmpeg` or `yt-dlp` encounters an issue, the error message may not always clearly indicate the root cause.

---

## Lyrics

* **Lyrics unavailable while offline** — New lyrics cannot be fetched without an internet connection. Previously cached lyrics remains fuctional though.

* **Wrong lyrics version fetched** — The lyrics provider may return alternate versions (live, remix, radio edit). Use manual search in fullscreen lyrics view if needed.

* **Unsynced lyrics estimation** — For tracks without synced timestamps, Lokal tries a rough timing estimation which may not align perfectly.

* **Cache miss re-fetching** — In rare cases, cached lyrics may not register as a cache hit and will be re-fetched. Console logs will indicate cache status.

---

## Networking

* **Upstream rate limits** — Excessive lyric searches or metadata requests may temporarily fail due to third-party API rate limiting.

---

## Web Mode

* **Localhost routing issues** — Certain localhost configurations may prevent assets or APIs from resolving correctly in web mode.

* **Artist images not serving** — If `LOKAL_DATA_DIR` is misconfigured, artist images will not load in browser mode.

* **better-sqlite3 ABI mismatch** — Switching between Electron and web server mode may require rebuilding:

  ```
  npm rebuild better-sqlite3
  ```

  The `server/start.js` wrapper attempts to handle this automatically, but manual rebuild may still be required.

---

## Discord

* **Presence lingers after exit (rare)** — Discord Rich Presence may not clear immediately when the app closes. Restarting Discord resolves this.

---

## Queue

* **Queue is session-only** — The queue currently exists in-memory and resets after an Electron reload. Persistent queue support is planned.

---
