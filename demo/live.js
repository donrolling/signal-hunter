// Splices real Ableton Live footage into the recorded demo, at the 'live' mark record.js left:
//
//   node demo/record.js && node demo/live.js
//
// The footage is a screen recording of Live (video/AbletonLive-Example-Use.mp4): the Signal Hunter window
// looping a selection, Send to Live, then launching the clip in its slot. The screen recorder didn't catch
// Live's own output, so the launched clip's sound comes from the exported WAV it sent. The numbers below
// fit that one recording; a new recording needs new ones.
const { spawnSync, execFileSync } = require('child_process')
const fs = require('fs'), os = require('os'), path = require('path')

const ROOT = path.join(__dirname, '..'), WORK = path.join(ROOT, 'dist', 'demo-work')
const FFMPEG = require('ffmpeg-static')
const CHROME = process.env.CHROME || { win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }[process.platform] || 'google-chrome'
const LIVE = {
  file: path.join(ROOT, 'video', 'AbletonLive-Example-Use.mp4'),
  length: 12.3,                          // seconds of it to use (the clip has finished by then)
  crop: [840, 100, 1880, 1060],          // x, y, w, h: clip slots + the Signal Hunter window, 16:9, no status bar
  windowGain: '12dB',                    // the window's own sound, which the recording did catch (quietly)
  windowSound: 6,                        // ...until here, where the window closes
  clip: path.join(os.homedir(), 'Documents', 'Signal Hunter', 'exports', 'of-struggling-awake-through-nightmares.wav'),
  clipAt: 8.35,                          // when the launched clip starts playing in Live
  captions: [                            // [from, to, title, subtitle]
    [0.3, 5.6, 'In Ableton Live, pick a clip slot and Send to Live', 'the Signal Hunter window opens from the device'],
    [6.2, 11.9, 'The clip lands in the slot, ready to play', 'warp off by default · or Complex Pro'],
  ],
}
const FADE = 0.4  // crossfade into and out of the Live footage

function captionPng(title, sub, out) {  // same look as record.js's captions, rendered on a transparent 1920x1080
  const html = path.join(WORK, 'caption.html')
  fs.writeFileSync(html, `<style>html,body{margin:0;background:transparent}
    div{position:fixed;left:32px;bottom:40px;max-width:600px;background:#0d0f13ee;border:1px solid #f5b54466;border-radius:12px;
      padding:18px 26px;box-shadow:0 10px 40px #000a;font-family:Inter,Segoe UI,system-ui,sans-serif}
    b{display:block;color:#f2f2f2;font-size:30px;line-height:1.25;font-weight:600}
    i{display:block;color:#f5b544;font-size:19px;font-style:normal;margin-top:8px;font-family:Consolas,monospace}</style>
    <div><b>${title}</b><i>${sub}</i></div>`)
  spawnSync(CHROME, ['--headless=new', '--hide-scrollbars', '--window-size=1920,1080', '--default-background-color=00000000',
    `--user-data-dir=${path.join(WORK, 'profile-captions')}`, `--screenshot=${out}`, 'file:///' + html.replace(/\\/g, '/')])
  if (!fs.existsSync(out)) throw new Error('could not render caption ' + title)
}

const marks = JSON.parse(fs.readFileSync(path.join(WORK, 'marks.json'), 'utf8'))
const browser = path.join(WORK, 'browser.mp4'), out = path.join(ROOT, 'dist', 'signal-hunter-demo.mp4')
for (const f of [LIVE.file, LIVE.clip, browser]) if (!fs.existsSync(f)) throw new Error('missing ' + f)

const caps = LIVE.captions.map(([, , t, s], i) => { const f = path.join(WORK, `live-caption-${i}.png`); captionPng(t, s, f); return f })
// back from Live straight onto the end card once it has faded in (0.7 s), skipping the app between
const [cx, cy, cw, ch] = LIVE.crop, at = marks.live, back = marks.card + 0.8, L = LIVE.length
const v = 'fps=30,format=yuv420p,settb=1/30000'
const filter = [
  // the Live footage: crop to 16:9, captions faded in and out
  `[1:v]trim=0:${L},setpts=PTS-STARTPTS,crop=${cw}:${ch}:${cx}:${cy},scale=1920:1080,${v}[lv0]`,
  ...LIVE.captions.map(([a, b], i) => `[${3 + i}:v]format=rgba,fade=in:st=${a}:d=0.4:alpha=1,fade=out:st=${b - 0.4}:d=0.4:alpha=1[c${i}]`),
  ...LIVE.captions.map((_, i) => `[lv${i}][c${i}]overlay=0:0:shortest=1,${v}[lv${i + 1}]`),
  `[1:a]atrim=0:${LIVE.windowSound},volume=${LIVE.windowGain},afade=t=out:st=${LIVE.windowSound - 0.3}:d=0.3,aformat=sample_rates=48000:channel_layouts=stereo[wa]`,
  `[2:a]volume=6dB,aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(LIVE.clipAt * 1000)}:all=1[ca]`,
  `[wa][ca]amix=inputs=2:normalize=0,apad,atrim=0:${L}[la]`,
  // the browser demo, cut at the mark, with the Live footage crossfaded in between
  `[0:v]split[b0][b1]`, `[0:a]asplit[ba0][ba1]`,
  `[b0]trim=0:${at + FADE},setpts=PTS-STARTPTS,${v}[pre]`, `[b1]trim=${back},setpts=PTS-STARTPTS,${v}[post]`,
  `[ba0]atrim=0:${at + FADE},asetpts=PTS-STARTPTS[apre]`, `[ba1]atrim=${back},asetpts=PTS-STARTPTS[apost]`,
  `[pre][lv${LIVE.captions.length}]xfade=transition=fade:duration=${FADE}:offset=${at}[x1]`,
  `[x1][post]xfade=transition=fade:duration=${FADE}:offset=${at + L - FADE}[vout]`,
  `[apre][la]acrossfade=d=${FADE}[y1]`, `[y1][apost]acrossfade=d=${FADE}[aout]`,
].join(';')
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', browser, '-i', LIVE.file, '-i', LIVE.clip, ...caps.flatMap(c => ['-loop', '1', '-t', String(L), '-i', c]),
  '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out])
console.log(`wrote ${out}`)
