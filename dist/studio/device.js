"use strict";

const WIDTH = 375;
const HEIGHT = 320;
const HOLD_MS = 600;
const WHEEL_IDLE_MS = 120;
const FRAME_INTERVAL_MS = 1000 / 30;
const WHEEL_STEP = Math.PI / 5;
const Input = {
  Up: 0, Down: 1, Select: 2, Back: 3, Play: 4, Previous: 5, Next: 6,
  HoldCenter: 7, WheelEnd: 8, HoldBack: 9,
};

const player = document.querySelector(".player");
const wheel = document.querySelector(".wheel");
const center = document.querySelector(".center");
const back = document.querySelector(".back");
const canvas = document.querySelector("canvas");
const screenMessage = document.querySelector(".screen-message");
const screenStatus = document.querySelector(".screen-status");
const state = document.querySelector("#current-state");
const retry = document.querySelector(".retry");
const buttons = Array.from(player.querySelectorAll("[data-input]"));
const context = canvas.getContext("2d", { alpha: false });
const frame = context?.createImageData(WIDTH, HEIGHT);
const decoder = new TextDecoder();
const wallClock = new PlayerWallClock(decoder);
const preview = new ShowcaseAudio(document.querySelector(".audio-feedback"));

let demo;
let started;
let lastFrame = -Infinity;
let raf;
let lastLabel = "";
let hoverPoint;
let screenPress;

function draw(now) {
  if (!demo) return;
  try {
    wallClock.sync(demo);
    const pointer = demo.demo_frame(Math.max(0, Math.floor(now - started))) >>> 0;
    frame.data.set(new Uint8Array(demo.memory.buffer, pointer, frame.data.length));
    context.putImageData(frame, 0, 0);
    const labelPointer = demo.demo_label() >>> 0;
    const labelLength = demo.demo_label_len() >>> 0;
    const label = decoder.decode(new Uint8Array(demo.memory.buffer, labelPointer, labelLength));
    if (label !== lastLabel) {
      lastLabel = label;
      canvas.setAttribute("aria-label", label ? "Q2 player screen. " + label : "Q2 player screen");
      state.textContent = label;
    }
    preview.sync(demo);
    if (hoverPoint) updateScreenCursor();
    lastFrame = now;
  } catch (error) {
    showFailure(error);
  }
}

function render(now) {
  if (!demo) return;
  if (now - lastFrame >= FRAME_INTERVAL_MS - 1) draw(now);
  if (demo) raf = requestAnimationFrame(render);
}

function showFailure(error) {
  console.error("Unable to run the Q2 player demo", error);
  cancelAnimationFrame(raf);
  preview.reset();
  screenPress = undefined;
  hoverPoint = undefined;
  canvas.classList.remove("clickable");
  demo = undefined;
  stopHold();
  state.textContent = "";
  canvas.setAttribute("aria-label", "Q2 player screen");
  clearTimeout(wheelTimer);
  wheelTimer = undefined;
  wheelDelta = 0;
  gesture = undefined;
  for (const button of buttons) button.disabled = true;
  screenStatus.textContent = "Couldn’t load the player.";
  screenMessage.hidden = false;
  retry.hidden = false;
}

async function readPlayerBinary() {
  const inline = document.querySelector("#player-wasm");
  if (inline) {
    return Uint8Array.from(atob(inline.textContent.trim()), (character) => character.charCodeAt(0));
  }
  const response = await fetch("./player.wasm", { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Player file could not be downloaded");
  return response.arrayBuffer();
}

async function loadPlayer() {
  const restoreFocus = document.activeElement === retry;
  screenStatus.textContent = "Loading player…";
  retry.hidden = true;
  try {
    if (!context) throw new Error("Canvas is unavailable");
    const { instance } = await WebAssembly.instantiate(await readPlayerBinary());
    demo = instance.exports;
    demo.demo_init();
    demo.demo_external_clock(0);
    started = performance.now();
    lastLabel = "";
    draw(started);
    if (!demo) return;
    screenMessage.hidden = true;
    for (const button of buttons) button.disabled = false;
    if (restoreFocus) player.focus();
    raf = requestAnimationFrame(render);
  } catch (error) {
    showFailure(error);
    if (restoreFocus) retry.focus();
  }
}

function playerInput(action, screenTap = false) {
  if (!demo) return;
  try {
    const now = performance.now();
    // A tap must use the geometry of the pixels the visitor actually saw.
    if (!screenTap) demo.demo_frame(Math.floor(now - started));
    action();
    if (demo.demo_playing() && navigator.userActivation?.isActive !== false) preview.unlock();
    if (screenTap) draw(now);
    else preview.sync(demo);
  } catch (error) {
    showFailure(error);
  }
}

function send(input) {
  playerInput(() => demo.demo_input(input));
}

function screenPoint(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: Math.floor((event.clientX - box.left) * WIDTH / box.width),
    y: Math.floor((event.clientY - box.top) * HEIGHT / box.height),
  };
}

function updateScreenCursor() {
  canvas.classList.toggle("clickable", Boolean(demo?.demo_clickable(hoverPoint.x, hoverPoint.y)));
}

function clearScreenPress() {
  screenPress = undefined;
}

canvas.addEventListener("pointerdown", event => {
  if (!demo || event.button !== 0 || !event.isPrimary) {
    clearScreenPress();
    return;
  }
  const point = screenPoint(event);
  screenPress = demo.demo_clickable(point.x, point.y)
    ? { id: event.pointerId, x: event.clientX, y: event.clientY }
    : undefined;
});

canvas.addEventListener("pointermove", event => {
  if (screenPress?.id === event.pointerId &&
      Math.hypot(event.clientX - screenPress.x, event.clientY - screenPress.y) > 8) {
    clearScreenPress();
  }
  if (event.pointerType !== "touch") {
    hoverPoint = screenPoint(event);
    updateScreenCursor();
  }
});

canvas.addEventListener("pointerup", event => {
  const press = screenPress;
  clearScreenPress();
  if (press?.id !== event.pointerId || event.button !== 0 ||
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) return;
  const { x, y } = screenPoint(event);
  player.focus({ preventScroll: true });
  playerInput(() => {
    if (demo.demo_click(x, y)) canvas.dispatchEvent(new Event("q2-screen-input"));
  }, true);
});

canvas.addEventListener("pointercancel", clearScreenPress);
canvas.addEventListener("pointerleave", () => {
  clearScreenPress();
  hoverPoint = undefined;
  canvas.classList.remove("clickable");
});

let wheelTimer;
let wheelDelta = 0;

function finishWheel() {
  clearTimeout(wheelTimer);
  wheelTimer = undefined;
  wheelDelta = 0;
  send(Input.WheelEnd);
}

function nudgeWheel(input) {
  send(input);
  clearTimeout(wheelTimer);
  if (!gesture) wheelTimer = setTimeout(finishWheel, WHEEL_IDLE_MS);
}

function scrollSteps(delta, step, circular = false) {
  if (wheelDelta * delta < 0) wheelDelta = 0;
  wheelDelta += delta;
  const steps = Math.min(12, Math.floor(Math.abs(wheelDelta) / step));
  if (!steps) {
    clearTimeout(wheelTimer);
    if (!gesture) wheelTimer = setTimeout(finishWheel, WHEEL_IDLE_MS);
    return;
  }
  const direction = Math.sign(wheelDelta);
  wheelDelta %= step;
  const up = circular && demo.demo_wheel_is_volume() ? direction > 0 : direction < 0;
  for (let i = 0; i < steps; i++) nudgeWheel(up ? Input.Up : Input.Down);
}

function scrollPlayer(event) {
  if (!demo || event.ctrlKey || event.metaKey || event.deltaY === 0) return;
  event.preventDefault();
  const delta = event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * 45;
  scrollSteps(delta, 35);
}
wheel.addEventListener("wheel", scrollPlayer, { passive: false });
canvas.addEventListener("wheel", scrollPlayer, { passive: false });

let gesture;
let suppressedClick;

function wheelPoint(event) {
  const { left, top, width, height } = wheel.getBoundingClientRect();
  const x = event.clientX - left - width / 2;
  const y = event.clientY - top - height / 2;
  return { angle: Math.atan2(y, x), radius: Math.hypot(x, y), innerRadius: width * .2 };
}

wheel.addEventListener("pointerdown", (event) => {
  if (!demo || !event.isPrimary || event.button !== 0) return;
  suppressedClick = undefined;
  const { angle, radius, innerRadius } = wheelPoint(event);
  if (radius < innerRadius || center.contains(event.target)) return;
  if (wheelTimer !== undefined) finishWheel();
  gesture = { id: event.pointerId, angle, travel: 0, rotated: false };
});

window.addEventListener("pointermove", (event) => {
  if (gesture?.id !== event.pointerId) return;
  const { angle, radius, innerRadius } = wheelPoint(event);
  const delta = Math.atan2(Math.sin(angle - gesture.angle), Math.cos(angle - gesture.angle));
  gesture.angle = angle;
  if (radius < innerRadius) return;
  if (!gesture.rotated) {
    gesture.travel += delta;
    if (Math.abs(gesture.travel) < WHEEL_STEP * .6) return;
    gesture.rotated = true;
    stopHold();
    wheel.setPointerCapture(event.pointerId);
    scrollSteps(gesture.travel, WHEEL_STEP, true);
    return;
  }
  scrollSteps(delta, WHEEL_STEP, true);
});

function endGesture(event) {
  if (gesture?.id !== event.pointerId) return;
  if (gesture.rotated) {
    if (event.type === "pointerup") suppressedClick = performance.now();
    finishWheel();
  }
  gesture = undefined;
}

window.addEventListener("pointerup", endGesture);
window.addEventListener("pointercancel", endGesture);
wheel.addEventListener("lostpointercapture", (event) => {
  if (event.target === wheel) endGesture(event);
});

let holdTimer;
let heldPointer;
let heldKey;
let holdConsumed = false;
let heldButton;

function startHold(button) {
  heldButton = button;
  holdConsumed = false;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdConsumed = true;
    send(button === center ? Input.HoldCenter : Input.HoldBack);
  }, HOLD_MS);
}

function stopHold() {
  clearTimeout(holdTimer);
  heldPointer = undefined;
  heldKey = undefined;
}

for (const button of [center, back]) {
  button.addEventListener("pointerdown", event => {
    if (!demo || !event.isPrimary || event.button !== 0) return;
    suppressedClick = undefined;
    heldPointer = event.pointerId;
    startHold(button);
  });
  button.addEventListener("pointerleave", () => {
    if (heldButton === button && heldPointer !== undefined) stopHold();
  });
}

window.addEventListener("pointerup", (event) => {
  if (event.pointerId === heldPointer) stopHold();
});
window.addEventListener("pointercancel", (event) => {
  if (event.pointerId === heldPointer) stopHold();
});
center.addEventListener("pointerleave", (event) => {
  if (event.pointerId === heldPointer) stopHold();
});

function activate(button) {
  const input = Number(button.dataset.input);
  if (input === Input.Up || input === Input.Down) nudgeWheel(input);
  else send(input);
}

// Mobile browsers may omit the synthetic click for a tap immediately after
// a wheel turn. Honor the touch release itself and consume its paired click.
let touchButton;
player.addEventListener("pointerdown", event => {
  if (!event.isPrimary) return;
  suppressedClick = undefined;
  if (event.pointerType === "touch") touchButton = event.target.closest("[data-input]");
});
player.addEventListener("pointercancel", () => { touchButton = undefined; });
player.addEventListener("pointerup", event => {
  if (event.pointerType !== "touch" || !event.isPrimary) return;
  const button = touchButton;
  touchButton = undefined;
  if (!button || gesture?.rotated) return;
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  if (!hit || !button.contains(hit)) return;
  suppressedClick = performance.now();
  player.focus({ preventScroll: true });
  if (button !== heldButton || !holdConsumed) activate(button);
});

player.addEventListener("click", event => {
  const button = event.target.closest("[data-input]");
  if (!button || (event.detail && performance.now() - suppressedClick < 400)) return;
  if (event.detail) player.focus({ preventScroll: true });
  if (button === heldButton && holdConsumed && event.detail) {
    holdConsumed = false;
    return;
  }
  activate(button);
});

const keyActions = new Map([
  ["ArrowUp", Input.Up], ["ArrowDown", Input.Down], [" ", Input.Play], ["ArrowLeft", Input.Previous],
  ["ArrowRight", Input.Next], ["[", Input.Previous], ["]", Input.Next],
]);

document.addEventListener("keydown", (event) => {
  if (!demo || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
  if (event.target !== document.body && !player.contains(event.target)) return;
  const onButton = event.target instanceof HTMLButtonElement;
  const returnKey = event.key === "Escape" || event.key === "Backspace";
  if (returnKey || (event.key === "Enter" && (!onButton || event.target === center))) {
    event.preventDefault();
    if (!event.repeat) {
      heldKey = event.key;
      startHold(returnKey ? back : center);
    }
    return;
  }
  if (onButton && event.key === " ") return;
  if (!keyActions.has(event.key)) return;
  event.preventDefault();
  const input = keyActions.get(event.key);
  if (input === Input.Up || input === Input.Down) nudgeWheel(input);
  else if (!event.repeat) send(input);
});

document.addEventListener("keyup", (event) => {
  if (event.key !== heldKey) return;
  event.preventDefault();
  stopHold();
  if (!holdConsumed) send(heldButton === back ? Input.Back : Input.Select);
});

player.addEventListener("focusout", (event) => {
  if (!player.contains(event.relatedTarget)) stopHold();
});
window.addEventListener("blur", () => {
  clearScreenPress();
  stopHold();
  if (gesture?.rotated || wheelTimer !== undefined) finishWheel();
  gesture = undefined;
});
retry.addEventListener("click", loadPlayer);
document.querySelector(".audio-retry").addEventListener("click", () => {
  if (!demo) return;
  preview.reset();
  preview.unlock();
  preview.sync(demo);
  player.focus();
});

// Browsers suspend animation frames in hidden tabs. Keep queue boundaries
// and the sleep timer active while audio is playing in the background.
let backgroundTimer;
function visibilityChanged() {
  clearInterval(backgroundTimer);
  if (document.hidden) {
    backgroundTimer = setInterval(() => {
      if (demo?.demo_playing()) draw(performance.now());
    }, 250);
  } else if (demo) draw(performance.now());
}
document.addEventListener("visibilitychange", visibilityChanged);
window.addEventListener("pagehide", () => {
  clearInterval(backgroundTimer);
});
window.addEventListener("pageshow", visibilityChanged);

preview.bindToggle(() => demo);
loadPlayer();
