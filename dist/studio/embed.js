(() => {
  const nativePlayer = document.querySelector(".player");
  const centerKey = nativePlayer.querySelector(".center");
  const screen = nativePlayer.querySelector("canvas");
  const resume = document.getElementById("control");
  const targetOrigin = location.protocol === "file:" ? "*" : location.origin;
  const report = (kind, fields = {}) => parent.postMessage({ sender: "q2-embed", kind, ...fields }, targetOrigin);
  const loadingScreen = nativePlayer.querySelector(".screen-message");
  const retry = nativePlayer.querySelector(".retry");
  // Firefox can restore a button's enabled state before the new WASM instance starts.
  function isReady() { return loadingScreen.hidden && !centerKey.disabled && Boolean(demo); }
  let manual = false;
  resume.addEventListener("click", () => report("resume"));
  function takeControl() {
    if (manual || !isReady()) return;
    q2Navigation.interrupt(nativePlayer);
    manual = true;
    report("manual");
  }
  nativePlayer.addEventListener("pointerdown", event => {
    if (event.isPrimary && event.button === 0 && event.target.closest(".wheel, button[data-input]")) takeControl();
  }, true);
  for (const surface of [screen, nativePlayer.querySelector(".wheel")]) {
    surface.addEventListener("wheel", event => {
      if (!event.ctrlKey && !event.metaKey && event.deltaY !== 0) takeControl();
    }, { capture: true, passive: true });
  }
  // A real screen tap is dispatched by the WASM player after hit testing.
  screen.addEventListener("q2-screen-input", takeControl);
  nativePlayer.addEventListener("click", event => {
    if (event.target.closest("button[data-input]")) takeControl();
  }, true);
  const playerKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " ", "Escape", "Backspace", "[", "]"]);
  document.addEventListener("keydown", event => {
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.defaultPrevented &&
        (event.target === document.body || nativePlayer.contains(event.target)) && playerKeys.has(event.key)) takeControl();
  }, true);

  function announce() {
    if (isReady()) return report("ready");
    q2Navigation.interrupt(nativePlayer);
    manual = false;
    resume.hidden = true;
    report("unavailable", { retryable: !retry.hidden });
  }
  const availability = new MutationObserver(announce);
  availability.observe(loadingScreen, { attributes: true, attributeFilter: ["hidden"] });
  availability.observe(retry, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("message", ({source, origin, data}) => {
    const validOrigin = location.protocol === "file:" ? origin === "null" || origin === "file://" : origin === location.origin;
    if (source !== parent || !validOrigin || data?.sender !== "q2-tour") return;
    if (data.kind === "hello") return announce();
    if (!isReady()) return;
    if (data.kind === "offer-resume") {
      resume.hidden = !manual;
      return;
    }
    if (data.kind === "manual") {
      takeControl();
      nativePlayer.focus({preventScroll:true});
      return;
    }
    if (data.kind !== "scrub" || !Number.isInteger(data.interval) ||
        !q2ScreenMap.timeline.segments[data.interval] || !Number.isFinite(data.progress)) return;
    if (data.resume) {
      manual = false;
      resume.hidden = true;
      nativePlayer.focus({preventScroll:true});
    }
    if (manual) return;
    try {
      q2Navigation.scrub(data.interval, data.progress, nativePlayer);
      report("shown", {scene: data.scene});
    } catch {
      q2Navigation.interrupt(nativePlayer);
      report("failed", {scene: data.scene});
    }
  });
  announce();
})();
