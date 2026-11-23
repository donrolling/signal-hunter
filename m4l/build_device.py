"""Builds 'Signal Hunter.amxd', a Max for Live audio effect.

The device passes audio through untouched. Its "open" button pops up a window with the
Signal Hunter page (jweb -> http://localhost:8765/?live=1). The page's "Send to Live"
exports a WAV and sends its path out of jweb; the patch then calls
ClipSlot.create_audio_clip(path) on Live's highlighted clip slot (Live 12+).

Run: python m4l/build_device.py   (rewrites m4l/Signal Hunter.amxd)
"""
import json, struct
from pathlib import Path

URL = "http://localhost:8765/?live=1"


def box(id, maxclass, rect, ins, outs, text=None, pres=None, **kw):
    b = {"id": id, "maxclass": maxclass, "numinlets": ins, "numoutlets": outs,
         "outlettype": [""] * outs, "patching_rect": rect, **kw}
    if text is not None:
        b["text"] = text
    if pres:
        b.update(presentation=1, presentation_rect=pres)
    return {"box": b}


def line(src, so, dst, di):
    return {"patchline": {"source": [src, so], "destination": [dst, di]}}


def patcher(rect, boxes, lines, **kw):
    return {"fileversion": 1, "appversion": {"major": 8, "minor": 6, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box", "rect": rect, "bglocked": 0, "default_fontsize": 10.0,
            "default_fontname": "Arial Bold", "gridsize": [8, 8], "boxes": boxes, "lines": lines, **kw}


# floating window: the whole Signal Hunter page
window = patcher([80, 80, 1280, 840], [
    box("w-in", "inlet", [10, 10, 30, 30], 0, 1),  # pcontrol "open" targets this patcher
    box("w-reload", "inlet", [60, 10, 30, 30], 0, 1),  # "reload" -> jweb (e.g. after starting the server)
    box("w-web", "jweb", [0, 0, 1200, 760], 1, 3, url=URL, pres=[0, 0, 1200, 760]),
    box("w-out", "outlet", [10, 780, 30, 30], 1, 0),
], [line("w-web", 0, "w-out", 0), line("w-reload", 0, "w-web", 0)], openinpresentation=1, toolbarvisible=0, statusbarvisible=0)

boxes = [
    # audio pass-through so the device can sit on any audio track
    box("plugin", "newobj", [20, 20, 60, 22], 2, 2, "plugin~", outlettype=["signal", "signal"]),
    box("plugout", "newobj", [20, 60, 60, 22], 2, 0, "plugout~"),

    # panel
    box("title", "comment", [300, 20, 150, 20], 1, 0, "SIGNAL HUNTER", pres=[8, 6, 200, 18], fontsize=12.0),
    box("open", "message", [300, 60, 50, 22], 2, 1, "open", pres=[8, 30, 50, 22]),
    box("hint", "comment", [360, 60, 220, 20], 1, 0, "<- open the search window",
        pres=[64, 32, 200, 18]),
    box("help", "comment", [300, 300, 260, 34], 1, 0,
        "Needs the server: python signal_hunter.py serve. Select an empty audio clip slot, then Send to Live.",
        pres=[8, 60, 300, 44], linecount=3),
    box("status", "comment", [300, 360, 260, 20], 1, 0, "", pres=[8, 108, 300, 40], linecount=2),

    # open the window
    box("pcontrol", "newobj", [300, 100, 60, 22], 1, 1, "pcontrol"),
    box("reload", "message", [420, 100, 50, 22], 2, 1, "reload", pres=[8, 150, 50, 16]),
    box("win", "newobj", [300, 140, 110, 22], 2, 1, "p signal_hunter_window", patcher=window),

    # "send <path>" from the page -> create_audio_clip on the highlighted clip slot
    box("route", "newobj", [300, 180, 80, 22], 2, 2, "route send"),
    box("trig", "newobj", [300, 220, 50, 22], 1, 2, "t a b"),
    box("goto", "message", [420, 260, 230, 22], 2, 1, "goto live_set view highlighted_clip_slot"),
    box("path", "newobj", [420, 300, 70, 22], 1, 3, "live.path"),
    box("prepend", "newobj", [300, 300, 170, 22], 1, 1, "prepend call create_audio_clip"),
    box("obj", "newobj", [300, 340, 80, 22], 2, 1, "live.object"),
    box("strip", "newobj", [520, 340, 60, 22], 1, 2, "strippath"),
    box("setstat", "newobj", [520, 380, 110, 22], 1, 1, "prepend set Sent:"),
]
lines = [
    line("plugin", 0, "plugout", 0), line("plugin", 1, "plugout", 1),
    line("open", 0, "pcontrol", 0), line("pcontrol", 0, "win", 0), line("reload", 0, "win", 1),
    line("win", 0, "route", 0), line("route", 0, "trig", 0),
    line("trig", 1, "goto", 0), line("goto", 0, "path", 0), line("path", 0, "obj", 1),  # right-to-left: id first
    line("trig", 0, "prepend", 0), line("prepend", 0, "obj", 0),
    line("trig", 0, "strip", 0), line("strip", 0, "setstat", 0), line("setstat", 0, "status", 0),
]
device = {"patcher": patcher([100, 100, 760, 520], boxes, lines, openinpresentation=1,
                             devicewidth=320.0, description="Search old radio and video by what's said; send clips to Live.")}

body = json.dumps(device).encode()
amxd = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + b"\0\0\0\0" + \
       b"ptch" + struct.pack("<I", len(body)) + body
out = Path(__file__).with_name("Signal Hunter.amxd")
out.write_bytes(amxd)
print("wrote", out, len(amxd), "bytes")
