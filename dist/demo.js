(() => {
  const chapters = Array.from(document.querySelectorAll(".chapter"));
  const story = document.querySelector(".chapters");
  const frame = document.querySelector("iframe");
  const deck = document.querySelector(".deck");
  const header = document.querySelector(".site-header");
  const compactLandscape = matchMedia("(orientation: landscape) and (min-width: 560px) and (max-height: 480px)");
  const tools = document.querySelector(".tour-tools");
  const restart = document.getElementById("restore");
  const message = document.getElementById("mode");
  const guided = chapters.length > 1;
  let chapter = "";
  let interval = 0;
  let progress = 0;
  let ready = false;
  let manual = false;
  let scrollFrame = 0;
  let keyframeHold = 0;

  function sizeKeyframeHolds() {
    // Subtract the existing holds so resizing never compounds the extra travel.
    const travel = document.documentElement.scrollHeight - innerHeight;
    const originalTravel = Math.max(0, travel - chapters.length * keyframeHold);
    keyframeHold = Math.round(originalTravel * .2 / chapters.length);
    story.style.setProperty("--keyframe-hold", keyframeHold + "px");
  }

  function tell(kind, fields = {}) {
    // file:// windows have opaque origins. Both sides check the window and
    // sender, and use the exact same origin on a served site.
    const target = location.protocol === "file:" ? "*" : location.origin;
    frame.contentWindow.postMessage({ sender: "q2-tour", kind, ...fields }, target);
  }
  function cue(resume = false) {
    if (!ready || manual) return;
    restart.hidden = true;
    tell("scrub", { interval, progress, resume, scene: chapter });
  }
  function update() {
    scrollFrame = 0;
    if (compactLandscape.matches) {
      // Let the pinned rail use the space freed as the header scrolls away.
      deck.style.setProperty("--visible-header", Math.max(0, header.getBoundingClientRect().bottom) + "px");
    }
    const y = Math.max(0, window.scrollY);
    const max = document.documentElement.scrollHeight - innerHeight;
    // Use the same positions as native fragment links, including the sticky
    // player's scroll margin on phones. An anchor always lands on its keyframe.
    const anchors = chapters.map(el => Math.max(0, Math.min(max,
      el.getBoundingClientRect().top + window.scrollY - parseFloat(getComputedStyle(el).scrollMarginTop))));
    let i = 0;
    while (i < anchors.length - 2 && y >= anchors[i + 1]) i++;
    // Spend the added distance on the destination before playing the original transition.
    const start = anchors[i] + keyframeHold;
    const fraction = (y - start) / Math.max(1, anchors[i + 1] - start);
    const next = Math.max(0, Math.min(1, (fraction - .08) / .8));
    const id = chapters[next < .5 ? i : i + 1].id;
    if (i === interval && next === progress && chapter === id) return;
    interval = i;
    progress = next;
    chapter = id;
    deck.dataset.scene = id;
    cue();
  }
  function onScroll() { if (!scrollFrame) scrollFrame = requestAnimationFrame(update); }
  restart.addEventListener("click", () => {
    ready = manual = false;
    restart.hidden = true;
    tools.hidden = false;
    message.textContent = "Restarting the player…";
    frame.src = frame.getAttribute("src");
  });
  window.addEventListener("message", ({source, origin, data}) => {
    const validOrigin = location.protocol === "file:" ? origin === "null" || origin === "file://" : origin === location.origin;
    if (source !== frame.contentWindow || !validOrigin || data?.sender !== "q2-embed") return;
    switch (data.kind) {
      case "ready":
        if (ready) return;
        ready = true;
        cue();
        break;
      case "unavailable":
        tools.hidden = false;
        restart.hidden = true;
        message.textContent = data.retryable ? "The simulator could not start. Choose Retry on its screen." : "Loading the player…";
        ready = manual = false;
        break;
      case "manual":
        manual = true;
        tools.hidden = true;
        tell("offer-resume");
        break;
      case "resume":
        if (manual && ready) {
          update();
          manual = false;
          cue(true);
        }
        break;
      case "shown":
        if (!manual && data.scene === chapter) tools.hidden = true;
        break;
      case "failed":
        if (!manual && data.scene === chapter) {
          tools.hidden = false;
          restart.hidden = false;
          message.textContent = "This scene needs the original demo library.";
        }
        break;
    }
  });
  if (guided) {
    window.addEventListener("scroll", onScroll, {passive:true});
    sizeKeyframeHolds();
    window.addEventListener("resize", () => {
      sizeKeyframeHolds();
      onScroll();
    });
  }
  frame.addEventListener("load", () => tell("hello"));
  update();
  tell("hello");
})();
