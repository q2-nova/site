#!/usr/bin/env python3
"""Import a packaged web-demo build into the showcase, including file:// support."""

import argparse
import base64
import hashlib
import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "dist" / "studio"
SCRIPTS = ("audio.js", "streams.js", "timezone.js", "demo.js")
AUDIO_KEYS = (
    "tidal", "northline", "afterhours", "sundial", "softsignal",
    "fieldnotes", "copper", "pinksky", "radio", *(f"spoken-{i}" for i in range(6)),
)


def replace_one(source, marker, replacement):
    if source.count(marker) != 1:
        raise ValueError(f"expected one {marker.splitlines()[0]!r} in the imported template or script")
    return source.replace(marker, replacement, 1)


def replace_device_audio(source):
    source = replace_one(
        source,
        'const preview = new PreviewAudio(document.querySelector(".audio-feedback"));\n'
        'const catalog = JSON.parse(document.getElementById("media-catalog").textContent);\n'
        'const audio = new StreamPlayer(catalog, preview);',
        'const preview = new ShowcaseAudio(document.querySelector(".audio-feedback"));',
    )
    source = replace_one(source, 'demo.demo_external_clock(Number(audio.mode.value === "online"));',
                         'demo.demo_external_clock(0);')
    mode_handlers = re.findall(
        r'^audio\.mode\.addEventListener\("change",.*?(?=^document\.querySelector\("\.audio-retry"\))',
        source, re.MULTILINE | re.DOTALL,
    )
    if len(mode_handlers) != 1:
        raise ValueError("expected the packaged device's source-mode handlers")
    source = replace_one(source, mode_handlers[0], '')
    source = replace_one(source, '  clearInterval(backgroundTimer);\n  audio.reset();',
                         '  clearInterval(backgroundTimer);')
    source = re.sub(r'\baudio\.(reset|sync|unlock)\(', r'preview.\1(', source)
    if re.search(r'\baudio\.', source):
        raise ValueError("unsupported audio hook in the packaged device")
    source = replace_one(
        source,
        '  playerInput(() => demo.demo_click(x, y), true);',
        '  playerInput(() => {\n'
        '    if (demo.demo_click(x, y)) canvas.dispatchEvent(new Event("q2-screen-input"));\n'
        '  }, true);',
    )
    return replace_one(source, '\nloadPlayer();\n', '\npreview.bindToggle(() => demo);\nloadPlayer();\n')


def bundle_samples(package, standalone):
    samples = re.findall(r'<script id="(audio-[a-z0-9-]+)" type="audio/mpeg">([^<]+)</script>', standalone)
    expected = {f"audio-{key}" for key in AUDIO_KEYS}
    if len(samples) != len(expected) or {name for name, _ in samples} != expected:
        raise ValueError("unexpected standalone audio preview inventory")
    for name, encoded in samples:
        if base64.b64encode((package / f"{name}.mp3").read_bytes()).decode("ascii") != encoded:
            raise ValueError(f"{name}.mp3 differs from the standalone build")
    return (
        '// Bundled Q2 browser demo previews for both HTTP and file://.\n'
        'for (const [id, encoded] of Object.entries(' + json.dumps(dict(samples), indent=2) + ')) {\n'
        '  const asset = document.createElement("script");\n'
        '  asset.id = id;\n'
        '  asset.type = "audio/mpeg";\n'
        '  asset.textContent = encoded;\n'
        '  document.body.append(asset);\n'
        '}\n'
    )


class TourChapters(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if "chapter" in (attrs.get("class") or "").split():
            chapter = attrs.get("id")
            if not chapter or chapter in self.ids:
                raise ValueError("each tour chapter must have a unique ID")
            self.ids.append(chapter)


def build_screen_map(package, wasm, digest):
    chapters = TourChapters()
    chapters.feed((OUT.parent / "demo.html").read_text())
    chapters.close()
    result = subprocess.run(
        ["node", str(HERE / "map-screens.mjs"), "-", str(package / "demo.js"),
         "--chapters", json.dumps(chapters.ids)],
        input=wasm, capture_output=True, check=False,
    )
    if result.returncode:
        raise ValueError(result.stderr.decode(errors="replace").strip() or "screen map generation failed")
    _, _, data = result.stdout.partition(b"\nconst q2ScreenMap = ")
    if not data:
        raise ValueError("screen map generator did not return a map")
    graph = json.loads(data.rstrip().removesuffix(b";"))
    if graph.get("wasmSha256") != digest:
        raise ValueError("screen map and embedded WebAssembly do not match")
    return result.stdout


def build_embed(checkout, package):
    page = (package / "index.html").read_text()
    scripts = re.findall(r'<script\b[^>]*?\bsrc="([^"]+)"', page)
    if scripts != [f"./{name}" for name in SCRIPTS]:
        raise ValueError("unexpected script dependencies in the packaged device")

    standalone = (package / "q2-player.html").read_text()
    wasm = (package / "player.wasm").read_bytes()
    if any(prefix in wasm.lower() for prefix in (b"/home/", b"/users/", b"\\users\\")):
        raise ValueError("player.wasm contains a home-directory path; rebuild with --remap-path-prefix")
    digest = hashlib.sha256(wasm).hexdigest()
    encoded = base64.b64encode(wasm).decode("ascii")
    inline_wasm = f'<script id="player-wasm" type="application/wasm">{encoded}</script>'
    if not wasm.startswith(b"\0asm\x01\0\0\0") or inline_wasm not in standalone:
        raise ValueError("standalone player and packaged WebAssembly do not match")
    device = re.findall(r'<section class="player"\s.*?</section>', page, re.DOTALL)
    if len(device) != 1:
        raise ValueError("expected one packaged control surface")
    text_assets = {name: (package / name).read_text() for name in (*SCRIPTS, "style.css")}
    for name, source in text_assets.items():
        tag = "style" if name == "style.css" else "script"
        if f"<{tag}>\n{source}</{tag}>" not in standalone:
            raise ValueError(f"{name} differs from the standalone build")

    template = (HERE / "embed.template.html").read_text()
    license_name = "OpenSans-LICENSE.txt"
    font_license = (package / license_name).read_text()
    if f"<!-- Open Sans font license\n{font_license}-->" not in standalone:
        raise ValueError(f"{license_name} differs from the standalone build")
    files = {
        "embed.html": replace_one(template, "<!-- packaged device -->", device[0]).encode(),
        # Feed the existing inline-binary entry point so file:// needs no fetch.
        "module.js": f'document.getElementById("player-wasm").textContent = "{encoded}";\n'.encode(),
        "screen-map.js": build_screen_map(package, wasm, digest),
        "audio-samples.js": bundle_samples(package, standalone).encode(),
        "audio.js": text_assets["audio.js"].encode(),
        "timezone.js": text_assets["timezone.js"].encode(),
        "device.js": replace_device_audio(text_assets["demo.js"]).encode(),
        "device.css": text_assets["style.css"].encode(),
        license_name: font_license.encode(),
        "tidal.jpg": (checkout / "crates/wasm-demo/art/tidal.jpg").read_bytes(),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    for name, contents in files.items():
        (OUT / name).write_bytes(contents)
    return digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path, help="browser demo checkout containing build/web-demo")
    parser.add_argument("--package", type=Path, help="packaged web demo (default: CHECKOUT/build/web-demo)")
    args = parser.parse_args()
    try:
        digest = build_embed(args.checkout, args.package or args.checkout / "build/web-demo")
    except (OSError, ValueError) as error:
        parser.exit(1, f"{parser.prog}: {error}\n")
    print("Imported WASM SHA-256", digest)


if __name__ == "__main__":
    main()
