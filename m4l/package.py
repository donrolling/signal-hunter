"""Builds the downloadable device: dist/Signal-Hunter-windows.zip and dist/Signal-Hunter-mac.zip.

Each zip holds one 'Signal Hunter' folder: the .amxd, server.js, index.html, logo.js, node_modules
(trimmed to that platform) and bin/ffmpeg-<platform>-<arch>. Users unzip it anywhere (the User Library
is handiest) and drag the .amxd onto a track. Node for Max runs the server; nothing else to install.

Run after `npm install` and `python m4l/build_device.py`:  python m4l/package.py
"""
import gzip, shutil, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
DIST, CACHE = ROOT / "dist", ROOT / "dist" / ".cache"
FILES = ["Signal Hunter.amxd", "server.js", "index.html", "logo.js", "window.js", "pick_folder.ps1", "package.json", "LICENSE"]
SKIP = {"ffmpeg-static", "onnxruntime-web", "@img", "sharp", "@derhuerst"}  # not used at runtime (or shipped in bin/)
FFMPEG = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-{}-{}.gz"
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
        shutil.copy2(ffmpeg(p, a), folder / "bin" / ffmpeg(p, a).name)
    z = DIST / f"Signal-Hunter-{name}.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(folder.rglob("*")):
            if f.is_file():
                info = zipfile.ZipInfo.from_file(f, f.relative_to(folder.parent).as_posix())
                info.compress_type = zipfile.ZIP_DEFLATED
                if f.parent.name == "bin":  # executable bit survives unzipping on a Mac
                    info.external_attr = 0o100755 << 16
                zf.writestr(info, f.read_bytes())
    print(f"wrote {z} ({z.stat().st_size >> 20} MB)")
    return folder


if __name__ == "__main__":
    for name, targets in TARGETS.items():
        build(name, targets)
