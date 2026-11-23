# Signal Hunter

Find vocal samples by what's said. Pull audio or video from archive.org, URLs or local files, transcribe it with Whisper, then search, scrub and export WAVs for your DAW.

## Setup

Needs Python 3 and [ffmpeg](https://ffmpeg.org/) on PATH. Transcription also needs:

```powershell
pip install faster-whisper
```

## Usage

```powershell
# add audio: archive.org URL or identifier, direct audio URL, or a local audio/video file
python signal_hunter.py add https://archive.org/details/OTRR_X_Minus_One_Singles --match MarsIsHeaven
python signal_hunter.py add C:\path\to\episode.mp3

# open Signal Hunter at http://localhost:8765
python signal_hunter.py serve
```

- Large archive.org items list their files and ask you to narrow them with `--match`.
- The search box filters every transcript line; click a line to load ~20 s around it.
- Drag on the waveform to select. `space` plays the selection, `L` loops it, `E` exports.
- `◀ 10s` / `10s ▶` slide the window; zoom in for precise edges.
- Exports land in `exports/` as 24-bit WAV at the source sample rate.

## Notes

- Search works on speech; music-only audio has nothing to search.
- Uses Whisper's English `small.en` model; swap to `small` in `signal_hunter.py` for other languages.
- Transcribes on CPU by default. `--device cuda` needs NVIDIA's cuBLAS/cuDNN 12 DLLs.
- Your audio, transcripts and exports stay local (`library/` and `exports/` are git-ignored).
