"""Builds the downloadable device: dist/Signal-Hunter-windows.zip and dist/Signal-Hunter-mac.zip.

Each zip holds one 'Signal Hunter' folder: the .amxd, server.js, index.html, logo.js, node_modules
(trimmed to that platform) and bin/ffmpeg-<platform>-<arch>. Users unzip it anywhere (the User Library
is handiest) and drag the .amxd onto a track. Node for Max runs the server; nothing else to install.
Each zip also carries Node (bin/node-<platform>-<arch>) and a 'Start Signal Hunter' launcher, so the same
folder runs in a browser without Live.

Run after `npm install` and `python m4l/build_device.py`:  python m4l/package.py
"""
import gzip, io, shutil, tarfile, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
DIST, CACHE = ROOT / "dist", ROOT / "dist" / ".cache"
FILES = ["Signal Hunter.amxd", "server.js", "index.html", "logo.js", "window.js", "pick_folder.ps1", "package.json", "LICENSE"]
SKIP = {"ffmpeg-static", "onnxruntime-web", "@img", "sharp", "@derhuerst"}  # not used at runtime (or shipped in bin/)
FFMPEG = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-{}-{}.gz"
NODE = "v22.18.0"  # the Node that Live 12 ships with
LAUNCHERS = {"windows": "Start Signal Hunter.cmd", "mac": "Start Signal Hunter.command"}
TARGETS = {"windows": [("win32", "x64")], "mac": [("darwin", "arm64"), ("darwin", "x64")]}
# transformers.js imports sharp for images at load time; we only do audio, so a stub keeps it happy
SHARP_STUB = "module.exports = () => { throw new Error('image support is not included in Signal Hunter') }\n"


def ffmpeg(plat, arch):
    out = CACHE / f"ffmpeg-{plat}-{arch}{'.exe' if plat == 'win32' else ''}"
    if not out.exists():
        print("downloading ffmpeg", plat, arch)
        CACHE.mkdir(parents=True, exist_ok=True)
        out.write_bytes(gzip.decompress(urllib.request.urlopen(FFMPEG.format(plat, arch)).read()))
    return out


def node(plat, arch):
    out = CACHE / f"node-{plat}-{arch}{'.exe' if plat == 'win32' else ''}"
    if not out.exists():
        print("downloading node", plat, arch)
        CACHE.mkdir(parents=True, exist_ok=True)
        base = f"https://nodejs.org/dist/{NODE}/node-{NODE}-{'win' if plat == 'win32' else plat}-{arch}"
        if plat == "win32":
            with zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(base + ".zip").read())) as z:
                out.write_bytes(z.read(f"node-{NODE}-win-{arch}/node.exe"))
        else:
            with tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen(base + ".tar.gz").read())) as t:
                out.write_bytes(t.extractfile(f"node-{NODE}-{plat}-{arch}/bin/node").read())
    return out


def build(name, targets):
    folder = DIST / name / "Signal Hunter"
    shutil.rmtree(DIST / name, ignore_errors=True)
    folder.mkdir(parents=True)
    for f in FILES:
        shutil.copy2(ROOT / f, folder / f)
    nm = folder / "node_modules"
    for m in (ROOT / "node_modules").iterdir():
        if m.name not in SKIP and not m.name.startswith("."):
            # no source maps, browser-only wasm, or a model cache left by a dev run (the model downloads on first use)
            shutil.copytree(m, nm / m.name, ignore=shutil.ignore_patterns("*.map", "ort-wasm*", ".cache"))
    (nm / "sharp").mkdir()
    (nm / "sharp" / "index.js").write_text(SHARP_STUB)
    (nm / "sharp" / "package.json").write_text('{"name": "sharp", "version": "0.0.0-stub", "main": "index.js"}\n')
    keep = {f"{p}/{a}" for p, a in targets}
    for d in (nm / "onnxruntime-node" / "bin" / "napi-v3").glob("*/*"):
        if f"{d.parent.name}/{d.name}" not in keep:
            shutil.rmtree(d)
    (folder / "bin").mkdir()
    for p, a in targets:
        for exe in (ffmpeg(p, a), node(p, a)):
            shutil.copy2(exe, folder / "bin" / exe.name)
    launcher = (ROOT / "launch" / LAUNCHERS[name]).read_text()
    nl = "\r\n" if name == "windows" else "\n"  # a .command with CRLF endings won't run
    (folder / LAUNCHERS[name]).write_bytes(nl.join(launcher.splitlines()).encode() + nl.encode())
    z = DIST / f"Signal-Hunter-{name}.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(folder.rglob("*")):
            if f.is_file():
                info = zipfile.ZipInfo.from_file(f, f.relative_to(folder.parent).as_posix())
                info.compress_type = zipfile.ZIP_DEFLATED
                if f.parent.name == "bin" or f.suffix == ".command":  # executable bit survives unzipping on a Mac
                    info.external_attr = 0o100755 << 16
                zf.writestr(info, f.read_bytes())
    print(f"wrote {z} ({z.stat().st_size >> 20} MB)")
    return folder


if __name__ == "__main__":
    for name, targets in TARGETS.items():
        build(name, targets)
