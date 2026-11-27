// Check every ordered pair of Demo chapters in the same live browser session.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const keyframes = {
  sleeves: /^Cover Flow · Disco Ultralounge/,
  playing: /^Now Playing · Playing Cylinder One by Chris Zabriskie$/,
  sound: /^Graphic EQ/,
  download: /^Downloads · Cylinders/,
  book: /^Book Info/,
  radio: /^Featured Stations · FIP/,
};

async function main() {
  const base = new URL(process.argv[2]);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: {width: 1280, height: 850} });
    await page.goto(new URL("demo.html", base).href);
    const state = page.frameLocator("iframe").locator("#current-state");
    const chapters = await page.locator(".chapter").evaluateAll(items => items.map(item => item.id));
    assert.deepEqual([...chapters].sort(), Object.keys(keyframes).sort());

    async function visit(scene) {
      await page.evaluate(name => { location.hash = name; }, scene);
      try {
        await page.locator(`.deck[data-scene="${scene}"]`).waitFor({timeout: 12000});
        await state.filter({hasText: keyframes[scene]}).waitFor({timeout: 12000});
        await page.locator(".tour-tools[hidden]").waitFor({state:"attached", timeout:12000});
      } catch (cause) {
        throw new Error(`Expected ${scene}, saw ${await state.textContent()} (${await page.locator("#mode").textContent()})`, {cause});
      }
    }

    let count = 0;
    for (const from of chapters) {
      for (const to of chapters) {
        if (from === to) continue;
        await visit(from);
        try { await visit(to); } catch (cause) { throw new Error(`${from} → ${to}`, {cause}); }
        count++;
      }
    }
    console.log(`Verified ${count} ordered chapter jumps in the live WASM player.`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
