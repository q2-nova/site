# Q2 Nova site

The Q2 Nova website introduces the firmware for the Shanling Q2. Features opens with an interactive player, Demo takes visitors through six chapters using the actual WebAssembly simulator, and Install covers firmware installation and first setup on the device.

## Run locally

Open `dist/index.html` directly, or run this command from the repository root and visit `http://localhost:8000/`.

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

The three pages and their stylesheets live in `dist/`. That directory can also be opened in a visual HTML editor or deployed to a static host. The bundled simulator, screenshots and audio previews work offline.

## Edit the player

The Features player opens at the main menu. In the Demo, page scroll drives the wheel and button presses between chapters. Visitors can take control of the device, then choose **Resume tour** to return to their place. Playback starts muted. The speaker beside the lower-right edge of the chassis controls sound on both pages.

Edit the embedded player wrapper in `simulator/embed.template.html`, the chassis styling in `dist/studio/embed.css`, and the outside controls in `dist/studio/audio-control.css`. The simulator guide covers rebuilding the embed, regenerating its navigation map, and testing the site. [Simulator guide](simulator/README.md)

The gallery shows the firmware itself. The device photographs are credited to Shanling on the site. A public reuse license for those photographs has not been established. Music and font attribution accompany the bundled assets. [Audio credits](dist/studio/Audio-samples-CREDITS.txt) · [Font license](dist/studio/OpenSans-LICENSE.txt)
