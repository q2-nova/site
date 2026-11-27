# Showcase simulator

## Refresh the embedded player

In the player source checkout, use its pinned Rust toolchain with the `wasm32-unknown-unknown` target installed. Remap local source paths so compiler diagnostics embedded in the distributed binary do not include account or checkout names.

```sh
RUSTFLAGS="--remap-path-prefix=$HOME=/build/nova --remap-path-prefix=$PWD=/src/player" \
  cargo build --release --locked --target wasm32-unknown-unknown --manifest-path crates/wasm-demo/Cargo.toml --target-dir build/wasm-target -j 2
python3 web-demo/package.py build/wasm-target/wasm32-unknown-unknown/release/q2_wasm_demo.wasm --out build/web-demo --without-hosted-music
```

From the site repository root, run the importer with the player checkout as its argument. Use `--package DIRECTORY` if the packaged player is in another location.

```sh
python3 simulator/import.py /path/to/player
```

The importer verifies the packaged files against the offline edition, imports its audio previews and regenerates the wrapper and screen map. It checks the map against the exact WASM binary. Review the diff before committing the generated files.

## How the scroll tour works

The mapper starts at the Q2 main menu, sends real inputs, reads the screen and selected row, and rehearses the chapters in their HTML order. It records alternative destinations because the same row can have different Back paths. The browser checks arrivals during the tour, including the track or book selected. The mapper also locates the ten graphic EQ touch targets on the rendered screen.

The opening wheel gesture sweeps to *Cylinders*, pauses, then presses Center to open the album. From Now Playing, a Center hold opens the shortcuts to the equalizer. Scrolling moves the bands from flat to an example curve before the tour continues to downloads, books and radio. The extra 20% scroll distance is divided among the chapter keyframes. Wheel turns and button presses follow page scroll, while song playback keeps its own clock.

To inspect a path in a packaged build, run the mapper directly.

```sh
node simulator/map-screens.mjs /path/to/package/player.wasm /path/to/package/demo.js --path "Graphic EQ"
```

## Browser checks

Serve the site as described in the root README. With Playwright available to Node.js and its browsers installed, run these commands from the site root. Include the trailing slash in the URL.

```sh
node simulator/check-routes.cjs http://localhost:8000/
node simulator/check-tour.cjs http://localhost:8000/ firefox
node simulator/check-sound.cjs http://localhost:8000/ chromium
```

The route check exercises every ordered pair of chapters. The tour check covers scroll transitions, manual control, Resume tour and retry. The sound check measures browser audio output, playback progress and speaker placement.
