# UTM 4.3 promotional demo candidate

This folder is an isolated, reproducible 1920×1080 product-video build. It uses
the final canonical UTM screenshots and the authored UTM MCP workflow vector. It
does not fabricate application behavior or imply Epic Games endorsement.

## Render

Run from PowerShell:

```powershell
Set-Location '<workspace>\marketing\utm-4.3-demo'
.\render.ps1
```

Requirements: Windows, FFmpeg/FFprobe on `PATH`, Segoe UI system fonts, and
Microsoft Edge only when the pinned SVG rasterizations need to be regenerated.
No package installation or repository dependency is required.

## Outputs

- `utm-4.3-demo.mp4` — final H.264/AAC launch candidate
- `utm-4.3-demo-poster.png` — poster frame
- `frames/review-*.png` — representative visual-QA frames
- `ffprobe.json` — machine-readable media probe
- `assets.sha256` — hashes of every pinned input asset
- `timeline.json` — scene intent, timing, source paths, and public claims

The quiet ambient bed is synthesized during rendering from pure tones. It uses
no third-party recording. The edit remains readable when muted.

## Source integrity

`assets/` is a pinned copy of the canonical product inputs used by this exact
render. Refresh those copies only after the canonical UTM screenshot set changes,
then rerun the render and inspect all review frames before publication.

