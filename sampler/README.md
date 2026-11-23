# Sample Scrubber

Find vocal samples in old radio shows by searching what's said, then scrub and export WAVs for Ableton.

Needs Python 3 and ffmpeg on PATH. Transcription also needs `pip install faster-whisper`.

```powershell
# add episodes (archive.org URL or identifier, direct audio URL, or local file); transcribes on CPU
python sampler.py add https://archive.org/details/OTRR_X_Minus_One_Singles --match MarsIsHeaven
python sampler.py add C:\path\to\episode.mp3

# open the scrubber at http://localhost:8765
python sampler.py serve
```

- Search box filters every transcript line; click a line to load ~20 s around it.
- Drag on the waveform to select, `space` plays the selection, `L` loops it, `E` exports.
- `◀ 10s` / `10s ▶` slide the window; zoom for precise edges.
- Exports land in `exports/` as 24-bit WAV at the source sample rate.

Transcription: ~real-time-ish on CPU with `small.en`. `--device cuda` needs NVIDIA's cuBLAS/cuDNN 12 DLLs.
