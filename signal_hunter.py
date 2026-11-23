"""Signal Hunter: find samples and clips by what is said.

  python signal_hunter.py add <archive.org url|id|media url|local file> [--match TEXT] [--device cuda]
  python signal_hunter.py serve [--port 8765]

Library: library/<name>.<ext> + library/<name>.json (Whisper segments).
Exports: exports/<name>.wav (24-bit, source sample rate) or exports/<name>.mp4 (video sources).
"""
import argparse, itertools, json, queue, re, shutil, subprocess, sys, threading, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent
LIB, EXP = ROOT / "library", ROOT / "exports"
VIDEO_EXT = {".mp4", ".mkv", ".webm", ".mov"}
MEDIA_EXT = {".mp3", ".wav", ".flac", ".ogg", ".m4a"} | VIDEO_EXT


class Oops(Exception):
    """A user-facing problem (bad source, too many files, ...)."""


def slug(s):
    return re.sub(r"[^\w-]+", "-", s).strip("-")[:80] or "clip"


# ---------- ingest ----------

def archive_files(ident, match):
    meta = json.load(urllib.request.urlopen(f"https://archive.org/metadata/{ident}"))
    files = [f["name"] for f in meta.get("files", []) if f["name"].lower().endswith(".mp3")]
    if match:
        files = [f for f in files if match.lower() in f.lower()]
    if len(files) > 5 and not match:
        raise Oops(f"{len(files)} mp3s in {ident}; add a word from the file names to narrow it "
                   f"(e.g. '{ident} {Path(files[0]).stem[-12:]}'). First few: " + ", ".join(files[:8]))
    if not files:
        raise Oops(f"no matching mp3s in {ident}")
    return [f"https://archive.org/download/{ident}/{urllib.parse.quote(f)}" for f in files]


def cli_say(msg, progress=None):
    if progress is None:  # skip the per-block / per-segment progress ticks in the terminal
        print(msg, flush=True)


def fetch(src, match, say=cli_say):
    if Path(src).is_file():
        if Path(src).suffix.lower() not in MEDIA_EXT:
            raise Oops(f"not an audio/video file: {src}")
        dst = LIB / (slug(Path(src).stem) + Path(src).suffix.lower())
        if not (dst.exists() and dst.samefile(src)):
            shutil.copy(src, dst)
        return [dst]
    if re.match(r"^([a-zA-Z]:[\\/]|\\\\|/|~)", src):  # looks like a local path, but isn't a file
        raise Oops(f"file not found: {src}")
    m = re.match(r"https?://archive\.org/(?:details|download)/([^/?#]+)/?(?:[?#].*)?$", src)
    if m:
        urls = archive_files(m.group(1), match)
    elif "://" in src:
        urls = [src]  # direct audio URL
    else:
        urls = archive_files(src, match)  # bare archive.org identifier
    out = []
    for u in urls:
        name = urllib.parse.unquote(u.rsplit("/", 1)[-1])
        dst = LIB / (slug(Path(name).stem) + (Path(name).suffix.lower() or ".mp3"))
        if not dst.exists():
            say(f"downloading {name}")
            part = dst.with_name(dst.name + ".part")  # a failed download never looks like a finished one
            urllib.request.urlretrieve(u, part, reporthook=lambda b, bs, total:
                                       say(f"downloading {name}", min(1.0, b * bs / total) if total > 0 else 0.0))
            part.replace(dst)
        out.append(dst)
    return out


def src_args(path, start=None, dur=None):
    a = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}"] if start is not None else []
    # some archive.org OTRR mp3s have a RIFF-looking header that makes ffmpeg probe them as WAV
    return a + (["-f", "mp3"] if path.suffix.lower() == ".mp3" else []) + ["-i", str(path)]


def decode(path, start=None, dur=None, rate=16000):
    return ["ffmpeg", "-v", "error", *src_args(path, start, dur), "-ac", "1", "-ar", str(rate)]


_models = {}


def transcribe(paths, device, say=cli_say):
    import numpy as np
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise Oops("transcription needs faster-whisper: run  pip install faster-whisper  then restart the server")
    if device not in _models:  # load once; it's slow
        say("loading the speech model (the first run downloads ~500 MB)")
        _models[device] = WhisperModel("small.en", device=device, compute_type="int8" if device == "cpu" else "int8_float16")
    model = _models[device]
    for p in paths:
        j = p.with_suffix(".json")
        if j.exists():
            continue
        say(f"reading {p.name}")
        raw = subprocess.run(decode(p) + ["-f", "f32le", "-"], capture_output=True, check=True).stdout
        dur = max(len(raw) / 4 / 16000, 1)
        say(f"transcribing {p.name} (takes a while on CPU)")
        segs, _ = model.transcribe(np.frombuffer(raw, np.float32), vad_filter=True)
        out = []
        for s in segs:  # lazy generator: report progress as it goes
            out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
            say(f"transcribing {p.name}", min(1.0, s.end / dur))
        j.write_text(json.dumps(out, indent=1))
        say(f"{p.name}: {len(out)} lines")


# ---------- background imports (from the page) ----------

JOBS, _jobq, _ids = [], queue.Queue(), itertools.count(1)
DEVICE = "cpu"


def enqueue(label, get_paths):
    job = {"id": next(_ids), "label": label, "state": "queued", "msg": "waiting for the one ahead", "progress": None}
    JOBS.append(job)
    _jobq.put((job, get_paths))
    return job


def worker():  # one at a time: transcription already uses every core
    while True:
        job, get_paths = _jobq.get()
        job["state"] = "working"
        say = lambda m, progress=None: job.update(msg=m, progress=progress)
        say("starting")
        try:
            paths = get_paths(say)
            transcribe(paths, DEVICE, say)
            lines = sum(len(json.loads(p.with_suffix(".json").read_text())) for p in paths)
            job.update(state="done", msg=f"added, {lines} lines", progress=1.0, episodes=[p.name for p in paths])
        except Exception as e:
            job.update(state="error", msg=str(e), progress=None)


# ---------- server ----------

def episodes():
    return sorted(p for p in LIB.iterdir() if p.suffix.lower() in MEDIA_EXT and p.with_suffix(".json").exists())


class H(BaseHTTPRequestHandler):
    def send(self, body, ctype="application/json", code=200):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def ep(self, name):
        p = next((e for e in episodes() if e.name == name), None)  # whitelist: no path traversal
        if not p:
            self.send({"error": "unknown episode"}, code=404)
        return p

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == "/":
            return self.send((ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        if u.path == "/api/library":
            return self.send([{"name": e.name, "video": e.suffix.lower() in VIDEO_EXT,
                               "segments": json.loads(e.with_suffix(".json").read_text())} for e in episodes()])
        if u.path == "/api/clip":  # small preview window: wav for audio, low-res mp4 for video
            p = self.ep(q.get("ep", ""))
            if p:
                start, end = max(0.0, float(q["start"])), float(q["end"])
                dur = min(end - start, 120)
                if p.suffix.lower() in VIDEO_EXT:
                    cmd = ["ffmpeg", "-v", "error", *src_args(p, start, dur), "-vf", "scale=-2:360",
                           "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-ac", "2", "-ar", "44100", "-b:a", "160k",
                           "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "-"]
                    ctype = "video/mp4"
                else:
                    cmd, ctype = decode(p, start, dur, 44100) + ["-f", "wav", "-"], "audio/wav"
                self.send(subprocess.run(cmd, capture_output=True, check=True).stdout, ctype)
            return
        if u.path == "/api/exports":
            return self.send(sorted(p.name for p in EXP.iterdir() if p.suffix in (".wav", ".mp4")))
        if u.path == "/api/jobs":
            return self.send(JOBS[-20:])
        self.send({"error": "not found"}, code=404)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/upload":  # dropped/browsed file: raw body, ?name=<original file name>
            name = dict(urllib.parse.parse_qsl(u.query)).get("name", "")
            ext = Path(name).suffix.lower()
            if ext not in MEDIA_EXT:
                return self.send({"error": f"not an audio/video file: {name}"}, code=400)
            dst = LIB / (slug(Path(name).stem) + ext)
            left = int(self.headers["Content-Length"])
            with open(dst, "wb") as f:  # stream: videos can be big
                while left:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    f.write(chunk); left -= len(chunk)
            return self.send(enqueue(name, lambda say: [dst]))
        d = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if u.path == "/api/add":  # pasted URL, archive.org id (+ optional filter word), or local path
            src, match = d.get("src", "").strip().strip("\"'"), None  # "Copy as path" adds quotes
            if not src:
                return self.send({"error": "paste a URL or file path"}, code=400)
            if not Path(src).is_file() and len(src.split(None, 1)) == 2:
                src, match = src.split(None, 1)
            label = src.rstrip("/").rsplit("/", 1)[-1].rsplit("\\", 1)[-1] + (f" ({match})" if match else "")
            return self.send(enqueue(label, lambda say: fetch(src, match, say)))
        if u.path != "/api/export":
            return self.send({"error": "not found"}, code=404)
        p = self.ep(d.get("ep", ""))
        if not p:
            return
        start, end = float(d["start"]), float(d["end"])
        if not 0 <= start < end or end - start > 300:
            return self.send({"error": "bad range"}, code=400)
        video = d.get("format") == "mp4" and p.suffix.lower() in VIDEO_EXT
        ext, name = (".mp4" if video else ".wav"), slug(d.get("name", ""))
        dst, n = EXP / f"{name}{ext}", 2
        while dst.exists():
            dst = EXP / f"{name}_{n}{ext}"; n += 1
        fade = min(0.01, (end - start) / 4)
        afade = ["-af", f"afade=t=in:d={fade},afade=t=out:st={end - start - fade:.3f}:d={fade}"]
        # video re-encodes so the cut is frame-accurate (a stream copy would snap to keyframes)
        codec = (["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
                  "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart"] if video
                 else ["-vn", "-c:a", "pcm_s24le"])
        subprocess.run(["ffmpeg", "-v", "error", *src_args(p, start, end - start), *afade, *codec, str(dst)],
                       capture_output=True, check=True)
        self.send({"file": dst.name, "path": str(dst.resolve())})

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except subprocess.CalledProcessError as e:  # surface ffmpeg errors instead of a dropped connection
            self.send({"error": e.stderr.decode(errors="replace")[-500:] if e.stderr else str(e)}, code=500)

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add"); a.add_argument("src"); a.add_argument("--match"); a.add_argument("--device", default="cpu")
    s = sub.add_parser("serve"); s.add_argument("--port", type=int, default=8765); s.add_argument("--device", default="cpu")
    args = ap.parse_args()
    LIB.mkdir(exist_ok=True); EXP.mkdir(exist_ok=True)
    if args.cmd == "add":
        try:
            transcribe(fetch(args.src, args.match), args.device)
        except Oops as e:
            sys.exit(str(e))
    else:
        global DEVICE
        DEVICE = args.device
        threading.Thread(target=worker, daemon=True).start()
        print(f"http://localhost:{args.port}", flush=True)
        ThreadingHTTPServer(("127.0.0.1", args.port), H).serve_forever()


if __name__ == "__main__":
    main()
