// Exercise the actual parent page, embedded WASM boundary and manual inputs.
const assert = require("node:assert/strict");
const { chromium, firefox } = require("playwright");

async function observePlayer(player) {
  await player.evaluate(node => {
    const state = document.getElementById("current-state");
    const wheel = node.querySelector(".wheel");
    const center = node.querySelector(".center");
    const buttons = { Select: center, HoldCenter: center, Back: node.querySelector(".back") };
    const buttonStyle = button => {
      const { backgroundColor, boxShadow } = getComputedStyle(button);
      return `${backgroundColor} ${boxShadow}`;
    };
    const idle = Object.fromEntries(Object.entries(buttons).map(([input, button]) => [input, buttonStyle(button)]));
    window.tourFrames = [];
    function sample() {
      const input = node.dataset.tourInput;
      const frame = { time: performance.timeOrigin + performance.now(), label: state.textContent, input };
      if (input === "Up" || input === "Down") {
        const marker = getComputedStyle(wheel, "::after");
        if (marker.content !== "none" && marker.borderRightWidth !== "0px") {
          frame.wheelTransform = marker.transform;
          frame.wheelAngle = parseFloat(marker.getPropertyValue("--tour-angle"));
        }
      }
      if (Object.hasOwn(buttons, input)) frame.buttonLit = buttonStyle(buttons[input]) !== idle[input];
      if (input === "HoldCenter") {
        const indicator = getComputedStyle(center, "::after");
        if (indicator.content !== "none") frame.holdProgress = parseFloat(indicator.getPropertyValue("--tour-hold"));
      }
      window.tourFrames.push(frame);
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}

async function run(browser, base, width) {
  const page = await browser.newPage({ viewport: {width, height: 800}, hasTouch: width < 700, reducedMotion: "no-preference" });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(new URL("index.html", base).href);
    const nav = page.getByRole("navigation", { name: "Primary" });
    async function checkNav(active) {
      await nav.getByRole("link", {name: active, exact: true, current: "page"}).waitFor();
      assert.deepEqual(await nav.getByRole("link").allTextContents(), ["Features", "Demo", "Install"]);
      assert.equal(await nav.locator("[aria-current=page]").innerText(), active);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
    const homeDevice = page.frameLocator("iframe");
    await homeDevice.locator("#current-state").filter({hasText:/^Q2 · Music$/}).waitFor();
    assert(await homeDevice.locator(".step-controls").isHidden());
    const panel = await page.locator(".instrument").boundingBox();
    const chassis = await homeDevice.locator(".player").boundingBox();
    assert(Math.abs(panel.width - panel.height) <= 1, "Features player panel should be square");
    for (const [origin, size] of [["x", "width"], ["y", "height"]]) {
      const playerCenter = chassis[origin] + chassis[size] / 2;
      assert(Math.abs(playerCenter - panel[origin] - panel[size] / 2) <= 1, "center the Features player");
    }
    await checkNav("Features");
    assert.equal(await page.locator(".frame").count(), 6);
    await page.locator(".frame").first().click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.locator("#enlarged-title").innerText(), "Cover Flow");
    await page.locator("#next").click();
    assert.equal(await page.locator("#enlarged-title").innerText(), "Now Playing");
    await page.keyboard.press("Escape");
    if (width >= 700) {
      await page.getByRole("link", {name:/Open a book in the demo/}).click();
      await page.waitForURL("**/demo.html#book");
      await page.locator('.deck[data-scene="book"]').waitFor();
      await page.frameLocator("iframe").locator("#current-state").filter({hasText:/^Book Info/}).waitFor();
    }
    await nav.getByText("Install").click();
    await checkNav("Install");
    await nav.getByText("Demo").click();
    await checkNav("Demo");
    const device = page.frameLocator("iframe");
    const state = device.locator("#current-state");
    const player = device.locator(".player");
    const animatedInput = device.locator(".player[data-tour-input]");
    const control = device.getByRole("button", {name:"Resume tour", includeHidden:true});
    const screen = device.getByRole("img", {name:/^Q2 player screen/});
    const equalizer = /^Graphic EQ/;
    const bandDisplay = () => screen.evaluate(canvas => {
      // Sample the bands and frequency readout below the clock and status bar.
      const { data } = canvas.getContext("2d").getImageData(0, 85, canvas.width, 200);
      return data.reduce((hash, byte) => Math.imul(hash ^ byte, 16777619), 2166136261);
    });
    const bandGains = () => screen.evaluate(canvas => {
      const { width, data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      const red = (x, y) => data[4 * (y * width + x)];
      // Sample off the vertical track, against the chart background at the same height.
      return Array.from({length: 10}, (_, index) => {
        for (let gain = -12; gain <= 12; gain++) {
          const y = 157 - 5 * gain;
          if (red(45 + 31 * index, y) !== red(36, y)) return gain;
        }
        return null;
      });
    });
    const reached = async expected => {
      try {
        await state.filter({hasText:expected}).waitFor();
      } catch (cause) {
        throw new Error(`${width}px expected ${expected}, saw "${await state.textContent()}" (${await page.locator("#mode").textContent()})`, {cause});
      }
    };
    const guided = async () => {
      await page.locator(".tour-tools[hidden]").waitFor({state:"attached"});
      await control.waitFor({state:"hidden"});
    };
    const manual = () => control.filter({hasText:"Resume tour"}).waitFor();
    const startSampling = () => player.evaluate(() => { window.tourFrames.length = 0; });
    const samples = () => player.evaluate(() => window.tourFrames);
    const watchStable = async (expected, message) => {
      await player.evaluate(() => new Promise(resolve => setTimeout(resolve, 600)));
      const frames = await samples();
      assert(frames.length >= 2 && frames.every(expected), message);
    };
    const openChapter = async id => {
      await page.evaluate(name => { location.hash = name; }, id);
      await page.locator(`.deck[data-scene="${id}"]`).waitFor();
    };
    const anchors = await page.locator(".chapter").evaluateAll(chapters => Object.fromEntries(chapters.map(chapter => {
      const offset = chapter.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(chapter).scrollMarginTop);
      return [chapter.id, Math.max(0, Math.min(offset, document.documentElement.scrollHeight - innerHeight))];
    })));
    const hold = await page.locator(".chapters").evaluate(story => parseFloat(getComputedStyle(story).getPropertyValue("--keyframe-hold")));
    const between = (from, to, fraction) => {
      const start = anchors[from] + hold;
      return Math.round(start + (anchors[to] - start) * fraction);
    };
    const settled = () => player.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const scrub = async (offset, wheel = false) => {
      if (wheel) await page.mouse.wheel(0, offset - await page.evaluate(() => scrollY));
      else await page.evaluate(y => window.scrollTo(0, y), offset);
      await page.waitForFunction(y => Math.abs(scrollY - y) <= 1, offset);
      await settled();
      return (await samples()).at(-1);
    };
    const pressScreen = (x, y) => {
      const position = {x, y};
      return width < 700 ? screen.tap({position}) : screen.click({position});
    };
    await guided();
    await reached(/^Cover Flow · Disco Ultralounge/);
    if (width < 700) {
      const deck = await page.locator(".deck").boundingBox();
      const chassis = await player.boundingBox();
      assert(deck.height >= page.viewportSize().height / 2, "give the phone player the upper half of the page");
      assert(chassis.height > deck.height * .7, "use the available portrait stage for the device");
    }
    await observePlayer(player);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);

    // Scroll straight through without waiting at a chapter. Compare the actual player
    // frames against the time spent moving through each added stretch of scroll.
    const movement = await page.evaluate(async () => {
      const log = [];
      const end = document.documentElement.scrollHeight - innerHeight;
      for (let y = 0; y <= end; y += 12) {
        await new Promise(requestAnimationFrame);
        window.scrollTo(0, y);
        log.push({ y: scrollY, time: performance.timeOrigin + performance.now() });
      }
      window.scrollTo(0, end);
      return log;
    });
    const frames = await samples();
    for (const [id, expected] of Object.entries({
      sleeves: /^Cover Flow · Disco Ultralounge/, playing: /^Now Playing · Playing Cylinder One/,
      sound: /^Graphic EQ/, download: /^Downloads · Cylinders/, book: /^Book Info/, radio: /^Featured Stations · FIP/
    })) {
      const begin = movement.find(step => step.y >= anchors[id]);
      const end = movement.find(step => step.y >= anchors[id] + hold);
      const held = frames.filter(frame => frame.time >= begin.time && frame.time < end.time);
      assert(held.length >= 2 && held.every(frame => expected.test(frame.label) && frame.input === undefined),
        `keep ${id} visible and the controls released while scrolling across its hold at ${width}px`);
    }
    await scrub(0);
    await reached(/^Cover Flow · Disco Ultralounge/);

    // A single opening spin crosses several covers and stops at the visitor's scroll position.
    const text = await page.locator("#sleeves .lead").boundingBox();
    const covers = await player.evaluate(() => q2ScreenMap.targets.sleeves.map(id => q2ScreenMap.nodes[id].selection));
    const indexOfCover = ({label}) => covers.indexOf(label.split(" · ")[1]);
    const opening = fraction => between("sleeves", "playing", fraction);
    await page.mouse.move(text.x + 4, Math.min(text.y + 5, 775));
    await startSampling();
    const beforeFirstNotch = await scrub(opening(.105), true);
    const start = await scrub(opening(.13));
    const middle = await scrub(opening(.27));
    const end = await scrub(opening(.43));
    for (const frame of [beforeFirstNotch, start, middle, end]) assert.equal(frame.input, "Up");
    assert.equal(beforeFirstNotch.label, start.label);
    assert(beforeFirstNotch.wheelAngle > start.wheelAngle,
      "the wheel should turn as the page moves between selection notches");
    assert(start.wheelAngle > middle.wheelAngle && middle.wheelAngle > end.wheelAngle,
      `group several wheel notches into one continuous turn at ${width}px`);
    assert(start.wheelTransform !== middle.wheelTransform && middle.wheelTransform !== end.wheelTransform,
      `visibly turn the wheel as the page moves at ${width}px`);
    assert(indexOfCover(start) === 0 && indexOfCover(end) === covers.length - 1,
      `reach the last album from the first during one wheel turn at ${width}px`);
    await startSampling();
    await watchStable(frame => frame.label === end.label && frame.input === end.input && frame.wheelAngle === end.wheelAngle,
      "the wheel and selected cover must hold when scrolling stops between keyframes");
    const reverse = await scrub(opening(.27));
    assert.equal(reverse.input, "Down");
    assert.equal(reverse.label, middle.label);
    assert(reverse.wheelAngle > end.wheelAngle, "reversing scroll must turn back toward the earlier selection");
    await scrub(0);
    await reached(/^Cover Flow · Disco Ultralounge/);

    await startSampling();
    for (const fraction of [.46, .51, .57]) {
      const resting = await scrub(opening(fraction));
      assert.equal(resting.input, undefined, "release the wheel for a beat on the final cover");
      assert.match(resting.label, /^Cover Flow · Cylinders/);
    }
    const centerPress = await scrub(opening(.63));
    assert.equal(centerPress.input, "Select");
    assert(centerPress.buttonLit, "light the real center button on the selected sleeve");
    assert.match(centerPress.label, /^Cover Flow · Cylinders/);
    await scrub(opening(.68));
    await reached(/^Cylinders · Shuffle/);
    for (const fraction of [.73, .79, .85]) await scrub(opening(fraction));
    await scrub(Math.round(anchors.playing));
    const nowPlaying = /^Now Playing · Playing Cylinder One by Chris Zabriskie$/;
    await reached(nowPlaying);
    await guided();
    const transition = await samples();
    const isIntermediate = label => label && !/^Cover Flow ·/.test(label) && !nowPlaying.test(label);
    const intermediate = transition.filter(({label}) => isIntermediate(label));
    assert(new Set(intermediate.map(({label}) => label)).size >= 2,
      `show multiple intermediate player screens or selections at ${width}px`);
    assert(transition.some(({label}, index) => isIntermediate(label) && label === transition[index - 1]?.label),
      `hold an intermediate player label across browser frames at ${width}px`);
    assert(transition.some(({buttonLit}) => buttonLit),
      `show an automated button press at ${width}px`);

    await startSampling();
    for (const fraction of [.105, .13, .155, .18, .23, .29, .35, .41]) {
      await scrub(between("playing", "sound", fraction));
    }
    const flat = Array(10).fill(0);
    const middleGains = [2, 2, 1, -1, -1, -1, 1, 1, 1, 0];
    const finalGains = [4, 3, 1, -1, -2, -1, 1, 2, 1, 0];
    const eqOffset = fraction => between("playing", "sound", fraction);
    await scrub(eqOffset(.5));
    await reached(equalizer);
    assert.deepEqual(await bandGains(), flat, "enter Graphic EQ with a flat curve");
    await scrub(eqOffset(.72));
    assert.deepEqual(await bandGains(), middleGains, "scroll into an intermediate curve on the real bands");
    await scrub(Math.round(anchors.sound));
    await reached(equalizer);
    assert.deepEqual(await bandGains(), finalGains, "complete the tour curve at the sound chapter");
    await guided();
    const shortcut = await samples();
    const heldCenter = shortcut.filter(({label, input, buttonLit}) =>
      nowPlaying.test(label) && input === "HoldCenter" && buttonLit);
    const holdPositions = new Set(heldCenter.map(({holdProgress}) => holdProgress).filter(Number.isFinite));
    assert(holdPositions.size >= 2,
      `advance the Centre hold while scrolling on Now Playing before opening the quick menu at ${width}px`);
    assert(shortcut.some(({label}) => /^Now Playing · Equalizer(?: ·|$)/.test(label)),
      `show the selected Equalizer row in the Now Playing quick menu at ${width}px`);

    await scrub(eqOffset(.72));
    assert.deepEqual(await bandGains(), middleGains, "reversing scroll retraces the curve");
    await scrub(eqOffset(.5));
    assert.deepEqual(await bandGains(), flat, "reversing to the start flattens the bands");
    const eqBox = await screen.boundingBox();
    await pressScreen(eqBox.width * 48 / 375, eqBox.height * 117 / 320);
    await manual();
    await openChapter("sound");
    assert.deepEqual(await bandGains(), [8, ...flat.slice(1)], "scroll leaves a visitor's band edit in place");
    await control.click();
    await guided();
    await reached(equalizer);
    assert.deepEqual(await bandGains(), finalGains, "resuming repairs the tour curve after a visitor edit");

    for (const [id, label] of [["download", /^Downloads · Cylinders/],
      ["book", /^Book Info/], ["radio", /^Featured Stations · FIP/], ["sleeves", /^Cover Flow · Disco Ultralounge/]]) {
      await openChapter(id);
      await reached(label);
    }
    await guided();
    // Returning from radio can select a distant sleeve instantly while its
    // artwork is still gliding. Tap once the native cover animation settles.
    await screen.evaluate(async canvas => {
      const ctx = canvas.getContext("2d");
      let previous, stable = 0;
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 70));
        const strip = ctx.getImageData(37, 127, 300, 1).data;
        stable = previous && strip.every((value, j) => value === previous[j]) ? stable + 1 : 0;
        if (stable === 2) return;
        previous = strip;
      }
      throw new Error("Cover Flow artwork did not settle");
    });
    const screenBox = await screen.boundingBox();
    await pressScreen(screenBox.width * 187 / 375, screenBox.height * 127 / 320);
    await manual();
    const deviceBox = await player.boundingBox();
    const resumeBox = await control.boundingBox();
    assert(resumeBox.x >= deviceBox.x + deviceBox.width - 1, "Resume sits beside the chassis");
    assert(resumeBox.y >= deviceBox.y && resumeBox.y + resumeBox.height <= deviceBox.y + deviceBox.height);
    assert(await page.locator("#mode").isHidden(), "manual exploration needs only the resume button");
    await reached(/^Disco Ultralounge · Shuffle/);
    const held = await state.textContent();
    await openChapter("book");
    assert.equal(await state.textContent(), held);
    await control.click();
    await guided();
    await reached(/^Book Info/);
    if (width < 700) await device.locator(".center").tap();
    else await device.locator(".center").click();
    await manual();
    await reached(/^Now Playing · Playing The Wonderful Wizard of Oz/);
    await openChapter("sound");
    await control.click();
    await reached(equalizer);
    await guided();
    const firstBand = await bandDisplay();
    const wheel = device.locator(".wheel");
    await wheel.hover();
    await page.mouse.wheel(0, 40);
    await manual();
    await player.evaluate(() => new Promise(resolve => setTimeout(resolve, 80)));
    await reached(equalizer);
    assert.notEqual(await bandDisplay(), firstBand, "turning the real wheel must move the selected EQ band");
    await openChapter("book");
    await control.click();
    await guided();
    await reached(/^Book Info/);
    await player.focus();
    await page.keyboard.press("Enter");
    await manual();
    await reached(/^Now Playing · Playing The Wonderful Wizard of Oz/);
    await openChapter("sleeves");
    await control.click();
    await guided();
    await reached(/^Cover Flow · Disco Ultralounge/);

    if (width >= 700) {
      await scrub(opening(.41));
      await animatedInput.waitFor();
      await player.evaluate(node => node.focus({preventScroll:true}));
      await page.keyboard.press("Escape");
      await manual();

      // Exclude the frame that renders the visitor's Back press.
      await settled();
      const takenOver = await state.textContent();
      await startSampling();
      await openChapter("radio");
      await watchStable(({label, input}) => label === takenOver && input === undefined,
        "manual takeover must cancel pending actions while the page continues scrolling");

      await control.click();
      await guided();
      await reached(/^Featured Stations · FIP/);

      const previous = between("playing", "sound", .19);
      await scrub(previous);
      await animatedInput.waitFor();
      assert.doesNotMatch(await state.textContent(), equalizer);
      await startSampling();
      await page.evaluate(({download, book}) => { window.scrollTo(0, download); window.scrollTo(0, book); }, anchors);
      await guided();
      await reached(/^Book Info/);
      await startSampling();
      await watchStable(({label, input}) => /^Book Info/.test(label) && input === undefined,
        "only the latest chapter may finish after rapid scrolling and reversal");
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function checkRetry(browser, base) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      const instantiate = WebAssembly.instantiate;
      WebAssembly.instantiate = (...args) => {
        WebAssembly.instantiate = instantiate;
        return Promise.reject(new Error("Test initialization failure"));
      };
    });
    await page.goto(new URL("demo.html#radio", base).href);
    const device = page.frameLocator("iframe");
    await page.locator("#mode").filter({hasText:"could not start"}).waitFor();
    assert(await device.getByRole("button", {name:"Resume tour", includeHidden:true}).isHidden());
    await device.getByRole("button", {name:"Retry"}).click();
    await device.locator("#current-state").filter({hasText:/^Featured Stations ·/}).waitFor();
    await page.locator(".tour-tools[hidden]").waitFor({state:"attached"});
  } finally { await page.close(); }
}

async function main() {
  const base = new URL(process.argv[2]);
  const engine = { chromium, firefox }[process.argv[3] || "chromium"];
  const browser = await engine.launch();
  try {
    for (const width of [1280, 390, 320]) await run(browser, base, width);
    await checkRetry(browser, base);
    console.log("Passed navigation, gallery links, animated tour and all six scenes, rapid reversal, manual takeover and resume, and retry at a linked chapter.");
  } finally { await browser.close(); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
