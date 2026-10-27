// Builds the demo video from scenes.cjs.
//
//   FFMPEG=/path/to/ffmpeg node build.cjs            # all scenes
//   FFMPEG=/path/to/ffmpeg node build.cjs p1-close   # just one scene (for iterating)
//
// 1. Narration: macOS `say`, one WAV per sentence, joined with short pauses.
// 2. Picture: headless Chromium at 1920×1080 (page zoomed 1.5×), captured with the
//    DevTools screencast while scripted actions run in time with the narration.
// 3. ffmpeg turns each scene into an MP4 and joins them. Also writes captions
//    (SRT), YouTube chapters and a plain-text script for re-recording the voice.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const scenes = require("./scenes.cjs");

const ROOT = __dirname;
const REPO = path.resolve(ROOT, "..");
const OUT = path.join(ROOT, "out");
const WORK = process.env.WORK_DIR || path.join(OUT, "work");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const VOICE = process.env.VOICE || "Daniel";
const RATE = process.env.RATE || "182";
const GAP = 0.42; // pause between sentences (s)
const LEAD = 0.5; // silence before the first sentence of a scene
const TAIL = 0.9; // silence after the last sentence
const W = 1920, H = 1080, ZOOM = 1.5;

// ───────────────────────── narration ─────────────────────────

// Captions keep the written form; the voice gets these spoken forms.
const SPOKEN = [
  [/([\d.]+) GWh/g, "$1 gigawatt hours"],
  [/\b1 GW\b/g, "one gigawatt"],
  [/([\d.]+) GW/g, "$1 gigawatts"],
  [/about 1 MB/g, "about one megabyte"],
  [/\+(\d)/g, "plus $1"],
  [/−/g, " minus "],
  [/N2EX/g, "N 2 E X"],
  [/EPEX/g, "Eepex"],
  [/FUELHH/g, "fuel H H"],
  [/WINDFOR/g, "wind for"],
  [/FastAPI/g, "Fast A P I"],
  [/Recharts/g, "Ree-charts"],
  [/pytest/g, "pie test"],
  [/README/g, "read me"],
  [/\bUI\b/g, "U I"],
  [/\bCSV\b/g, "C S V"],
  [/\bCDN\b/g, "C D N"],
  [/\bRMSE\b/g, "root mean square error"],
  [/\bVite\b/g, "Veet"],
  [/Europe\/London/g, "Europe London"],
  [/\b404\b/g, "four oh four"],
  [/09:20/g, "nine twenty"],
  [/09:50/g, "nine fifty"],
  [/09:30/g, "nine thirty"],
  [/07:30/g, "seven thirty"],
  [/04:30/g, "four thirty"],
];
const spoken = (text) => SPOKEN.reduce((t, [re, rep]) => t.replace(re, rep), text).replace(/\s+/g, " ").trim();
const sentences = (scene) => scene.say.map((s) => (typeof s === "string" ? { t: s } : s));

function readWav(file) {
  const b = fs.readFileSync(file);
  let fmt, data;
  for (let i = 12; i < b.length; ) {
    const id = b.toString("ascii", i, i + 4), size = b.readUInt32LE(i + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(i + 10), rate: b.readUInt32LE(i + 12), bits: b.readUInt16LE(i + 22) };
    if (id === "data") data = b.subarray(i + 8, i + 8 + size);
    i += 8 + size + (size % 2);
  }
  return { ...fmt, data };
}

function writeWav(file, { channels, rate, bits }, pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE((rate * channels * bits) / 8, 28); h.writeUInt16LE((channels * bits) / 8, 32);
  h.writeUInt16LE(bits, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

function tts(text) {
  const dir = path.join(OUT, "tts");
  fs.mkdirSync(dir, { recursive: true });
  const said = spoken(text);
  const file = path.join(dir, crypto.createHash("sha1").update(`${VOICE}|${RATE}|${said}`).digest("hex").slice(0, 16) + ".wav");
  if (!fs.existsSync(file)) {
    execFileSync("say", ["-v", VOICE, "-r", RATE, "--file-format=WAVE", "--data-format=LEI16@24000", "-o", file, said]);
  }
  return readWav(file);
}

/** One WAV per scene. Returns sentence start/end times and the scene length. */
function narrate(scene) {
  const parts = [], timing = [];
  let fmt, t = LEAD;
  const silence = (s) => Buffer.alloc(Math.round(s * fmt.rate) * fmt.channels * (fmt.bits / 8));
  for (const s of sentences(scene)) {
    const wav = tts(s.t);
    fmt = fmt || wav;
    if (!parts.length) parts.push(silence(LEAD));
    const dur = wav.data.length / (wav.rate * wav.channels * (wav.bits / 8));
    timing.push({ text: s.t, start: t, end: t + dur });
    parts.push(wav.data, silence(GAP + (s.pause || 0)));
    t += dur + GAP + (s.pause || 0);
  }
  const duration = t - GAP + TAIL;
  parts.push(silence(TAIL - GAP));
  const file = path.join(WORK, `${scene.id}.wav`);
  writeWav(file, fmt, Buffer.concat(parts));
  return { file, timing, duration };
}

// ───────────────────────── code snippets for the slides ─────────────────────────

const SNIPPETS = {
  rule: ["backend/app/analysis.py", [
    ["def gate_closure", "return datetime.combine(day - timedelta(days=1)"],
    ["def delivery_hours", "return hours"],
    ["def latest_before", "return runs[i - 1]"],
    ["def decision_forecast", "return points"],
  ]],
  band: ["backend/app/analysis.py", [
    ["class Band:", "return max(0.0, forecast - self.p90)"],
    ["def error_band", "return Band(quantile(errors, 0.10)"],
  ]],
  api: ["backend/app/main.py", [
    ["GateParam = Query(", "GateParam = Query("],
    ['@app.get("/api/day/{day}")', "return analysis.day_view"],
    ["@lru_cache(maxsize=1)", "return load()"],
    ["@lru_cache(maxsize=32)", "return _accuracy(gate)"],
  ]],
  perf: ["backend/app/main.py", [
    ["# The data is a fixed snapshot", "return response"],
  ]],
};

/** Copy the real code into the slides, so what's on screen matches the repo. */
function writeSnippets() {
  const out = {};
  for (const [name, [file, ranges]] of Object.entries(SNIPPETS)) {
    const lines = fs.readFileSync(path.join(REPO, file), "utf8").split("\n");
    out[name] = ranges.map(([from, to]) => {
      let a = lines.findIndex((l) => l.includes(from));
      if (a < 0) throw new Error(`${file}: "${from}" not found`);
      while (a > 0 && lines[a - 1].startsWith("@")) a--; // keep decorators
      const b = lines.findIndex((l, i) => i >= a && l.includes(to));
      return lines.slice(a, b + 1).join("\n").replace(/\n{3,}/g, "\n\n");
    }).join("\n\n");
  }
  fs.writeFileSync(path.join(OUT, "snippets.js"), `window.SNIPPETS = ${JSON.stringify(out, null, 2)};\n`);
}

// ───────────────────────── recording ─────────────────────────

// Runs in the page: zoom the layout to 1080p and draw a visible mouse pointer
// (headless Chromium has none). The pointer lives outside <body>, so it isn't zoomed.
function pageInit({ zoom, cursor }) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.style.zoom = String(zoom);
    if (!cursor) return;
    const c = document.createElement("div");
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M5 3 L5 24 L10.5 18.6 L14.3 27.2 L18 25.6 L14.3 17.2 L22 17.2 Z" fill="#fff" stroke="#111" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.55))" });
    document.documentElement.appendChild(c);
    window.__cursor = (x, y) => (c.style.transform = `translate(${x - 5}px, ${y - 3}px)`);
    window.__ripple = (x, y) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: `${x - 20}px`, top: `${y - 20}px`, width: "40px", height: "40px", borderRadius: "50%", border: "3px solid rgba(57,135,229,.95)", zIndex: 2147483646, pointerEvents: "none", transition: "transform .5s ease-out, opacity .5s ease-out" });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(r.style, { transform: "scale(1.7)", opacity: "0" })));
      setTimeout(() => r.remove(), 700);
    };
    window.__cursor(1720, 960);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/** Actions available to scenes. Coordinates are 1920×1080 viewport pixels. */
function actions(page) {
  let pos = { x: 1720, y: 960 };
  const moveTo = async (x, y) => {
    await page.mouse.move(x, y);
    await page.evaluate(([x, y]) => window.__cursor && window.__cursor(x, y), [x, y]);
    pos = { x, y };
  };
  const glide = async (x, y, ms = 700) => {
    const from = pos, n = Math.max(10, Math.round(ms / 18));
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      await moveTo(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      await sleep(10);
    }
  };
  const box = async (target, nth = 0) => {
    const b = await page.locator(target).nth(nth).boundingBox();
    if (!b) throw new Error(`not visible: ${target}`);
    return b;
  };
  return {
    page,
    moveTo,
    async point(target, o = {}) {
      const b = await box(target, o.nth);
      await glide(b.x + b.width * (o.fx ?? 0.5), b.y + b.height * (o.fy ?? 0.5), o.ms);
    },
    async click(target, o = {}) {
      await this.point(target, o);
      await sleep(120);
      await page.evaluate(([x, y]) => window.__ripple && window.__ripple(x, y), [pos.x, pos.y]);
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
    },
    /** Slide the pointer across a chart so its tooltip reads out values. */
    async sweep(target, fx0, fx1, fy, ms, o = {}) {
      const b = await box(target, o.nth);
      const y = b.y + b.height * fy;
      await glide(b.x + b.width * fx0, y, 500);
      const n = Math.round(ms / 22);
      for (let i = 1; i <= n; i++) {
        await moveTo(b.x + b.width * (fx0 + ((fx1 - fx0) * i) / n), y);
        await sleep(12);
      }
    },
    /** Smooth-scroll the window so `target`'s top sits `top` px below the viewport top. */
    async scroll(target, top = 80, ms = 900) {
      const b = await box(target);
      await page.evaluate(
        ([d, ms]) => new Promise((done) => {
          const y0 = scrollY, t0 = performance.now();
          const f = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            scrollTo(0, y0 + d * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
            k < 1 ? requestAnimationFrame(f) : done();
          };
          requestAnimationFrame(f);
        }),
        [b.y - top, ms],
      );
    },
    /** Click a field, then enter a value (e.g. a time input). */
    async type(target, value) {
      await this.click(target);
      await sleep(250);
      await page.locator(target).fill(value);
      await page.locator(target).blur();
    },
    async select(target, value) {
      await this.point(target);
      await sleep(150);
      await page.evaluate(([x, y]) => window.__ripple && window.__ripple(x, y), [pos.x, pos.y]);
      await page.locator(target).selectOption(value);
    },
    step: (k) => page.evaluate((k) => window.step(k), k),
  };
}

async function record(browser, scene, audio) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "dark", locale: "en-GB" });
  await ctx.addInitScript(pageInit, { zoom: ZOOM, cursor: !scene.slide });
  const page = await ctx.newPage();
  const url = scene.slide ? `file://${path.join(ROOT, "slides.html")}#${scene.id}` : scene.url;
  await page.goto(url, { waitUntil: "networkidle" });
  if (scene.slide) await page.waitForFunction(() => window.ready === true);
  else await page.waitForSelector(".recharts-surface");
  const h = actions(page);
  if (scene.setup) await scene.setup(h);
  await page.waitForTimeout(400);

  // Capture every frame Chromium paints, with its timestamp.
  const dir = path.join(WORK, scene.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
    frames.push({ ts: f.metadata.timestamp, file });
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H });
  while (!frames.length) await sleep(20);

  // Run the scene's actions in time with the narration.
  const t0 = Date.now() / 1000;
  const at = ([i, dt = 0]) => t0 + audio.timing[i].start + dt;
  const steps = scene.slide ? audio.timing.map((_, i) => ({ at: [i, 0], do: (h) => h.step(i) })) : scene.steps || [];
  for (const s of steps) {
    const wait = at(s.at) - Date.now() / 1000;
    if (wait > 0) await sleep(wait * 1000);
    else if (wait < -0.5) console.warn(`  ${scene.id}: step at sentence ${s.at[0]} ran ${(-wait).toFixed(1)}s late`);
    await s.do(h);
  }
  const left = t0 + audio.duration - Date.now() / 1000;
  if (left < 0) console.warn(`  ${scene.id}: actions overran the narration by ${(-left).toFixed(1)}s`);
  await sleep(Math.max(0, left) * 1000 + 300);
  await cdp.send("Page.stopScreencast");
  await sleep(300);
  await ctx.close();

  // Frames before t0 collapse into the opening frame; each frame lasts until the next.
  const first = Math.max(0, frames.findLastIndex((f) => f.ts <= t0));
  const kept = frames.slice(first);
  const lines = ["ffconcat version 1.0"];
  kept.forEach((f, i) => {
    const start = Math.max(f.ts, t0) - t0;
    const end = i + 1 < kept.length ? Math.max(kept[i + 1].ts, t0) - t0 : audio.duration;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, end - start).toFixed(4)}`);
  });
  lines.push(`file '${kept.at(-1).file}'`);
  const list = path.join(dir, "frames.txt");
  fs.writeFileSync(list, lines.join("\n") + "\n");

  const mp4 = path.join(WORK, `${scene.id}.mp4`);
  execFileSync(FFMPEG, [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", audio.file,
    "-vf", `fps=30,scale=${W}:${H},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-t", audio.duration.toFixed(3), mp4,
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
  return mp4;
}

// ───────────────────────── outputs ─────────────────────────

const clock = (s, ms = false) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (ms) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0").replace(".", ",")}`;
  return `${m}:${String(Math.floor(sec)).padStart(2, "0")}`;
};

/** Split long sentences into caption-sized chunks, timed by length. */
function captionChunks({ text, start, end }) {
  const words = text.split(" "), chunks = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    const len = cur.join(" ").length;
    if (len > 70 || (len > 38 && /[,.:;?]$/.test(w))) chunks.push(cur.join(" ")), (cur = []);
  }
  if (cur.length) chunks.push(cur.join(" "));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let t = start;
  return chunks.map((c) => {
    const d = ((end - start) * c.length) / total;
    const out = { text: c, start: t, end: t + d };
    t += d;
    return out;
  });
}

function writeOutputs(built) {
  let offset = 0, n = 1;
  const srt = [], chapters = [], script = ["# Demo video script", "", "Narration for each scene, with start times. Re-record in your own voice by reading each block over the matching part of the video.", ""];
  let part = 0;
  for (const { scene, audio } of built) {
    if (scene.part !== part) {
      part = scene.part;
      script.push(`## Part ${part}: ${part === 1 ? "Client overview" : "Technical review"}`, "");
    }
    chapters.push(`${clock(offset)} ${scene.chapter}`);
    script.push(`**${clock(offset)} · ${scene.chapter}**`, "", ...audio.timing.map((s) => s.text), "");
    for (const s of audio.timing) {
      for (const c of captionChunks({ ...s, start: s.start + offset, end: s.end + offset })) {
        srt.push(String(n++), `${clock(c.start, true)} --> ${clock(c.end, true)}`, c.text, "");
      }
    }
    offset += audio.duration;
  }
  fs.writeFileSync(path.join(OUT, "captions.srt"), srt.join("\n"));
  fs.writeFileSync(path.join(OUT, "script.md"), script.join("\n"));
  fs.writeFileSync(
    path.join(OUT, "youtube-description.txt"),
    [
      "Wind Forecast Desk: GB wind forecasts for day-ahead power buying (Elexon BMRS, decisions made in January 2026).",
      "",
      "Live app: https://asdcxsa.vercel.app",
      "Code: https://github.com/hk2166/asdcxsa",
      "",
      "Chapters",
      ...chapters,
      "",
      "Built with help from Claude Code (AI coding assistant). Narration uses a synthetic voice.",
    ].join("\n") + "\n",
  );
}

// ───────────────────────── main ─────────────────────────

(async () => {
  const only = process.argv[2];
  fs.mkdirSync(WORK, { recursive: true });
  writeSnippets();

  const built = scenes.map((scene) => ({ scene, audio: narrate(scene) }));
  for (const p of [1, 2]) {
    const secs = built.filter((b) => b.scene.part === p).reduce((s, b) => s + b.audio.duration, 0);
    console.log(`Part ${p}: ${clock(secs)}${secs > 300 ? "  ⚠ over 5 minutes" : ""}`);
  }
  const total = built.reduce((s, b) => s + b.audio.duration, 0);
  console.log(`Total: ${clock(total)}${total > 600 ? "  ⚠ over 10 minutes" : ""}`);
  if (process.env.DRY_RUN) return; // just the timings

  // Warm the API and CDN for every URL the scenes can open, so nothing waits on a cold start on camera.
  const appUrl = process.env.APP_URL || "https://asdcxsa.vercel.app";
  const meta = await fetch(`${appUrl}/api/meta`).then((r) => r.json());
  const gates = ["09:20", "09:50", "06:00"];
  const urls = gates.flatMap((g) => [`/api/accuracy?gate=${g}`, ...meta.delivery_days.map((d) => `/api/day/${d}?gate=${g}`)]);
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(urls.slice(i, i + 8).map((u) => fetch(appUrl + u).catch(() => {})));
  }

  const browser = await chromium.launch();
  for (const b of built) {
    b.mp4 = path.join(WORK, `${b.scene.id}.mp4`);
    if (only && !only.split(",").includes(b.scene.id)) continue;
    process.stdout.write(`recording ${b.scene.id} (${b.audio.duration.toFixed(1)}s)… `);
    await record(browser, b.scene, b.audio);
    console.log("done");
  }
  await browser.close();
  writeOutputs(built);

  // Join every scene. When re-recording a few scenes, the others are reused from WORK.
  const missing = built.filter((b) => !fs.existsSync(b.mp4)).map((b) => b.scene.id);
  if (missing.length) return console.log(`not joining: no recording yet for ${missing.join(", ")}`);
  const list = path.join(WORK, "scenes.txt");
  fs.writeFileSync(list, built.map((b) => `file '${b.mp4}'`).join("\n") + "\n");
  const final = path.join(OUT, "wind-forecast-desk-demo.mp4");
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final]);
  console.log(`wrote ${final}`);
})();
