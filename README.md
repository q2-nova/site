# Q2 Nova site

This is the website for Q2 Nova, the music and audiobook player for the
Shanling Q2. Try its wheel and menus in your browser, take a guided tour,
or read about installing it on the device. [Visit the site](https://q2-nova.github.io/site/) · [Try the demo](https://q2-nova.github.io/site/demo.html)

Edit this repository to change the site, tour or embedded demo. The player
itself lives in a separate repository. [Q2 Nova player](https://github.com/q2-nova/q2-player)

## Run locally

Open `dist/index.html` directly, or run this command from the repository root and visit `http://localhost:8000/`.

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

The three pages and their stylesheets live in `dist/`. That directory can also be opened in a visual HTML editor or deployed to a static host. The bundled simulator, screenshots and audio previews work offline.

## Check site links

CI checks every HTML page in `dist/` on pull requests, pushes to `main`, and before Pages publication. It checks linked files and fragment targets in the checkout and follows external links as a signed-out visitor. To reproduce the check with lychee 0.24.2, run:

```sh
lychee --no-progress --include-fragments --include-verbatim --max-retries 2 'dist/**/*.html'
```

## GitHub Pages

The project site URL is `https://q2-nova.github.io/site/`. The deployment workflow packages the contents of `dist/`, including the bundled player.

After the first push to `main`, choose **GitHub Actions** under **Settings → Pages → Build and deployment → Source**. To publish a release, open **Actions → Publish site to GitHub Pages → Run workflow** and select `main`.

## Edit the player

The Features player opens at the main menu. In the Demo, page scroll drives the wheel and button presses between chapters. Visitors can take control of the device, then choose **Resume tour** to return to their place. Playback starts muted. The speaker beside the lower-right edge of the chassis controls sound on both pages.

Edit the embedded player wrapper in `simulator/embed.template.html`, the chassis styling in `dist/studio/embed.css`, and the outside controls in `dist/studio/audio-control.css`. The simulator guide covers rebuilding the embed, regenerating its navigation map, and testing the site. [Simulator guide](simulator/README.md)

The gallery shows the firmware itself. The device photographs are credited to Shanling on the site. A public reuse license for those photographs has not been established. Music and font attribution accompany the bundled assets. [Audio credits](dist/studio/Audio-samples-CREDITS.txt) · [Font license](dist/studio/OpenSans-LICENSE.txt)

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers changing and checking the site.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Participation follows the [code of conduct](CODE_OF_CONDUCT.md).
