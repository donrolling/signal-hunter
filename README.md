<p align="center"><img src="assets/banner.svg" alt="Signal Hunter" width="720"></p>

# Signal Hunter

Find samples and clips by what's said. Add audio or video from your drive, any URL, or archive.org; Signal Hunter transcribes it with Whisper, then you search, scrub and export WAVs (or MP4s) for your DAW.

**[Download for Ableton Live (Windows / Mac)](https://github.com/donrolling/signal-hunter/releases/latest)**

## Ableton Live (Max for Live)

Needs Live 12 Suite, or Live 12 with Max for Live. Nothing else to install: the device runs its own server with the Node for Max that ships with Live.

1. Download `Signal-Hunter-windows.zip` or `Signal-Hunter-mac.zip` from the [latest release](https://github.com/donrolling/signal-hunter/releases/latest) and unzip it. There's no installer: the unzipped `Signal Hunter` folder is the device.
   Put the folder in your Live User Library, so it shows up under **User Library** in Live's browser:
   - Windows: usually `Documents\Ableton\User Library\Signal Hunter`
   - Mac: usually `Music/Ableton/User Library/Signal Hunter`

   Live may use a different folder: **Settings → Library → Location of User Library** shows the one it reads. Avoid a OneDrive-synced folder; it would sync thousands of small files.

   You can keep it anywhere else instead and add that folder to Live's browser with **Add Folder…** under Places. Either way, keep the folder together: the `.amxd` needs the files next to it.
2. Drag `Signal Hunter.amxd` onto any audio track; audio passes through untouched. The panel shows **Ready** once its server is up.
3. Click **Open Signal Hunter**.
4. Click an empty clip slot on an audio track, select a region, then **Send to Live** (`S`). The WAV lands in that slot.

The first time you add something, Signal Hunter asks where to keep your files (`Documents/Signal Hunter` is suggested). The first import also downloads the speech model (~250 MB) once.

## Adding sources

The server downloads and transcribes in the background; each import shows its progress under the add box, and the new source appears in the source picker when it's done.

- **Drop** audio or video files anywhere on the page, or click **Browse…**
- **Paste** a local file path (quotes from *Copy as path* are fine) or any direct audio/video URL.
- **Free sources** (optional) searches archive.org (public-domain radio, films, newsreels), Wikimedia Commons (freely licensed; some files ask for credit) and NASA's image and video library (public domain). Open a result and click **Add** on the files you want. Turn sources on or off in Settings. Pasting an archive.org link works too; for big collections, add a word from the file names after the link (`https://archive.org/details/OTRR_X_Minus_One_Singles MarsIsHeaven`).

## Finding and exporting

- The search box filters every transcript line; click a line to load ~20 s around it.
- Drag on the waveform to select. `space` plays the selection, `L` loops it, `E` exports a WAV.
- Video sources show a synced preview; `M` exports a frame-accurate MP4 at full resolution.
- `◀ 10s` / `10s ▶` slide the window; zoom in for precise edges.
- Exports are 24-bit WAV at the source sample rate, or H.264 MP4 with or without sound. **Open folder** next to Exports shows them.
- Sources with no speech (music, silent film) list 30-second rows to browse instead.
- In the source picker, hover a source for 🏷 (tags, comma separated, e.g. a project name) and 🗑 (delete it and its transcript; exports stay). Pick a tag to search only its sources.

## Settings

The ⚙ button: the Signal Hunter folder, the export folder (inside it by default; point it anywhere, e.g. a video project), which free sources to show, and interface size (also Ctrl/⌘ + and −). In Live, drag the Signal Hunter window bigger and the page fills it.

## Where things live

- The Signal Hunter folder you picked holds `library/` (sources and their transcripts), `tags.json` and, unless you chose another export folder, `exports/`.
- Settings: `%APPDATA%\Signal Hunter\settings.json` on Windows, `~/Library/Application Support/Signal Hunter` on a Mac.
- The speech model: `%LOCALAPPDATA%\Signal Hunter` on Windows, `~/Library/Caches/Signal Hunter` on a Mac.
- Search works on speech; music-only audio has nothing to search. Uses Whisper `small.en` (English).

## Without Live

Signal Hunter also runs in your browser, with no Live and nothing else to install.

1. Download and unzip the same release zip as above.
2. In the `Signal Hunter` folder, double-click **Start Signal Hunter** (`.cmd` on Windows, `.command` on Mac). Your browser opens on Signal Hunter.
3. Leave the small window it opens running while you work; close it to stop Signal Hunter.

Windows may show a SmartScreen warning the first time: click **More info → Run anyway**. On a Mac, right-click the file and choose **Open** the first time, since it isn't signed by Apple.

Everything works except **Send to Live**: export WAVs or MP4s instead. If the device is running in Live at the same time, the browser page simply shares its server.

From a clone of this repo, `npm install` then `npm start` does the same.

## Development

- `server.js` is the server, `index.html` the whole page, `logo.js` the device panel's logo, `window.js` keeps the page sized to its window.
- `python m4l/build_device.py` writes `Signal Hunter.amxd` (edit the script, not the `.amxd`).
- `node demo/record.js && node demo/live.js` re-records the demo video (`dist/signal-hunter-demo.mp4`): the browser walkthrough, then your Ableton Live screen recording spliced in. The tops of both files say what they need.
- `python m4l/package.py` builds `dist/Signal-Hunter-windows.zip` and `dist/Signal-Hunter-mac.zip`, with ffmpeg and the speech engine for each platform.
- To try the device from a checkout, run `npm install` and drag the `Signal Hunter.amxd` in the repo root onto a track.
