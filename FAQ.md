# ![FAQ](https://i.imgur.com/x2JMp9q.png)

**Why is there a user account/login system if this is a local app?**

Lokal was originally designed as a multi-user server application (think a self-hosted music service where multiple people could connect, have their own libraries, likes, play history, and listening stats). 

Halfway through development that was scrapped in favor of a simpler local-first approach, but the user system was already too much into the database schema and IPC layer. Removing it would mean rewriting a significant portion of the app for no real gain. 

For now it's just there, when you first open the app it creates a default "guest" user and everything works normally. You CAN create an account via email (it wont email you or anything) and still be able to work fine.

---

**Why does scanning take so long with large libraries?**

Lokal reads the actual audio file metadata (tags, artwork, duration, bitrate) for every file it hasn't seen before. With 5000+ files this takes a few minutes on first run. After that, scans are incremental, it skips anything whose file size and modification time haven't changed, so subsequent scans are much faster.

---

**Why are some of my songs not showing up after scanning?**

A few reasons Lokal intentionally skips files:

- **Too short** — anything under 60 seconds is filtered out (targets intros, skits, etc, this CAN be changed in settings)
- **Detected as a drum kit or sample pack** — Lokal looks for keywords like "kick", "snare", "808", "loop kit", "one shot" in the title, album, and genre. 
- **Missing title or artist tag** — files with no metadata at all are skipped since there's nothing to display. Tag your files with something like MusicBrainz Picard first.

---

**Why does the wrong artist sometimes get created (e.g. "Tyler" and "The Creator" as separate artists)?**

Artist name splitting is done automatically to handle features — "Artist A feat. Artist B" becomes two linked artists. Names with commas like "Tyler, the Creator" are a known edge case. There's a built-in exceptions list for common ones, and you can add your own in Settings → Artist Name Exceptions.

---

**Why does the downloader need yt-dlp and ffmpeg separately? Can't you bundle them?**

They could be bundled, but yt-dlp in particular updates very frequently (YouTube changes their systems constantly and yt-dlp has to keep up, also because of *piracy* reasons). A bundled version would go stale within weeks and downloads would stop working. Keeping it as a separate install means you can update it independently with `yt-dlp -U` whenever something breaks.

---

**The lyrics are wrong / for a different version of the song. What do I do?**

Open the fullscreen lyrics view and use the Search button in the top right. You can search LRCLIB manually by title and artist to find the right version. Once you select a result it gets cached for that track and won't be re-fetched automatically.

---

**Does web mode expose my library to the internet?**

Only if you explicitly port forward or use a tunnel. By default the web server only listens on your local network (`localhost:3421`). If you expose it externally, set an `API_KEY` in your `.env` file — any request without the matching header will be rejected.

---

**Does Lokal send any data anywhere?**

- Lyrics are fetched from [LRCLIB](https://lrclib.net/) (title, artist, album, duration sent as a search query)
- The YouTube downloader uses yt-dlp which contacts YouTube's servers (this HAS to use your cookies for the best ability, but Lokal does not reveal to anyone outside.)
- Discord Rich Presence sends the current track title and artist to Discord if enabled
- Everything else, such as your library, play history, likes, playlists, stays on your machine.

---
