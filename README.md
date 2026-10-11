# ![Lokal](https://i.imgur.com/O9SwX2c.png)
![lokal icon](https://i.ibb.co/pjrCyKNF/lokal-icon.png)
![convient photo of toro](https://i.imgur.com/KgjwTvk.png)


**Your music, your files, a modern player.** Lokal is a local-first music player built with Electron and React, for people with big local libraries who want the polish of a streaming app without the subscription: word-by-word synced lyrics, listening recaps, recommendations from Last.fm or YouTube Music, smart playlists, an audio-quality checker, and one search bar that finds, streams and downloads.

![Lokal Music](https://img.shields.io/badge/version-6.5.0-blue) ![Electron](https://img.shields.io/badge/Electron-latest-47848F) ![React](https://img.shields.io/badge/React-19-61DAFB) ![License](https://img.shields.io/badge/license-MIT-green) [![Discord](https://img.shields.io/badge/Discord-7289DA?logo=discord&logoColor=white)](https://discord.gg/Wv3zfpG6UT)

![Lokal's home page: mixes built from your listening, the song playing in the side panel, and its audio quality under the artist](docs/screenshots/home.webp)

<sub>Screenshots show a demo library: the artists, songs and artwork are made up.</sub>

---
## Before reading further, check the common links:

>Download the [latest up-to-date release.](https://github.com/sipbuu/lokal/releases/latest) Windows releases are code-signed through [SignPath Foundation](https://signpath.org/) (see the [code signing policy](#code-signing-policy)).

>If you are wondering why you have to create an account or other general questions, please [read the FAQ](./FAQ.md).

>Interested in creating TTML lyrics? Check out [our side TTML editor!](https://github.com/sipbuu/lokal-ttml)

>See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) for known issues, and report any [issues/bugs](https://github.com/sipbuu/lokal/issues) you find.

>Read the [contribution guide](./CONTRIBUTING.md) if you'd like to help!
---

## Highlights

- **Synced lyrics from 9 sources**, word by word, with translation, romanization and duets
- **One search bar** for your library, YouTube Music, SoundCloud, Soulseek and addons: stream, save or paste a link to download
- **Listening recaps** for every week, month and year, with a story you can tap through
- **Audio quality checker** that sorts your files into Hi-res, Lossless, High and Low, and spots fake FLACs
- **Discovery, Mix and Radio** from your Last.fm or YouTube Music account, played from your library first, then from YouTube Music, SoundCloud or your addons
- **Smart playlists** that fill themselves from rules, and **share cards** for playlists, artists and recaps
- **Mixes, playlists and stats** built from your own listening history
- **Full-screen player** with moving canvas covers, a colour backdrop, a glass player bar, a mini player and crossfade
- **Account connections** for Last.fm, ListenBrainz, YouTube Music and Discord, plus a phone remote

---

## Synced Lyrics

![Full-screen lyrics lighting up word by word](docs/screenshots/lyrics.webp)

Lyrics light up **word by word** (or syllable by syllable) like Apple Music, in the side panel or full screen. Lokal asks every source at the same time and uses them in the order you set (drag to reorder, or turn sources off, in Settings → Playback). The first source with lyrics wins. With **Prioritize syllable lyrics** on, it keeps looking past line-timed lyrics for word-timed ones.

| Source | What it's good for |
|---|---|
| Local file | Lyrics embedded in the file, or a `.lrc` / `.ttml` next to it |
| BiniLyrics, BetterLyrics | Apple Music timings, word by word |
| BetterLyrics Portato | QQ Music karaoke timings |
| LyricsPlus | Syllable timings from community mirrors |
| Unison | Lyrics contributed by listeners |
| LRCLIB, KuGou | Whole lines; LRCLIB is reliably up, KuGou is strong outside English |
| lyrics.ovh | Plain-text fallback |

- **Translate** lyrics into your language (or turn on auto-translate), and see **romanization** for Japanese, Korean, Chinese and more.
- **Duets and background vocals** are laid out left and right, and background lines appear under the lead.
- **Pick another source** from the lyrics panel if the first match is wrong, or import your own `.lrc` / `.ttml` (make one with the [TTML editor](https://github.com/sipbuu/lokal-ttml)).
- **Lyrics are written into files you download**, so they come with the song.

---

## Search, Stream and Download in One Place

| Search everything | Paste a link |
|---|---|
| ![Search results for "neon": albums and songs from the library](docs/screenshots/search.webp) | ![A pasted SoundCloud playlist link, ready to download](docs/screenshots/link.webp) |

The search bar at the top covers your own library, then songs that aren't in it yet:

- **Online results** from YouTube Music, SoundCloud, **Soulseek** (via slskd) and any **addons** you've added. Play them right away (streamed with your own yt-dlp, nothing is hosted by Lokal), add them to playlists, or save them to your library with one click. The saved file takes the stream's place in your likes and playlists.
- **Playlists and channels** from YouTube Music, downloadable whole.
- **Paste a link** (YouTube, SoundCloud, Bandcamp and anything else yt-dlp supports) and press Enter to download a song, an album or a whole playlist.
- **Downloads land in your library as they finish**, tagged, with a square cover and lyrics. No rescan needed. Choose the format (Original, MP3, M4A or Opus) in Settings → Library.
- **The Downloads button** (top left, next to Settings) shows the queue and the playlists you've downloaded.

(*yt-dlp and slskd are not included on install; see [Downloader Setup](#downloader-setup)*)

**Addons:** paste an addon's manifest URL in Settings → Addons. Lokal speaks the same addon protocol as Eclipse Music (manifest, `/search`, `/stream`), so those addons work as another source in search. Lokal ships no addons and doesn't host or vouch for any; you're responsible for the ones you add. (*[Ultramax](https://ultramax.vip/eclipse.html) and [LastWave](https://lastwaveaddons.clashprojects.qd.je/) have been tested and work; Tido requires whitelisting, so it isn't compatible.*)

**Soulseek:** search and download from Soulseek through slskd, where lossless FLAC files are common. Soulseek is a sharing network and most of what's on it is copyrighted, so only download what you own.

---

## Discovery, Mix and Radio

![Discovery on Home: Fresh Finds and Quick Picks from Last.fm, each song ready to play from the library](docs/screenshots/discovery.webp)

Home has four tabs: **Local** (mixes from your own library), **Discovery**, **Mix** and **History** (everything you've played in Lokal).

**Discovery** shows recommendations from the account you pick at the top, **Last.fm** or **YouTube Music**:

| | Last.fm | YouTube Music |
|---|---|---|
| New music | **Fresh Finds**: songs similar to what you scrobble, and more from your artists | **Fresh Finds** from your YouTube Music home |
| Your favourites | **Quick Picks**: what you scrobbled most this week | **Likes**: your 30 latest liked songs |
| History | **Scrobble History**, grouped by day | **YouTube Music History** |
| Collections | **Albums For You** and **Artists For You** | **Mixed for you** (your "My Mix" playlists), **Artists For You** |

Click a song to play it; the rest of the shelf queues up behind it. Save Fresh Finds, Quick Picks or your Likes as a playlist, and download a song, an album or a whole YouTube Music mix to your library from its menu (right-click).

**Where songs play from:** a song you already have plays from your files. Otherwise Lokal looks for the *same* recording (same title and artist, never a cover or remix) in your **Playback Search Priority** (Settings → Integrations → Recommendations): YouTube Music first by default, then SoundCloud and any searchable addons, in the order you set. YouTube Music's own recommendations play their exact video, without searching. If a source only has a preview or can't play a song, the next one is tried, and if none can, the next song plays.

| Mix | |
|---|---|
| ![The Mix tab: a 24-track mix sampled from your recommendations](docs/screenshots/mix.webp) | **Mix** builds a 24, 32 or 40-track mix from a fresh sample of your recommendations. **Regenerate** for a new one; the last mix is kept until you do. Play it, or save it as a playlist.<br><br>**Radio** (*Start radio* on any song, *Start artist radio* or *Start album radio*) plays a station of related songs from YouTube Music's own radio and Last.fm's similar tracks; **Regenerate** for a new one. |

---

## Listening Recaps

| Every week, month and year | …and a story to tap through |
|---|---|
| ![The Recap page: a week's minutes, tracks, artists and peak hour](docs/screenshots/recap.webp) | ![The recap story: 7h 46m of music in one week](docs/screenshots/recap-story.webp) |

Lokal builds a recap from your own listening for every finished week (Monday to Sunday), every month and every year:
- minutes, tracks, artists and your peak listening hour
- top tracks, artists, albums and genres
- your **listening sessions**, named by what they were ("Late night listening", "Neon Harbor deep dive")

Play any recap, save it as a playlist, watch it as a **full-screen story**, or **share** it as a picture (see [Share cards](#smart-playlists-and-share-cards)). New recaps appear on their own when a week or month ends.

---

## Audio Quality

![The Audio Quality page: how much of the library is Hi-res, Lossless, High and Low, and the songs worth upgrading](docs/screenshots/quality.webp)

Know what you're actually listening to:

| Tier | Meaning |
|---|---|
| **Hi-res** | Above CD quality (lossless, more than 16-bit or 48 kHz) |
| **Lossless** | CD quality |
| **High** | Lossy at 256 kbps and up (160 kbps and up for Opus/Vorbis) |
| **Low** | Lossy below that |

- **Spectrum check:** looks at the spectrum of your lossless files to catch **fake FLACs**, ones converted from an MP3 (needs ffmpeg).
- **Worth upgrading:** lists your lossy and suspect files, lowest quality first.
- **Get it in lossless:** finds a better copy through MusicBrainz store links, Qobuz, Bandcamp, 7digital and Soulseek, with **Discogs** and **AllMusic** to check which releases exist.

  ![Get it in lossless: Qobuz, Bandcamp, 7digital, Discogs, AllMusic and Soulseek for one song](docs/screenshots/lossless.webp)

- **Pill in the player bar:** the playing song's tier shows under the artist, and hovering says what it means.

---

## Your Library

| Library, filtered by genre | Albums |
|---|---|
| ![The Library filtered to Synthwave](docs/screenshots/library.webp) | ![An album page with its tracklist](docs/screenshots/album.webp) |

| Artists | Playlists |
|---|---|
| ![An artist page with bio, popular songs and releases](docs/screenshots/artist.webp) | ![A playlist with its songs](docs/screenshots/playlist.webp) |

![The Library's column picker: track number, artwork, artist, source, quality, date added, duration and quick actions](docs/screenshots/columns.webp)

- **Library:** your music folder indexed from the files' own tags. Drum kits, sample packs and loops are filtered out, and you can opt out if something gets flagged by mistake (*via the minimum duration*). Filter by **source** (music folder, YouTube, SoundCloud, Soulseek, addons), **genre** and **quality**, and sort by date, title, artist, plays or length.
- **Track lists you can adjust:** pick the columns (track number, artwork, artist, source, quality, date added, duration, quick actions, drag handle) from **Columns**; the layout tightens on its own when the window gets narrow. An icon shows where a downloaded or streamed song came from (YouTube, SoundCloud, Soulseek, an addon), and playlists show each song's quality.
- **Albums:** albums, EPs and singles are kept apart; hover a cover to play the whole release.
- **Artists:** each artist gets a page with a **photo and bio**, fetched automatically from **Wikidata**, Deezer, TheAudioDB, MusicBrainz or Wikipedia, or set by hand. *Auto* takes bios from Wikidata first (the artist's own Wikipedia article) and photos from Deezer first. Top songs and releases are on the same page. Names like "Tyler, the Creator" stay one artist.
- **Playlists:** create, reorder, download, and get recommendations. Import them from Spotify (Exportify), Apple Music, YouTube Music, Last.fm or a CSV/JSON/M3U file.
- **Select several songs** with Ctrl/Cmd+click (Shift for a range) to queue, add to a playlist or delete them all at once.
- **Duplicate detection:** a smart merge scores each copy by bitrate, artwork and metadata completeness, then keeps the best one.

---

## Smart Playlists and Share Cards

| Smart playlists | Share cards |
|---|---|
| ![A smart playlist's rules: Synthwave from 2022 or later, in random order](docs/screenshots/smart.webp) | ![The share card for the Night Drive playlist](docs/screenshots/share.webp) |

- **Smart playlists** are made of rules instead of a list, and update themselves as your library and listening change: genre, artist, album, title, folder, year, date added, last played, plays, liked, length, quality and source. Match all or any of them, pick an order (random included) and an optional limit. A live count shows what the rules give before you save. Create one with the ✨ button next to Playlists.
- **Share cards** turn a playlist, an artist or a recap into one picture (1080×1350, the size social apps show in full) with its covers, numbers and top songs. Copy it or save it from the **Share** button.

---

## Mixes, Profile and Stats

![The profile page: plays, hours listened, likes and this week, top genres, top artists and tracks](docs/screenshots/profile.webp)

- **Mixes on Home** (the **Local** tab) are built from your history and likes: a Daily Mix, New Arrivals, Most Played and Discovery (songs you haven't played yet). Save any mix, or a suggested song, as a playlist.
- **History** (Home → History) shows what you played recently, streamed songs included.
- **Your profile** shows your total plays, hours listened, likes and this week's plays, plus your top genres, artists and tracks.

---

## Now Playing

- **Full-screen player** with the cover, or full-screen lyrics; switch between them with one click.
- **Canvas covers:** looping video covers from Apple Music, Tidal, community lists or Spotify Canvas (*Spotify needs your own account cookie*).
- **Colour backdrop** taken from the cover.
- **Glass player bar:** the player floats over the pages, which scroll on underneath it, frosted. Switch it off (or the waveform next to the volume) in Settings → Appearance → Player Bar.
- **Audio output picker** in the player bar, to send the music to another device (headphones, speakers, an interface).
- **Mini player** to keep the music in a corner.
- **Sleep timer.**
- **Crossfade** between tracks.
- **Queue:** play next and add to queue, with shuffle you can fully step back through.
- **Collapsible sidebar**, down to icons only.

---

## Integrations

![Account connections in Settings: Last.fm and ListenBrainz connected; YouTube Music and Discord connect from the desktop app](docs/screenshots/accounts.webp)

Everything is connected from **Settings → Integrations → Account Connections**:

- **Last.fm:** *Sign in*, then follow the numbered steps: create an API account, paste its key and secret, your username, and *Authorize* in the browser. Lokal sends "now playing" and scrobbles (after half the track or 4 minutes); scrobbles made offline are kept and sent later. Your account also powers Discovery, Mix and Radio.
- **ListenBrainz:** *Sign in* with your user token, for the open alternative by MetaBrainz. Same scrobbling rules, offline listens kept.
- **YouTube Music** (desktop app): *Sign in* opens YouTube Music in its own Lokal window; use the site's Sign in button. Lokal keeps the session (restored at every start) and uses it for Discovery, your mixes and likes, and to stream songs that need an account. *Verify* checks it's still valid.
- **Discord Rich Presence:** *Connect* to show what you're listening to. Use the built-in app, or your own from Discord's developer portal (Settings → Integrations → Discord Rich Presence).
- **Scrobbling** has one switch per service (Settings → Integrations → Scrobbling), to pause it without signing out.
- **Phone remote:** open `http://<your computer>:3421/remote` on your phone to control playback. It installs as a web app.
- **Web mode:** run Lokal as a server and listen to your library from another device (see [Web Mode Setup](#web-mode-setup)).
- **Plugins:** install plugins from a folder in **Settings → Plugins**.
- **Backups:** full app export and import, play-history export, and track metadata import.

---

## Requirements

- [Node.js](https://nodejs.org/) v22.12+ (24 recommended, see `.nvmrc`)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp): for downloading and streaming online songs (optional)
- [ffmpeg](https://ffmpeg.org/): for audio conversion and the spectrum check (optional)
- [slskd](https://github.com/slskd/slskd): for Soulseek (optional)

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


# rebuild sqlite3 for web
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
3. Optionally set `API_KEY` to a random string to protect remote access. Every `/api` request then needs it:
   - **In the web app:** it's asked once per browser and kept in a cookie.
   - **Other clients:** send it as an `x-api-key` header.
   - **Use HTTPS on any network you don't fully trust** (a reverse proxy or tunnel with TLS): plain HTTP sends the key unencrypted, so anyone on the same network could read it. With `API_KEY` set, plain HTTP is only accepted from this machine and your local network, and reaching Lokal from outside needs HTTPS.
4. Run `npm run dev:web`

---

## Downloader Setup

*Lokal will attempt an auto install, but if it fails, please refer to the following below*

The downloader requires `yt-dlp` and `ffmpeg` to be installed and available on your PATH:

- **yt-dlp:** https://github.com/yt-dlp/yt-dlp#installation
- **ffmpeg:** https://ffmpeg.org/download.html

On Windows, the easiest way is to drop both `.exe` files somewhere and add that folder to your PATH, or place them in the project root.

If Lokal still struggles to find your *ffmpeg* or *yt-dlp*, you can point to them manually in Settings as well.

YouTube often asks downloaders to "confirm you're not a bot". Signing in to YouTube Music in **Settings → Integrations → Account Connections** fixes that: streams and downloads then use your session. Signed in, yt-dlp needs a JavaScript runtime to read YouTube's audio links; Lokal gives it its own (Electron's Node), so there's nothing to install, and a [deno](https://deno.com/) you've installed is used first. Keep yt-dlp up to date (Settings → Integrations → External Tools): YouTube changes often.

---

## Project Structure

```
electron/         Electron main process
  ipc/            IPC handlers (scanner, downloader, recaps, discord, ...)
  lyrics/         Lyrics sources and the shared lyrics pipeline
  online/         Online search, streaming and addons
  quality/        Audio quality tiers and the spectrum check
  preload.js      Context bridge
server/           Express web server (web mode, phone remote)
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
- [slskd](https://github.com/slskd/slskd)
- Lyrics: [LRCLIB](https://lrclib.net/), BiniLyrics, BetterLyrics, LyricsPlus, Unison, KuGou and lyrics.ovh
- Artist info: [Wikidata](https://www.wikidata.org/), [MusicBrainz](https://musicbrainz.org/), [TheAudioDB](https://www.theaudiodb.com/), [Deezer](https://www.deezer.com/) and [Wikipedia](https://www.wikipedia.org/)
- Recommendations: [Last.fm](https://www.last.fm/) and [YouTube Music](https://music.youtube.com/)

---

## Code Signing Policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

Official Windows releases are built from this repository's source by GitHub Actions. Only those builds are signed: never a file built on someone's own computer, and never third-party programs (yt-dlp, ffmpeg and slskd are not part of the installer).

**Team roles**

- Committers and reviewers: [sipbuu](https://github.com/sipbuu), [CHEYCKIT](https://github.com/CHEYCKIT)
- Approvers (who approve each signing request): [sipbuu](https://github.com/sipbuu)

Everyone with these roles signs in to GitHub with two-factor authentication.

**Privacy**

Lokal has no accounts, analytics or telemetry. Your library, listening history and settings stay on your computer. It only connects to other services for the features that need them:

- checking GitHub Releases for a new version (stable builds only);
- looking up lyrics, artwork and artist information (the services listed above under *Built With*);
- Last.fm, ListenBrainz, YouTube Music and Discord, if you connect them;
- searching, streaming and downloading, if you use those features.

---

## License

[MIT](https://opensource.org/license/mit)
