// Measure the audio sent to the browser output while operating the real player.
const assert = require("node:assert/strict");
const { chromium, firefox } = require("playwright");

function observeOutput() {
  const meters = new Map();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...ports) {
    const result = connect.call(this, target, ...ports);
    if (target === this.context.destination && !meters.has(this)) {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      connect.call(this, analyser);
      meters.set(this, { analyser, buffer: new Float32Array(analyser.fftSize) });
    }
    return result;
  };

  window.outputPeak = () => {
    let peak = 0;
    for (const [node, { analyser, buffer }] of meters) {
      if (node.context.state !== "running") continue;
      analyser.getFloatTimeDomainData(buffer);
      for (const sample of buffer) peak = Math.max(peak, Math.abs(sample));
    }
    return peak;
  };
}

async function checkPlacement(page, manual = false) {
  const frame = page.locator("iframe");
  const device = frame.contentFrame();
  const speaker = device.locator("#audio-toggle");
  const bounds = await frame.boundingBox();
  const chassis = await device.locator(".player").boundingBox();
  const button = await speaker.boundingBox();
  const right = box => box.x + box.width;
  const bottom = box => box.y + box.height;
  const fitsFrame = box => box.x >= bounds.x - 1 && box.y >= bounds.y - 1 &&
    right(box) <= right(bounds) + 1 && bottom(box) <= bottom(bounds) + 1;
  assert(button && fitsFrame(button), "sound control must fit in the frame");
  const hasTouchTarget = await speaker.evaluate(el => {
    const { width, height } = el.getBoundingClientRect();
    return width >= 44 && height >= 44;
  });
  assert(hasTouchTarget, "sound control needs a 44px target");
  assert(button.x - right(chassis) >= 2 && button.x - right(chassis) <= 12,
    "sound control must sit just outside the right edge of the player");
  assert(button.y >= chassis.y + chassis.height / 2 && bottom(button) <= bottom(chassis),
    "sound control must sit beside the lower half of the player");
  assert(Math.abs(chassis.x + chassis.width / 2 - (bounds.x + bounds.width / 2)) < 1 &&
    Math.abs(chassis.y + chassis.height / 2 - (bounds.y + bounds.height / 2)) < 1,
    "player must stay centered in its frame");
  assert(await speaker.locator(".speaker-icon").isVisible(), "use a visible speaker icon");
  assert.equal(await speaker.evaluate(el => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)", "sound control must be transparent at rest");
  if (manual) {
    const resume = device.locator("#control");
    await resume.waitFor();
    const resumeBox = await resume.boundingBox();
    assert(resumeBox && fitsFrame(resumeBox) && resumeBox.x >= right(chassis),
      "Resume tour must fit beside the player");
    assert(bottom(resumeBox) + 2 <= button.y, "Resume tour and the sound control need separate touch targets");
  }
}

async function check(browser, base, width) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.addInitScript(observeOutput);
    await page.goto(new URL("demo.html#playing", base).href);
    const device = page.frameLocator("iframe");
    const state = device.locator("#current-state");
    const playing = () => state.filter({ hasText: /^Now Playing · Playing / }).waitFor();
    const unmute = device.getByRole("button", { name: "Unmute", exact: true });
    const mute = device.getByRole("button", { name: "Mute", exact: true });
    const readSilence = () => state.evaluate(async () => {
      let peak = 0;
      const until = performance.now() + 400;
      do {
        peak = Math.max(peak, window.outputPeak());
        await new Promise(requestAnimationFrame);
      } while (performance.now() < until);
      return peak;
    });
    const playerFrame = () => page.frames().find(frame => frame.url().endsWith("/studio/embed.html"));
    const audible = () => playerFrame().waitForFunction(() => window.outputPeak() > 0.0001, null, { timeout: 5000 });
    const position = () => state.evaluate(() => demo.demo_position_ms());
    await playing();
    await unmute.waitFor();
    await checkPlacement(page);
    assert(await device.locator(".step-controls").isHidden(), "keep the adjacent arrows hidden");
    // Sample a horizontal line inside the native progress bar, clear of its
    // border and the time labels. Its rightmost pixel is still unfilled here.
    const barWidth = () => state.evaluate(() => {
      const row = document.querySelector("canvas").getContext("2d").getImageData(31, 270, 313, 1);
      const pixels = new Uint32Array(row.data.buffer);
      return pixels.findIndex(pixel => pixel === pixels.at(-1));
    });
    const initialWidth = await barWidth();
    const parked = await position();
    assert.equal(await readSilence(), 0, "scroll-guided playback must start silent");
    await playerFrame().waitForFunction(start => demo.demo_position_ms() >= start + 2000, parked);
    assert(await barWidth() > initialWidth, "the rendered progress bar advances while the muted tour is stationary");
    await device.locator(".player").focus();
    await page.keyboard.press("Space");
    await state.filter({ hasText: /^Now Playing · Paused / }).waitFor();
    await checkPlacement(page, true);
    const paused = await position();
    await readSilence();
    assert.equal(await position(), paused, "pausing the song stops its clock");
    await page.keyboard.press("Space");
    await playing();
    assert.equal(await readSilence(), 0, "a player gesture must not enable sound");
    await unmute.click();
    await mute.waitFor();
    await audible();
    await playerFrame().waitForFunction(previous => demo.demo_position_ms() > previous, await position(), { timeout: 5000 });
    await mute.click();
    await unmute.waitFor();
    // Allow the previous analyser window to drain, then check sustained silence.
    await state.evaluate(() => new Promise(resolve => setTimeout(resolve, 120)));
    assert.equal(await readSilence(), 0, "Mute must silence ongoing playback");
    await device.locator("#control").click();
    await page.locator(".tour-tools[hidden]").waitFor({state:"attached"});
    await device.locator("#control").waitFor({state:"hidden"});
    await playing();
    const resumed = await position();
    assert.equal(await readSilence(), 0, "resuming the tour must preserve mute");
    assert(await position() > resumed, "resuming muted guidance keeps the transport running");
    await unmute.focus();
    await page.keyboard.press("Enter");
    await mute.waitFor();
    await audible();
    assert(await device.locator("#control").isHidden(), "unmuting keeps the tour active");
    await page.reload();
    // Wait for the new embedded document to handshake after frame replacement.
    await page.locator(".tour-tools[hidden]").waitFor({state:"attached"});
    await device.locator("#control").waitFor({state:"hidden"});
    await playing();
    await unmute.waitFor();
    assert.equal(await readSilence(), 0, "a reload must start muted again");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function checkAdditionalLayouts(browser, base) {
  for (const [width, height] of [[1280, 800], [320, 800], [667, 375]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      const frame = page.locator("iframe");
      const device = frame.contentFrame();
      await page.goto(new URL("index.html", base).href);
      await frame.scrollIntoViewIfNeeded();
      await device.locator(".center:enabled").waitFor();
      await checkPlacement(page);
      await device.getByRole("button", { name: "Unmute", exact: true }).click();
      await device.getByRole("button", { name: "Mute", exact: true }).click();

      if (width === 667) {
        await page.goto(new URL("demo.html", base).href);
        await device.locator(".center:enabled").waitFor();
        await checkPlacement(page);
        await device.locator(".player").focus();
        await page.keyboard.press("ArrowDown");
        await checkPlacement(page, true);
      }
    } finally {
      await page.close();
    }
  }
}

// Reproduce a browser restoring form controls while WASM is still loading.
async function checkRestoredButton(browser, base) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      const instantiate = WebAssembly.instantiate.bind(WebAssembly);
      WebAssembly.instantiate = async (...args) => {
        document.querySelector(".center").disabled = false;
        await new Promise(resolve => { window.finishInstantiation = resolve; });
        return instantiate(...args);
      };
    });
    await page.goto(new URL("demo.html#playing", base).href);
    const device = page.frameLocator("iframe");
    await device.locator(".center:enabled").waitFor();
    assert(await device.locator("#control").isHidden());
    await device.locator(".center").evaluate(() => window.finishInstantiation());
    await page.locator(".tour-tools[hidden]").waitFor({state:"attached"});
    await device.locator("#control").waitFor({state:"hidden"});
    await device.locator("#current-state").filter({ hasText: /^Now Playing · Playing / }).waitFor();
  } finally { await page.close(); }
}

async function main() {
  const base = new URL(process.argv[2]);
  const which = process.argv[3] || "chromium";
  const browser = await ({ chromium, firefox }[which].launch());
  try {
    await checkRestoredButton(browser, base);
    await checkAdditionalLayouts(browser, base);
    for (const width of [1280, 320]) await check(browser, base, width);
    console.log(which, base.protocol, "passed output, mute, reload, and desktop and mobile placement on Demo and Features.");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
