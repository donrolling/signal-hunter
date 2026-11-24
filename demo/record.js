// Records the demo video (dist/signal-hunter-demo.mp4): drives the real UI in headless Chrome, captures
// screencast frames, and rebuilds the sound from what played (Chrome runs muted, so we log every
// play/pause/seek of the clip and cut the same stretches from the source files).
//
//   node demo/record.js
//
// Needs Chrome, `npm install` (for ffmpeg-static), and a demo library in dist/demo-data/library (or
// DEMO_DATA) holding the two public-domain sources steps.js searches, named exactly:
//   Apollo-11-The-Eagle-Has-Landed.mp4  NASA, "The Flight of Apollo 11: The Eagle Has Landed" (Free sources → NASA)
//   Duck-and-Cover-1951.mp4             archive.org/details/DuckandC1951
// Add them with Signal Hunter pointed at that folder, then rename each file and its .json to match.
const { spawn, execFileSync } = require('child_process')
const fs = require('fs'), path = require('path')

const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'dist')
const DATA = path.resolve(process.env.DEMO_DATA || path.join(OUT, 'demo-data'))
const WORK = path.join(OUT, 'demo-work'), FRAMES = path.join(WORK, 'frames')
const PORT = 8780, W = 1920, H = 1080
const CHROME = process.env.CHROME || { win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }[process.platform] || 'google-chrome'
const FFMPEG = require('ffmpeg-static')
const LOGO = fs.readFileSync(path.join(ROOT, 'assets', 'logo.svg'), 'utf8')
const STEPS = require('./steps.js')

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  if (!fs.existsSync(path.join(DATA, 'library'))) throw new Error(`no demo library in ${DATA} (see the top of this file)`)
  fs.rmSync(FRAMES, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true })

  // a server of its own: own settings folder (APPDATA), the demo library, exports inside it
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', PORT], { stdio: 'ignore',
    env: { ...process.env, APPDATA: path.join(WORK, 'appdata'), SIGNAL_HUNTER_DATA: DATA } })
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--window-size=${W},${H}`,
    `--user-data-dir=${path.join(WORK, 'profile')}`, '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
  try { await record() } finally { chrome.kill(); server.kill() }
}

async function record() {
  let targets; for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json/list')).json() } catch { await sleep(200) } }
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/api/settings`); break } catch { await sleep(200) } }
  await fetch(`http://localhost:${PORT}/api/settings`, { method: 'POST', body: JSON.stringify({ uiScale: 1.25, exportDir: path.join(DATA, 'exports') }) })

  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(r => ws.onopen = r)
  let id = 0, cutAt = 0, offset = 0, t0 = 0
  const pending = {}, frames = [], sound = [], marks = {}  // sound: { at (video seconds), ep, from (source seconds), to }
  const now = () => Date.now() / 1000 - offset - t0  // the video's clock: wall time minus cuts
  let playing = null
  const media = e => {  // events from the page's <video> (which wavesurfer plays through)
    const src = e.clipStart + e.ct
    if (playing) { playing.dur = now() - playing.at; sound.push(playing); playing = null }
    if (e.ep && (e.type === 'playing' || (e.type === 'seeked' && !e.paused))) playing = { at: now(), ep: e.ep, from: src }
  }
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id && pending[m.id]) { pending[m.id](m.result || m); delete pending[m.id] }
    if (m.method === 'Runtime.bindingCalled' && m.params.name === '__media') media(JSON.parse(m.params.payload))
    if (m.method === 'Page.screencastFrame') {
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
      if (cutAt) return  // inside a cut: drop
      const f = path.join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`)
      fs.writeFileSync(f, Buffer.from(m.params.data, 'base64'))
      if (!t0) t0 = m.params.metadata.timestamp - offset
      frames.push({ f, t: m.params.metadata.timestamp - offset - t0 })
    }
  }
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })) })
  const js = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value

  await send('Page.enable'); await send('Runtime.enable')
  await send('Runtime.addBinding', { name: '__media' })
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://localhost:${PORT}/?live=1` }); await sleep(2500)  // ?live=1 shows Send to Live
  await js(OVERLAY(LOGO))

  // ---- what steps.js can do
  let cx = W / 2, cy = H / 2
  const center = async sel => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1, ...extra })
  const api = {
    sleep, js, center,
    mark: name => { marks[name] = now() },  // video times for demo/live.js (where the Live footage goes)
    log: t => console.log(new Date().toISOString().slice(11, 19), t),
    // leave slow waits (a clip loading) out of the video: frames stop, and later ones close the gap
    async cut(fn) { const s = Date.now() / 1000; cutAt = s; try { await fn() } finally { offset += Date.now() / 1000 - s; cutAt = 0 } },
    async waitFor(cond, ms = 60000) { for (const t = Date.now(); Date.now() - t < ms; await sleep(100)) if (await js(cond)) return; throw new Error('timed out: ' + cond) },
    async move(x, y, ms = 600) {
      await js(`__cur(${x}, ${y}, ${ms})`)
      const n = Math.max(1, Math.round(ms / 30))
      for (let i = 1; i <= n; i++) { const k = i / n, e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; await mouse('mouseMoved', cx + (x - cx) * e, cy + (y - cy) * e); await sleep(ms / n) }
      cx = x; cy = y
    },
    async click(sel, ms) { const [x, y] = await center(sel); await api.move(x, y, ms); await api.clickHere() },
    async clickHere() { await js(`__ripple()`); await mouse('mousePressed', cx, cy, { buttons: 1 }); await sleep(60); await mouse('mouseReleased', cx, cy) },
    async drag(x, y, ms = 700) {
      await mouse('mousePressed', cx, cy, { buttons: 1 }); await js(`__ripple()`)
      const n = Math.round(ms / 30), sx = cx, sy = cy
      await js(`__cur(${x}, ${y}, ${ms})`)
      for (let i = 1; i <= n; i++) { await mouse('mouseMoved', sx + (x - sx) * i / n, sy + (y - sy) * i / n, { buttons: 1 }); await sleep(ms / n) }
      await mouse('mouseReleased', x, y); cx = x; cy = y
    },
    async type(text, per = 70) { for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(per + Math.random() * 40) } },
    key: async (key, code = key, keyCode) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode }) },
    caption: (t, sub = '') => js(`__cap(${JSON.stringify(t)}, ${JSON.stringify(sub)})`),
    card: (html, on = true) => js(`__card(${JSON.stringify(html)}, ${on})`),
  }

  await send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 })
  // screencast only sends frames on change: a tiny invisible ticker keeps frames flowing for even timing
  await js(`setInterval(() => document.getElementById('__tick').style.opacity = Math.random() * .01, 33)`)
  await STEPS(api)
  await send('Page.stopScreencast'); await sleep(300)
  if (playing) media({ type: 'pause', clipStart: 0, ct: 0 })
  ws.close()

  // ---- encode: each frame lasts until the next one; each stretch that played is cut from its source
  const dur = frames.at(-1).t + 0.04
  const list = frames.map((fr, i) => `file '${fr.f.replace(/\\/g, '/')}'\nduration ${((frames[i + 1]?.t ?? dur) - fr.t).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1).f.replace(/\\/g, '/')}'\n`
  fs.writeFileSync(path.join(WORK, 'frames.txt'), list)
  const clips = sound.filter(s => s.dur > 0.05)
  const inputs = clips.flatMap(s => ['-ss', s.from.toFixed(3), '-t', s.dur.toFixed(3), '-i', path.join(DATA, 'library', s.ep)])
  const chains = clips.map((s, i) => `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=6dB,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, s.dur - 0.02).toFixed(3)}:d=0.02,adelay=${Math.round(s.at * 1000)}:all=1[a${i}]`)
  const mix = clips.length ? `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,apad,atrim=0:${dur.toFixed(3)}[aout]` : ''
  const out = path.join(WORK, 'browser.mp4')  // demo/live.js adds the Live footage and writes dist/signal-hunter-demo.mp4
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'frames.txt'), ...inputs,
    ...(clips.length ? ['-filter_complex', [...chains, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out])
  fs.writeFileSync(path.join(WORK, 'marks.json'), JSON.stringify({ ...marks, end: dur }))
  console.log(`wrote ${out}: ${dur.toFixed(1)} s, ${clips.length} sound clips`)
  for (const s of clips) console.log(`  ${s.at.toFixed(2)}s  ${s.ep} ${s.from.toFixed(2)} +${s.dur.toFixed(2)}`)
}

// cursor, click ripple, captions and title cards, injected into the page; also reports the clip's playback
const OVERLAY = logo => `(() => {
  const css = document.createElement('style'); css.textContent = \`
    #__c { position:fixed; left:960px; top:540px; z-index:99999; pointer-events:none; transition-property:left,top; transition-timing-function:ease-in-out; filter:drop-shadow(0 2px 3px #000a) }
    .__rip { position:fixed; z-index:99998; width:44px; height:44px; margin:-22px 0 0 -22px; border-radius:50%; border:2px solid #f5b544; pointer-events:none; animation:__r .5s ease-out forwards }
    @keyframes __r { from { transform:scale(.3); opacity:1 } to { transform:scale(1.4); opacity:0 } }
    #__cap { position:fixed; left:32px; bottom:40px; max-width:600px; z-index:99997; transform:translateY(20px); opacity:0; transition:all .45s ease; pointer-events:none;
      background:#0d0f13ee; border:1px solid #f5b54466; border-radius:12px; padding:18px 26px; text-align:left; box-shadow:0 10px 40px #000a; font-family:Inter,Segoe UI,system-ui,sans-serif }
    #__cap.on { opacity:1; transform:none }
    #__cap b { display:block; color:#f2f2f2; font-size:30px; line-height:1.25; font-weight:600; letter-spacing:.2px }
    #__cap i { display:block; color:#f5b544; font-size:19px; font-style:normal; margin-top:8px; font-family:Consolas,monospace }
    #__card { position:fixed; inset:0; z-index:99996; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px;
      background:radial-gradient(circle at 50% 40%, #1b1f27, #08090b 70%); opacity:0; transition:opacity .7s ease; pointer-events:none; color:#eee; font-family:Inter,Segoe UI,system-ui,sans-serif; text-align:center }
    #__card.on { opacity:1 } #__card svg { width:170px; height:170px }
    #__card h1 { margin:0; font-size:80px; letter-spacing:9px; font-weight:800 } #__card h1 span { color:#f5b544 }
    #__card p { margin:0; font-size:32px; color:#aab } #__card small { font-family:Consolas,monospace; color:#f5b544; font-size:24px }
    #__tick { position:fixed; left:0; top:0; width:1px; height:1px; background:#000 }\`
  document.head.append(css)
  const c = document.createElement('div'); c.id = '__c'
  c.innerHTML = '<svg width="28" height="38" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12 28 L16 26.3 L12 17 L20 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const cap = document.createElement('div'); cap.id = '__cap'
  const card = document.createElement('div'); card.id = '__card'
  const tick = document.createElement('div'); tick.id = '__tick'
  document.body.append(card, cap, c, tick)
  // the app zooms the page (interface size); undo it on the overlays so they use real pixels
  const unzoom = () => 1 / (parseFloat(document.documentElement.style.zoom) || 1)
  for (const e of [card, cap, c]) e.style.zoom = unzoom()
  window.__logo = ${JSON.stringify(logo)}
  window.__cur = (x, y, ms) => { c.style.transitionDuration = ms + 'ms'; c.style.left = x + 'px'; c.style.top = y + 'px' }
  window.__ripple = () => { const r = document.createElement('div'); r.className = '__rip'; r.style.zoom = unzoom(); r.style.left = c.style.left || '960px'; r.style.top = c.style.top || '540px'; document.body.append(r); setTimeout(() => r.remove(), 600) }
  window.__cap = (t, sub) => { if (!t) return cap.classList.remove('on'); cap.innerHTML = '<b>' + t + '</b>' + (sub ? '<i>' + sub + '</i>' : ''); cap.classList.add('on') }
  window.__card = (html, on) => { if (html) card.innerHTML = html.replace('{logo}', window.__logo); card.classList.toggle('on', on) }
  // the clip's playback, for the sound track: #info reads "<source> · window m:ss.xx–m:ss.xx"
  const secs = s => s.split(':').reduce((a, b) => a * 60 + +b, 0)
  const v = document.getElementById('video')
  for (const type of ['playing', 'pause', 'seeked', 'emptied']) v.addEventListener(type, () => {
    const m = document.getElementById('info').textContent.match(/^(.+?) · window ([\\d:.]+)/)
    // sent even mid-load (no window yet), so a pause still ends the stretch that was playing
    __media(JSON.stringify({ type, ep: m?.[1], clipStart: m ? secs(m[2]) : 0, ct: v.currentTime, paused: v.paused }))
  })
  // keep the recording machine's folders out of the video
  const scrub = () => document.querySelectorAll('#status, #expDir').forEach(e => {
    const t = e.textContent.replace(/\\S*[\\\\/]demo-data/g, 'Documents/Signal Hunter'); if (t !== e.textContent) e.textContent = t
  })
  scrub(); new MutationObserver(scrub).observe(document.body, { subtree: true, childList: true, characterData: true })
})()`

main().catch(e => { console.error(e); process.exit(1) })
