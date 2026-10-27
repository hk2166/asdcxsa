# Demo video

Scripted build of the submission video: the live app and slides are recorded in headless Chromium and narrated with macOS `say`. Change the app or the narration, run it again, and you get an updated video.

| File | What it is |
|---|---|
| `scenes.cjs` | Narration, one sentence per line, plus the on-screen actions timed to it |
| `slides.html` | Slides for the intro, close and technical part (`slides.html#p2-arch` etc.) |
| `build.cjs` | Makes the narration, records each scene, and joins them with ffmpeg |
| `out/` | Results (not in git): `wind-forecast-desk-demo.mp4`, `captions.srt`, `youtube-description.txt`, `script.md` |

## Build

Needs macOS (for `say`), Node 22 and an ffmpeg with libx264.

```bash
cd demo
npm install
npx playwright install chromium
FFMPEG=$(which ffmpeg) node build.cjs            # whole video, about 12 minutes
FFMPEG=$(which ffmpeg) node build.cjs p1-close,p2-arch   # re-record some scenes, reuse the rest
```

Options: `VOICE` (default `Daniel`), `RATE` (words per minute, default 182) and `APP_URL` (default the Vercel app). `DRY_RUN=1` only prints each part's length, to check the 5-minute limits before recording.

## Using your own voice

`out/script.md` has the narration with the start time of each scene. To narrate it yourself, mute the video in any editor (iMovie, CapCut, DaVinci Resolve) and record over it, reading each block at its timestamp.
