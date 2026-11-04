# SocketDesigner

Web app for designing transtibial prosthetic sockets (orthopaedic CAD/CAM): from the residual-limb scan to a printable STL that fits an Ottobock 4R54 socket adapter.

> **Alpha version.** Shared for feedback from prosthetists. It is not a certified medical device: always check the geometry before fitting.

```bash
npm install
npm run dev         # http://localhost:5173
npm run build       # static build in dist/
npm run test:geom   # geometry pipeline test (needs a local sample, see below)
npm run check:i18n  # checks that every UI string has a French translation
```

Requires Node ≥ 18.

## Workflow

1. **Import**: load an STL, PLY or OBJ scan (drag and drop).
   - The shape is straightened automatically: long axis vertical, distal end down.
   - Rotate it so the front faces the blue arrow.
   - Place the cut plane (height and tilts), then click "Generate working shape".
   - Radial smoothing is then adjusted live.
2. **Rectification**
   - Cross-sections each get a reduction as a % of their circumference. The reduction is interpolated monotonically between sections.
   - Relief zones are painted with a brush. The reduction is cancelled there (0–100 %), with optional added material.
   - The panel shows a displacement map, the circumference of each section before/after, and the volume change.
3. **Trim line**
   - The proximal trim line is drawn with Bézier curves.
   - Click to add points, then drag points and handles. Each point is Auto, Smooth or Corner.
   - Set the wall thickness and preview the shell.
4. **Alignment**
   - Add a parametric foot (length and heel height).
   - Draw two vertical reference axes from points chosen on the foot: one in the side view, one in the front view.
   - Define the condyle axis in 2 clicks.
   - Set flexion, abduction, rotation and shifts.
   - A horizontal 4R54 plate is centred on the pylon, with mounting holes made by watertight booleans (manifold-3d).
   - The STL is exported Z-up with the plate on z = 0.

Projects can be saved and reopened as `.json` (without the raw scan).

The interface is in English by default. French is available from the language selector in the top bar.

## Geometry

The shape is resampled into a **radial grid** around the limb axis (`src/geom/surface.js`). The grid has a distal dome (rays from a centre point) and a cylindrical part (horizontal rays). This keeps smoothing, reduction, trim line, wall offset and the blend to the distal plate simple and robust.

The socket is built as a closed "tube" of rings, so it is watertight by construction. Only the mounting holes use booleans.

## Sample data

Scans are never committed (`*.stl`, `*.ply` and `*.obj` are git-ignored), as they may contain patient data. To use the "Load sample positive" button and `npm run test:geom` locally, put a positive scan at `public/samples/sample-positive.stl`.

## To check

The default 4R54 dimensions were measured on a reference socket. Confirm them against the Ottobock instructions for use before printing:

- 4 holes Ø 6.5 mm on a 36 mm square
- square nut pockets 10.2 × 6.5 mm
- plate Ø 68 mm
