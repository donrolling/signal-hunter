"""Builds 'Signal Hunter.amxd', a Max for Live audio effect, next to server.js.

The device passes audio through untouched and starts the Signal Hunter server itself
(node.script server.js: Node for Max ships with Live Suite, so nothing else to install).
"Open Signal Hunter" pops up a window with the page (jweb -> http://localhost:8765/?live=1).
The page's "Send to Live" exports a WAV and sends "locate" then "clip <path>" out of jweb;
the patch then calls ClipSlot.create_audio_clip(path) on Live's highlighted clip slot (Live 12+).

The .amxd must sit next to server.js, index.html, logo.js and node_modules (Max finds them there).
Run: python m4l/build_device.py
"""
import json, struct
from pathlib import Path

URL = "http://localhost:8765/?live=1"
BG = [0.059, 0.067, 0.082, 1.0]       # the page's --bg
RAISE = [0.13, 0.145, 0.176, 1.0]
ACCENT = [0.941, 0.706, 0.298, 1.0]
TEXT = [0.914, 0.902, 0.875, 1.0]
DIM = [0.522, 0.549, 0.6, 1.0]
INK = [0.1, 0.075, 0.024, 1.0]         # text on amber


def box(id, maxclass, rect, ins, outs, text=None, pres=None, **kw):
    b = {"id": id, "maxclass": maxclass, "numinlets": ins, "numoutlets": outs,
         "outlettype": [""] * outs, "patching_rect": rect, **kw}
    if text is not None:
        b["text"] = text
    if pres:
        b.update(presentation=1, presentation_rect=pres)
    return {"box": b}


def label(id, text, pres, color, size=9.5, bold=0, rect=None):
    return box(id, "comment", rect or [600, pres[1] * 3, 200, 20], 1, 0, text, pres=pres,
               textcolor=color, fontsize=size, fontface=bold, fontname="Arial")


def button(id, text, pres, rect, bg, fg, size=10.0, bold=1):
    return box(id, "textbutton", rect, 1, 3, pres=pres, text=text, bgcolor=bg, bgovercolor=bg, bordercolor=bg,
               textcolor=fg, textovercolor=fg, fontsize=size, fontface=bold, fontname="Arial", rounded=6.0)


def line(src, so, dst, di):
    return {"patchline": {"source": [src, so], "destination": [dst, di]}}


def patcher(rect, boxes, lines, **kw):
    return {"fileversion": 1, "appversion": {"major": 8, "minor": 6, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box", "rect": rect, "bglocked": 0, "default_fontsize": 10.0,
            "default_fontname": "Arial Bold", "gridsize": [8, 8], "boxes": boxes, "lines": lines, **kw}


# floating window: the whole Signal Hunter page. Max rects are [x, y, width, height]: match the jweb exactly.
window = patcher([80, 80, 1200, 760], [
    box("w-in", "inlet", [10, 10, 30, 30], 0, 1),  # pcontrol "open" targets this patcher
    box("w-reload", "inlet", [60, 10, 30, 30], 0, 1),  # "reload" -> jweb (e.g. after the server restarts)
    box("w-web", "jweb", [0, 0, 1200, 760], 1, 3, url=URL, pres=[0, 0, 1200, 760]),
    box("w-out", "outlet", [10, 780, 30, 30], 1, 0),
    # window title: "Signal Hunter" instead of "[signal_hunter_window]"
    box("w-lb", "newobj", [110, 10, 60, 22], 1, 1, "loadbang"),
    box("w-defer", "newobj", [110, 40, 60, 22], 1, 1, "deferlow"),
    box("w-title", "message", [110, 70, 120, 22], 2, 1, 'title "Signal Hunter"'),
    box("w-this", "newobj", [110, 100, 80, 22], 1, 1, "thispatcher"),
], [line("w-web", 0, "w-out", 0), line("w-reload", 0, "w-web", 0),
    line("w-lb", 0, "w-defer", 0), line("w-defer", 0, "w-title", 0), line("w-title", 0, "w-this", 0)],
    openinpresentation=1, toolbarvisible=0, statusbarvisible=0, bgcolor=BG, editing_bgcolor=BG)

boxes = [
    # backdrop: background=1 puts it on Max's background layer, under everything else
    box("bg", "panel", [560, 10, 40, 40], 1, 0, pres=[0, 0, 300, 169], bgcolor=BG, border=0, rounded=0,
        ignoreclick=1, background=1),
    box("logo", "jsui", [560, 60, 34, 34], 1, 1, pres=[12, 12, 34, 34], filename="logo.js", border=0, ignoreclick=1),
    label("t1", "SIGNAL", [52, 12, 60, 20], TEXT, 14.0, 1),
    label("t2", "HUNTER", [108, 12, 70, 20], ACCENT, 14.0, 1),
    label("tag", "Find samples by what's said", [52, 30, 200, 18], DIM),
    button("open", "Open Signal Hunter", [12, 58, 276, 30], [300, 60, 120, 22], ACCENT, INK, 12.0),
    label("hint", "Pick an empty clip slot, then Send to Live (S) in the window.", [12, 94, 280, 18], DIM),
    button("reload", "Reload", [12, 138, 64, 20], [460, 100, 60, 22], RAISE, TEXT, 9.5, 0),
    label("status", "Starting…", [84, 139, 210, 18], DIM, rect=[300, 420, 260, 20]),

    # audio pass-through so the device can sit on any audio track
    box("plugin", "newobj", [20, 20, 60, 22], 2, 2, "plugin~", outlettype=["signal", "signal"]),
    box("plugout", "newobj", [20, 60, 60, 22], 2, 0, "plugout~"),

    # the server: Node for Max runs server.js from this folder; it reports "status <text>"
    box("node", "newobj", [20, 120, 230, 22], 1, 2, "node.script server.js @autostart 1 @watch 0"),
    box("nroute", "newobj", [20, 160, 80, 22], 2, 2, "route status"),

    # open / reload the window (textbuttons -> bang -> message)
    box("open-b", "newobj", [300, 90, 30, 22], 1, 1, "t b"),
    box("open-m", "message", [300, 120, 40, 22], 2, 1, "open"),
    box("pcontrol", "newobj", [300, 150, 60, 22], 1, 1, "pcontrol"),
    box("reload-b", "newobj", [460, 130, 30, 22], 1, 1, "t b"),
    box("reload-m", "message", [460, 160, 50, 22], 2, 1, "reload"),
    box("win", "newobj", [300, 190, 110, 22], 2, 1, "p signal_hunter_window", patcher=window),

    # page sends "locate" then "clip <path>": find the highlighted clip slot, then create_audio_clip there
    box("route", "newobj", [300, 230, 110, 22], 3, 3, "route locate clip"),
    box("goto", "message", [420, 270, 230, 22], 2, 1, "goto live_set view highlighted_clip_slot"),
    box("path", "newobj", [420, 310, 70, 22], 1, 3, "live.path"),
    box("prepend", "newobj", [300, 310, 170, 22], 1, 1, "prepend call create_audio_clip"),
    box("obj", "newobj", [300, 350, 80, 22], 2, 1, "live.object"),
    box("strip", "newobj", [520, 350, 60, 22], 1, 2, "strippath"),
    box("sent", "newobj", [520, 380, 110, 22], 1, 1, "prepend Sent"),
    box("setstat", "newobj", [300, 390, 80, 22], 1, 1, "prepend set"),
]
lines = [
    line("plugin", 0, "plugout", 0), line("plugin", 1, "plugout", 1),
    line("node", 0, "nroute", 0), line("nroute", 0, "setstat", 0), line("setstat", 0, "status", 0),
    line("open", 0, "open-b", 0), line("open-b", 0, "open-m", 0), line("open-m", 0, "pcontrol", 0),
    line("pcontrol", 0, "win", 0),
    line("reload", 0, "reload-b", 0), line("reload-b", 0, "reload-m", 0), line("reload-m", 0, "win", 1),
    line("win", 0, "route", 0),
    line("route", 0, "goto", 0), line("goto", 0, "path", 0), line("path", 0, "obj", 1),
    line("route", 1, "prepend", 0), line("prepend", 0, "obj", 0),
    line("route", 1, "strip", 0), line("strip", 0, "sent", 0), line("sent", 0, "setstat", 0),
]
device = {"patcher": patcher([100, 100, 760, 520], boxes, lines, openinpresentation=1, devicewidth=300.0,
                             description="Search audio and video by what's said; send clips to Live.")}

body = json.dumps(device, ensure_ascii=False).encode()
amxd = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + b"\0\0\0\0" + \
       b"ptch" + struct.pack("<I", len(body)) + body
out = Path(__file__).parent.parent / "Signal Hunter.amxd"
out.write_bytes(amxd)
print("wrote", out, len(amxd), "bytes")
