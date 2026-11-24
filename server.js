// Signal Hunter: find samples and clips by what is said.
//
// Runs inside the Live device (Max's node.script starts it) or on its own:  node server.js [--port 8765]
// Library: <data>/library/<name>.<ext> + <name>.json (Whisper segments). Exports: <data>/exports/.
// <data> is the folder the user picks on first use (SIGNAL_HUNTER_DATA overrides it); settings live in the OS config folder.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path')
const { spawn, spawnSync } = require('child_process')

// Packaged builds carry bin/ffmpeg-<platform>-<arch>; a dev checkout uses ffmpeg-static, else ffmpeg on PATH.
const BUNDLED = path.join(__dirname, 'bin', `ffmpeg-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`)
if (process.platform === 'darwin') {
  // A downloaded zip is quarantined, and macOS then refuses its ffmpeg and speech-engine libraries.
  // These are our own files, so lift the flag (untested on a real Mac so far).
  spawnSync('xattr', ['-dr', 'com.apple.quarantine', __dirname])
  try { fs.chmodSync(BUNDLED, 0o755) } catch {}
}
const FFMPEG = fs.existsSync(BUNDLED) ? BUNDLED : (() => { try { return require('ffmpeg-static') } catch { return 'ffmpeg' } })()
let Max = null
try { Max = require('max-api') } catch {}  // only there inside node.script

// settings sit outside the data folder, so they can say where the data folder is
const CONFIG = path.join(process.env.APPDATA || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.config'), 'Signal Hunter')
const SETTINGS = path.join(CONFIG, 'settings.json')
const SUGGESTED = path.join(os.homedir(), 'Documents', 'Signal Hunter')
let DATA = null, LIB = null  // set once the user has picked a folder (see useData)
// the ~250 MB speech model goes in a cache folder, not Documents (which is often synced to the cloud)
const MODELS = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache'),
  'Signal Hunter', 'models')
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.ogv', '.avi', '.mpeg', '.mpg'])
const MEDIA_EXT = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', ...VIDEO_EXT])
const ext = f => path.extname(f).toLowerCase()
const stem = f => path.basename(f, path.extname(f))
const slug = s => s.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'clip'
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const jsonOf = f => path.join(path.dirname(f), stem(f) + '.json')

class Oops extends Error {}  // a user-facing problem (bad source, too many files, ...)

// ---------- ffmpeg ----------

function srcArgs(p, start, dur) {
  const a = start != null ? ['-ss', start.toFixed(3), '-t', dur.toFixed(3)] : []
  // some archive.org OTRR mp3s have a RIFF-looking header that makes ffmpeg probe them as WAV
  return [...a, ...(ext(p) === '.mp3' ? ['-f', 'mp3'] : []), '-i', p]
}
const decode = (p, start, dur, rate = 16000) => ['-v', 'error', ...srcArgs(p, start, dur), '-ac', '1', '-ar', String(rate)]

function ffmpeg(args) {  // -> Buffer of stdout; rejects with ffmpeg's stderr
  return new Promise((ok, fail) => {
    const p = spawn(FFMPEG, args), out = [], err = []
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d))
    p.on('error', fail)
    p.on('close', code => code ? fail(new Error(Buffer.concat(err).toString().slice(-500) || `ffmpeg exited ${code}`)) : ok(Buffer.concat(out)))
  })
}

// ---------- archive.org ----------

// preferred copy when an item has the same recording in several formats
const ARCHIVE_PREF = ['.mp4', '.webm', '.mkv', '.mov', '.ogv', '.avi', '.mpeg', '.mpg', '.mp3', '.flac', '.m4a', '.ogg', '.wav']

// Wikimedia asks API clients to say who they are
const UA = { 'User-Agent': 'SignalHunter/0.2 (+https://github.com/donrolling/signal-hunter)' }
async function getJSON(url) {
  const r = await fetch(url, { headers: UA })
  if (!r.ok) throw new Oops(`${new URL(url).hostname} said ${r.status}`)
  return r.json()
}

async function archiveMedia(ident) {  // one entry per recording: [{name, url, size, video}]
  const meta = await getJSON(`https://archive.org/metadata/${encodeURIComponent(ident)}`)
  const best = new Map()
  for (const f of meta.files || []) {
    const i = ARCHIVE_PREF.indexOf(ext(f.name)); if (i < 0) continue
    const key = stem(f.name).toLowerCase().replace(/_(512kb|256kb|128kb|64kb|vbr)$/, '')  // derivatives share a stem
    const size = +f.size || 0, cur = best.get(key)
    if (!cur || i < cur.i || (i === cur.i && size > cur.size)) best.set(key, { i, size, name: f.name })
  }
  return [...best.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map(f => ({
    name: f.name, size: f.size, video: VIDEO_EXT.has(ext(f.name)),
    url: `https://archive.org/download/${ident}/${encodeURIComponent(f.name)}`,
  }))
}

async function archiveFiles(ident, match) {
  let files = await archiveMedia(ident)
  if (match) files = files.filter(f => f.name.toLowerCase().includes(match.toLowerCase()))
  if (files.length > 5 && !match)
    throw new Oops(`${files.length} files in ${ident}; add a word from the file names to narrow it ` +
      `(e.g. '${ident} ${stem(files[0].name).slice(-12)}'). First few: ` + files.slice(0, 8).map(f => f.name).join(', '))
  if (!files.length) throw new Oops(`no matching audio or video in ${ident}`)
  return files.map(f => f.url)
}

async function archiveSearch(q, kind, page) {
  const types = { audio: 'audio', video: 'movies' }[kind] || '(audio OR movies)'
  const w = (q.match(/\w+/g) || []).join(' AND ')  // every word must match, in the title, subject or creator
  const match = w ? `(title:(${w}) OR subject:(${w}) OR creator:(${w})) AND ` : ''
  const p = new URLSearchParams([['q', `${match}mediatype:${types}`], ['fl[]', 'identifier'], ['fl[]', 'title'],
    ['fl[]', 'mediatype'], ['fl[]', 'year'], ['sort[]', 'downloads desc'], ['rows', '30'], ['page', String(page)], ['output', 'json']])
  const r = await getJSON('https://archive.org/advancedsearch.php?' + p)
  return r.response.docs.map(d => ({ id: d.identifier, title: d.title || d.identifier, year: d.year || '', video: d.mediatype === 'movies',
    thumb: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}` }))
}

// Wikimedia Commons: one file per result
const commonsQuery = params => getJSON('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
  action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '320', ...params }))
const commonsItem = pg => {
  const i = pg.imageinfo?.[0] || {}
  return { id: pg.title, title: pg.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''), year: '', video: /^video|ogg/.test(i.mime || ''),
    thumb: i.thumburl || '', url: i.url?.split('?')[0], size: Math.max(0, i.size || 0) }
}
async function commonsSearch(q, kind, page) {
  const types = kind ? [kind] : ['video', 'audio']
  const out = []
  for (const t of types) {
    const r = await commonsQuery({ generator: 'search', gsrnamespace: '6', gsrsearch: `${q} filetype:${t}`,
      gsrlimit: String(30 / types.length), gsroffset: String((page - 1) * 30 / types.length) })
    out.push(...Object.values(r.query?.pages || {}).sort((a, b) => a.index - b.index).map(commonsItem))
  }
  return out.map(({ url, size, ...d }) => d)
}
async function commonsFiles(title) {
  const pg = Object.values((await commonsQuery({ titles: title })).query?.pages || {})[0]
  const d = pg && commonsItem(pg)
  return d?.url ? [{ name: path.basename(decodeURIComponent(d.url)), url: d.url, size: d.size, video: d.video }] : []
}

// NASA Image and Video Library (public domain)
async function nasaSearch(q, kind, page) {
  const r = await getJSON('https://images-api.nasa.gov/search?' + new URLSearchParams({ q, media_type: kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'video,audio', page: String(page), page_size: '30' }))
  return r.collection.items.map(i => ({ id: i.data[0].nasa_id, title: i.data[0].title, year: (i.data[0].date_created || '').slice(0, 4),
    video: i.data[0].media_type === 'video', thumb: (i.links || []).find(l => l.render === 'image')?.href || '' }))
}
async function nasaFiles(id) {
  const r = await getJSON(`https://images-api.nasa.gov/asset/${encodeURIComponent(id)}`)
  const order = ['orig', 'large', 'medium', 'small', 'mobile']  // NASA's renditions, biggest first; skip previews
  return r.collection.items.map(x => x.href.replace(/^http:/, 'https:'))
    .filter(u => MEDIA_EXT.has(ext(u)) && !/~preview\./.test(u))
    .map(u => ({ url: encodeURI(u), name: decodeURIComponent(path.basename(u)), size: 0, video: VIDEO_EXT.has(ext(u)),
      rank: order.findIndex(o => u.includes(`~${o}.`)) >>> 0 }))
    .sort((a, b) => a.rank - b.rank).map(({ rank, ...f }) => f)
}

const PROVIDERS = {
  archive: { name: 'archive.org', blurb: 'Public-domain radio, films, newsreels, cartoons and more.', search: archiveSearch, files: archiveMedia },
  commons: { name: 'Wikimedia Commons', blurb: 'Freely licensed audio and video. Some files ask for credit: check the license on the file page.', search: commonsSearch, files: commonsFiles,
    page: id => `https://commons.wikimedia.org/wiki/${encodeURIComponent(id)}` },
  nasa: { name: 'NASA', blurb: 'Launches, mission audio, documentaries and space footage, all public domain.', search: nasaSearch, files: nasaFiles,
    page: id => `https://images.nasa.gov/details/${encodeURIComponent(id)}` },
}
PROVIDERS.archive.page = id => `https://archive.org/details/${encodeURIComponent(id)}`

// ---------- settings (<OS config folder>/Signal Hunter/settings.json) ----------

// dataDir: where sources, transcripts and tags live (null until the user picks it); exportDir: null = <dataDir>/exports
const DEFAULTS = { dataDir: null, exportDir: null, sources: { archive: true, commons: true, nasa: true }, uiScale: 1 }
function settings() {
  let saved = {}
  try { saved = json(SETTINGS) } catch {
    // earlier versions kept settings.json in Documents/Signal Hunter: adopt that folder as the data folder
    try { saved = { ...json(path.join(SUGGESTED, 'settings.json')), dataDir: SUGGESTED } } catch {}
    if (!saved.dataDir && fs.existsSync(path.join(SUGGESTED, 'library'))) saved = { dataDir: SUGGESTED }
  }
  if (process.env.SIGNAL_HUNTER_DATA) saved.dataDir = process.env.SIGNAL_HUNTER_DATA
  // an export folder that is just <data>/exports is the default: store it as null so it follows a moved data folder
  if (saved.dataDir && saved.exportDir && path.resolve(saved.exportDir) === path.resolve(saved.dataDir, 'exports')) saved.exportDir = null
  return { ...DEFAULTS, ...saved, sources: { ...DEFAULTS.sources, ...saved.sources } }
}
const fullPath = (dir, what) => {
  if (!path.isAbsolute(dir)) throw new Oops(`${what} must be a full path, like C:\\Clips or /Users/you/Clips`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
function saveSettings(patch) {
  const next = { ...settings(), ...patch }
  if (patch.sources) next.sources = { ...settings().sources, ...patch.sources }
  if (patch.exportDir) fullPath(patch.exportDir, 'the export folder')
  if (patch.dataDir) useData(fullPath(patch.dataDir, 'the Signal Hunter folder'))
  fs.mkdirSync(CONFIG, { recursive: true })
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 1))
  return next
}
function useData(dir) {
  DATA = dir; LIB = dir && path.join(dir, 'library')
  if (LIB) fs.mkdirSync(LIB, { recursive: true })
}
const EXP = () => {
  const d = settings().exportDir || (DATA && path.join(DATA, 'exports'))
  if (d) fs.mkdirSync(d, { recursive: true })
  return d
}

// tags group sources (by project or anything else): <data>/tags.json, {"source.mp3": ["Space Detective"]}
const TAGS = () => path.join(DATA, 'tags.json')
const readTags = () => { try { return json(TAGS()) } catch { return {} } }
function setTags(name, list) {
  const all = readTags(), clean = [...new Set((list || []).map(t => String(t).trim()).filter(Boolean))]
  if (clean.length) all[name] = clean; else delete all[name]
  fs.writeFileSync(TAGS(), JSON.stringify(all, null, 1))
  return clean
}

function chooseFolder(start, title) {  // the OS's own folder picker; resolves '' if cancelled
  const run = (cmd, args) => new Promise(ok => {
    const c = spawn(cmd, args), out = []
    c.stdout.on('data', d => out.push(d)); c.on('close', () => ok(Buffer.concat(out).toString().trim())); c.on('error', () => ok(''))
  })
  if (process.platform === 'win32')  // the modern Explorer-style picker (pastable address bar), see pick_folder.ps1
    return run('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'pick_folder.ps1'),
      '-Start', start || '', '-Title', title])
  if (process.platform === 'darwin')
    return run('osascript', ['-e', `POSIX path of (choose folder with prompt ${JSON.stringify(title)})`])
  return run('zenity', ['--file-selection', '--directory'])
}
const openFolder = d => spawn(process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open', [d], { detached: true, stdio: 'ignore' }).unref()

// ---------- ingest ----------

async function download(url, dst, say) {
  const name = decodeURIComponent(url.split('/').pop())
  say(`downloading ${name}`, 0)
  const r = await fetch(url)
  if (!r.ok) throw new Oops(`download failed (${r.status}): ${url}`)
  const total = +r.headers.get('content-length') || 0, part = dst + '.part'  // a failed download never looks finished
  const f = fs.createWriteStream(part)
  let got = 0
  for await (const chunk of r.body) {
    got += chunk.length
    if (!f.write(chunk)) await new Promise(ok => f.once('drain', ok))
    if (total) say(`downloading ${name}`, Math.min(1, got / total))
  }
  await new Promise((ok, fail) => f.end(e => e ? fail(e) : ok()))
  fs.renameSync(part, dst)
}

async function fetchSrc(src, match, say) {
  if (fs.existsSync(src) && fs.statSync(src).isFile()) {
    if (!MEDIA_EXT.has(ext(src))) throw new Oops(`not an audio/video file: ${src}`)
    const dst = path.join(LIB, slug(stem(src)) + ext(src))
    if (path.resolve(dst).toLowerCase() !== path.resolve(src).toLowerCase()) fs.copyFileSync(src, dst)
    return [dst]
  }
  if (/^([a-zA-Z]:[\\/]|\\\\|\/|~)/.test(src)) throw new Oops(`file not found: ${src}`)  // looks local, isn't a file
  const m = src.match(/^https?:\/\/archive\.org\/(?:details|download)\/([^/?#]+)\/?(?:[?#].*)?$/)
  const urls = m ? await archiveFiles(m[1], match) : src.includes('://') ? [src] : await archiveFiles(src, match)
  const out = []
  for (const u of urls) {
    const name = decodeURIComponent(u.split('/').pop().split('?')[0])
    const dst = path.join(LIB, slug(stem(name)) + (ext(name) || '.mp3'))
    if (!fs.existsSync(dst)) await download(u, dst, say)
    out.push(dst)
  }
  return out
}

let asr = null
async function transcribe(paths, say) {
  if (!asr) {  // load once; it's slow
    say('loading the speech model (the first run downloads ~250 MB)')
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = MODELS
    asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-small.en',
      { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } })
  }
  for (const p of paths) {
    const j = jsonOf(p)
    if (fs.existsSync(j)) continue
    say(`reading ${path.basename(p)}`)
    const raw = await ffmpeg([...decode(p), '-f', 'f32le', '-'])
    const audio = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), dur = Math.max(audio.length / 16000, 1)
    // ponytail: 2-minute blocks give progress ticks; a line spanning a block edge gets split in two
    const BLOCK = 120 * 16000, out = []
    for (let i = 0; i < audio.length; i += BLOCK) {
      say(`transcribing ${path.basename(p)}`, Math.min(1, i / 16000 / dur))
      const r = await asr(audio.subarray(i, i + BLOCK), { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true })
      for (const c of r.chunks) {
        const text = c.text.trim(), [a, b] = c.timestamp
        if (text) out.push({ start: +(i / 16000 + a).toFixed(2), end: +(i / 16000 + (b ?? a + 2)).toFixed(2), text })
      }
    }
    fs.writeFileSync(j, JSON.stringify(out, null, 1))
  }
}

// ---------- background imports (one at a time: transcription already uses every core) ----------

const JOBS = [], queue = []
let nextId = 1, busy = false

function enqueue(label, getPaths) {
  const job = { id: nextId++, label, state: 'queued', msg: 'waiting for the one ahead', progress: null }
  JOBS.push(job); queue.push([job, getPaths]); work()
  return job
}

async function work() {
  if (busy) return
  busy = true
  while (queue.length) {
    const [job, getPaths] = queue.shift()
    job.state = 'working'
    const say = (msg, progress = null) => Object.assign(job, { msg, progress })
    say('starting')
    try {
      const paths = await getPaths(say)
      await transcribe(paths, say)
      const lines = paths.reduce((n, p) => n + json(jsonOf(p)).length, 0)
      Object.assign(job, { state: 'done', msg: `added, ${lines} lines`, progress: 1, episodes: paths.map(p => path.basename(p)) })
    } catch (e) {
      Object.assign(job, { state: 'error', msg: e.message, progress: null })
    }
    status()
  }
  busy = false
}

// ---------- server ----------

const durations = new Map()  // path|mtime -> seconds, read from ffmpeg's header dump
async function duration(p) {
  const key = p + '|' + fs.statSync(p).mtimeMs
  if (!durations.has(key)) {
    const err = await new Promise(ok => { const e = []; const c = spawn(FFMPEG, ['-hide_banner', ...srcArgs(p)]); c.stderr.on('data', d => e.push(d)); c.on('close', () => ok(Buffer.concat(e).toString())); c.on('error', () => ok('')) })
    const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/)
    durations.set(key, m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0)
  }
  return durations.get(key)
}

const sources = () => !LIB ? [] : fs.readdirSync(LIB).filter(f => MEDIA_EXT.has(ext(f)) && fs.existsSync(jsonOf(path.join(LIB, f)))).sort()
const source = name => sources().includes(name) ? path.join(LIB, name) : null  // whitelist: no path traversal

function send(res, body, type = 'application/json', code = 200) {
  if (!Buffer.isBuffer(body) && typeof body !== 'string') body = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}
const fail = (res, msg, code = 400) => send(res, { error: msg }, 'application/json', code)
const readBody = req => new Promise((ok, no) => { const b = []; req.on('data', d => b.push(d)); req.on('end', () => ok(Buffer.concat(b))); req.on('error', no) })

async function handle(req, res) {
  const u = new URL(req.url, 'http://x'), q = Object.fromEntries(u.searchParams)
  if (req.method === 'GET') {
    if (u.pathname === '/') return send(res, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8')
    if (u.pathname === '/api/library') {
      const tags = LIB ? readTags() : {}
      return send(res, await Promise.all(sources().map(async n => ({ name: n, video: VIDEO_EXT.has(ext(n)), tags: tags[n] || [],
        duration: await duration(path.join(LIB, n)), segments: json(jsonOf(path.join(LIB, n))) }))))
    }
    if (u.pathname === '/api/clip') {  // small preview window: wav for audio, low-res WebM for video
      const p = source(q.ep || ''); if (!p) return fail(res, 'unknown source', 404)
      const start = Math.max(0, +q.start), dur = Math.min(+q.end - start, 120)
      if (VIDEO_EXT.has(ext(p)))
        // WebM (VP8 + Opus), not MP4: Live's built-in browser (Max's jweb) lacks the H.264/AAC decoders
        return send(res, await ffmpeg(['-v', 'error', ...srcArgs(p, start, dur), '-vf', 'scale=-2:360',
          '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '900k',
          '-c:a', 'libopus', '-b:a', '128k', '-ac', '2', '-ar', '48000', '-f', 'webm', '-']), 'video/webm')
      return send(res, await ffmpeg([...decode(p, start, dur, 44100), '-f', 'wav', '-']), 'audio/wav')
    }
    if (u.pathname === '/api/exports') return send(res, !EXP() ? [] : fs.readdirSync(EXP()).filter(f => ['.wav', '.mp4'].includes(ext(f))).sort())
    if (u.pathname === '/api/settings')
      return send(res, { ...settings(), exportDir: EXP(), suggested: SUGGESTED, settingsFile: SETTINGS, providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, blurb: p.blurb })) })
    if (u.pathname === '/api/jobs') return send(res, JOBS.slice(-20))
    const prov = PROVIDERS[q.src]
    try {  // optional free-source browser
      if (prov && u.pathname === '/api/free/search') return send(res, await prov.search(q.q || '', q.kind || '', +q.page || 1))
      if (prov && u.pathname === '/api/free/files') return send(res, { page: prov.page(q.id || ''), files: await prov.files(q.id || '') })
    } catch (e) {
      return fail(res, e instanceof Oops ? e.message : `couldn't reach ${prov.name}: ${e.message}`, 502)
    }
    return fail(res, 'not found', 404)
  }

  // nothing can be added before the user has said where files go (the page asks first; this is the backstop)
  if (!LIB && ['/api/upload', '/api/add', '/api/export', '/api/tags'].includes(u.pathname))
    return fail(res, 'choose where Signal Hunter keeps your files first (Settings)', 409)
  if (u.pathname === '/api/upload') {  // dropped/browsed file: raw body, ?name=<original file name>
    const name = q.name || ''
    if (!MEDIA_EXT.has(ext(name))) return fail(res, `not an audio/video file: ${name}`)
    const dst = path.join(LIB, slug(stem(name)) + ext(name))
    await new Promise((ok, no) => req.pipe(fs.createWriteStream(dst)).on('finish', ok).on('error', no))  // stream: videos can be big
    return send(res, enqueue(name, async () => [dst]))
  }
  const d = JSON.parse((await readBody(req)).toString() || '{}')
  if (u.pathname === '/api/add') {  // pasted URL, archive.org id (+ optional filter word), or local path
    let src = (d.src || '').trim().replace(/^["']+|["']+$/g, ''), match = null  // "Copy as path" adds quotes
    if (!src) return fail(res, 'paste a URL or file path')
    if (!fs.existsSync(src) && /\s/.test(src)) [src, match] = [src.split(/\s+/)[0], src.split(/\s+/).slice(1).join(' ')]
    const label = src.replace(/[\\/]+$/, '').split(/[\\/]/).pop() + (match ? ` (${match})` : '')
    return send(res, enqueue(label, say => fetchSrc(src, match, say)))
  }
  if (u.pathname === '/api/settings') {
    try { return send(res, saveSettings(d)) } catch (e) { return fail(res, e instanceof Oops ? e.message : `can't use that folder: ${e.message}`) }
  }
  if (u.pathname === '/api/delete') {  // a source and its transcript; exports made from it stay
    const p = source(d.ep || ''); if (!p) return fail(res, 'unknown source', 404)
    for (const f of [p, jsonOf(p)]) fs.rmSync(f, { force: true })
    setTags(path.basename(p), [])
    status(); return send(res, { ok: true })
  }
  if (u.pathname === '/api/tags') {
    const p = source(d.ep || ''); if (!p) return fail(res, 'unknown source', 404)
    return send(res, { tags: setTags(path.basename(p), d.tags) })
  }
  if (u.pathname === '/api/choose-folder') return send(res, { path: await chooseFolder(d.start, d.title || 'Choose a folder') })
  if (u.pathname === '/api/open-url') {  // in Live's window, links would replace the page; open them in the browser
    if (!/^https?:\/\//i.test(d.url || '')) return fail(res, 'bad url')
    openFolder(d.url); return send(res, { ok: true })
  }
  if (u.pathname === '/api/open-folder') { openFolder(d.which === 'library' ? LIB : EXP()); return send(res, { ok: true }) }
  if (u.pathname !== '/api/export') return fail(res, 'not found', 404)
  const p = source(d.ep || ''); if (!p) return fail(res, 'unknown source', 404)
  const start = +d.start, end = +d.end
  if (!(start >= 0 && start < end && end - start <= 300)) return fail(res, 'bad range')
  const video = d.format === 'mp4' && VIDEO_EXT.has(ext(p)), x = video ? '.mp4' : '.wav', name = slug(d.name || '')
  const exp = EXP()
  let dst = path.join(exp, name + x)
  for (let n = 2; fs.existsSync(dst); n++) dst = path.join(exp, `${name}_${n}${x}`)
  const fade = Math.min(0.01, (end - start) / 4)
  const sound = !(video && d.sound === false)  // MP4s can leave the soundtrack out
  const afade = sound ? ['-af', `afade=t=in:d=${fade},afade=t=out:st=${(end - start - fade).toFixed(3)}:d=${fade}`] : ['-an']
  // video re-encodes so the cut is frame-accurate (a stream copy would snap to keyframes)
  const codec = video ? ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    ...(sound ? ['-c:a', 'aac', '-b:a', '256k'] : []), '-movflags', '+faststart']
    : ['-vn', '-c:a', 'pcm_s24le']
  await ffmpeg(['-v', 'error', ...srcArgs(p, start, end - start), ...afade, ...codec, dst])
  send(res, { file: path.basename(dst), path: dst })
}

let lastStatus = ''
function status() {  // shown on the Live device's panel; only on change, so "Sent …" stays up until then
  if (!Max) return
  const working = JOBS.find(j => j.state === 'working')
  const s = working ? `Importing ${working.label}…` : !LIB ? 'Ready · open it to choose a folder' : `Ready · ${sources().length} sources`
  if (s !== lastStatus) Max.outlet('status', lastStatus = s)
}

const port = +(process.argv[process.argv.indexOf('--port') + 1] || 0) || 8765
// the standalone launchers pass --open: show the page in the default browser once the server is up
const openPage = () => process.argv.includes('--open') && openFolder(`http://localhost:${port}`)
useData(settings().dataDir)
http.createServer((req, res) => handle(req, res).catch(e => fail(res, e.message, 500)))
  .on('error', e => {
    if (e.code !== 'EADDRINUSE') throw e
    // another Signal Hunter (a second device, or a terminal) already serves this port: the page works either way
    console.log(`port ${port} is already in use; using the server that's running`)
    Max?.outlet('status', 'Ready (shared with another Signal Hunter)')
    openPage()
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Signal Hunter: http://localhost:${port}  (data: ${DATA || 'not chosen yet'})`)
    // finish imports cut short last time (Live closed, device removed): files without a transcript yet
    for (const f of LIB ? fs.readdirSync(LIB) : []) {
      const p = path.join(LIB, f)
      if (f.endsWith('.part')) fs.rmSync(p, { force: true })
      else if (MEDIA_EXT.has(ext(f)) && !fs.existsSync(jsonOf(p))) enqueue(f, async () => [p])
    }
    status(); openPage()
  })
setInterval(status, 2000).unref()
