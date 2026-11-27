// Discover navigation by replaying button inputs on the packaged player.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// This function is included verbatim in the browser's generated map.
function q2ScreenState(label) {
  const [screen, first = "", afterClock = ""] = label.split(" · ");
  const clock = /^(?:—:—|\d{1,2}:\d{2}(?: [AP]M)?)$/;
  const detail = clock.test(first) ? afterClock : first;
  const transport = /^(?:Playing|Paused|Stopped|Buffering) (.+ by .+)$/u.exec(detail);
  if (transport) return {screen, selection: screen === "Now Playing" ? transport[1] : ""};
  // These messages can appear immediately after the title of an unlabelled widget.
  const status = /^(?:Nothing playing|Volume \d+%|Unavailable offline|Not downloaded|Radio needs a connection|This book has no chapters)$/u;
  return {screen, selection: status.test(detail) ? "" : detail};
}

const MAX_WITNESSES = 75_000;
const MAX_INPUT_DEPTH = 700;
const CONTEXTS_PER_LABEL = 16;
const TOUR_BUTTONS = ["Up", "Down", "Select", "Back"];
const BUTTONS = [...TOUR_BUTTONS, "HoldCenter", "HoldBack", "Previous", "Next", "Play"];
const WHEEL = new Set(["Up", "Down"]);
const stateKey = ({screen, selection}) => JSON.stringify([screen, selection]);

function packagedInputs(path) {
  const block = /^const Input = \{([^}]+)\};/mu.exec(readFileSync(path, "utf8"));
  if (!block) throw new Error("Missing Input codes in the packaged demo script");
  const entries = block[1].trim().replace(/,$/u, "").split(",").map(entry => {
    const match = /^\s*(\w+):\s*(\d+)\s*$/u.exec(entry);
    if (!match) throw new Error(`Unexpected packaged input definition ${entry}`);
    return [match[1], Number(match[2])];
  });
  const codes = Object.fromEntries(entries);
  if (entries.length !== BUTTONS.length + 1 || new Set(Object.values(codes)).size !== entries.length ||
      ![...BUTTONS, "WheelEnd"].every(name => Object.hasOwn(codes, name))) {
    throw new Error("Packaged controls changed; review the screen map exploration inputs");
  }
  return codes;
}

function openPlayer(wasm, codes) {
  const {exports: demo} = new WebAssembly.Instance(new WebAssembly.Module(wasm));
  const decoder = new TextDecoder("utf-8", {fatal: true});
  function read() {
    const length = demo.demo_label_len() >>> 0;
    const pointer = demo.demo_label() >>> 0;
    const label = decoder.decode(new Uint8Array(demo.memory.buffer, pointer, length));
    const state = q2ScreenState(label);
    if (!state.screen) throw new Error(`Player returned an empty screen title: ${JSON.stringify(label)}`);
    return {...state, label, mediaKind: demo.demo_media_kind(), online: demo.demo_online(), playing: Boolean(demo.demo_playing())};
  }
  function send(input) {
    demo.demo_input(codes[input]);
  }
  function press(input) {
    send(input);
    if (WHEEL.has(input)) send("WheelEnd");
  }
  function restore(path) {
    demo.demo_init();
    for (const input of path) press(input);
  }
  function eqControls(path) {
    restore(path);
    demo.demo_frame(0);
    // Locate the row of ten separate touch targets on the Q2's 375 × 320 screen.
    let centers;
    let top;
    let bottom;
    for (let y = 0; y < 320; y++) {
      const row = [];
      for (let x = 0; x < 375; x++) {
        if (!demo.demo_clickable(x, y)) continue;
        const left = x;
        while (x + 1 < 375 && demo.demo_clickable(x + 1, y)) x++;
        row.push(Math.floor((left + x) / 2));
      }
      if (row.length !== 10) continue;
      if (centers && (bottom !== y - 1 || row.some((x, i) => x !== centers[i]))) {
        throw new Error("Ambiguous Graphic EQ touch targets");
      }
      centers = row;
      top ??= y;
      bottom = y;
    }
    if (!centers || bottom - top < 24) throw new Error("Missing Graphic EQ band controls");
    return {centers, neutralY: Math.round((top + bottom) / 2)};
  }
  return {read, send, press, restore, eqControls};
}

function discover(player, {prefix = [], stopAt} = {}) {
  const nodes = [];
  const witnesses = [];
  const known = new Map();
  const candidates = [];
  const queued = new Set();
  const explored = new Map();
  let probes = 0;
  let contexts = 0;
  let hit;

  function nodeFor(state, path) {
    const key = stateKey(state);
    if (!known.has(key)) {
      known.set(key, nodes.length);
      nodes.push({screen: state.screen, selection: state.selection, edges: {}});
      witnesses.push(path);
    }
    const id = known.get(key);
    if (hit === undefined && stopAt && state.screen === stopAt.screen &&
        (stopAt.selection === undefined || state.selection === stopAt.selection)) hit = id;
    return id;
  }

  function queue(id, from, input, state, path, varied = false) {
    // HoldBack can open the same track above every screen. The ordinary album,
    // station and book arrivals already expose its controls and play context.
    const arrival = input === "HoldBack" && state.screen === "Now Playing" ? null : from;
    const key = JSON.stringify([id, arrival, input, Boolean(state.mediaKind), state.online, varied]);
    if (queued.has(key)) return;
    if (path.length > MAX_INPUT_DEPTH || candidates.length >= MAX_WITNESSES) {
      throw new Error(`Navigation exploration limit reached at ${state.label} (${candidates.length} witnesses, ${path.length} inputs, ${nodes.length} labels)`);
    }
    queued.add(key);
    candidates.push({id, path, varied});
  }

  function observe({id, path, varied}, input, state) {
    const nextPath = [...path, input];
    const seen = known.has(stateKey(state));
    const nextId = nodeFor(state, nextPath);
    if (id === nextId) return;
    const node = nodes[id];
    if (!Object.hasOwn(node.edges, input)) {
      node.edges[input] = nextId;
    } else if (node.edges[input] !== nextId) {
      node.alternatives ??= {};
      node.alternatives[input] ??= [];
      if (!node.alternatives[input].includes(nextId)) node.alternatives[input].push(nextId);
    }
    // Sample newly revealed rows and screens after a silent change. Existing
    // labels retain ordinary witnesses, avoiding a cross-product of settings.
    if (!varied || !seen) queue(nextId, id, input, state, nextPath, varied);
  }

  player.restore(prefix);
  const initial = player.read();
  const start = nodeFor(initial, []);
  queue(start, null, null, initial, []);
  for (let index = 0; index < candidates.length && hit === undefined; index++) {
    const candidate = candidates[index];
    const {id, path, varied} = candidate;
    const replay = [...prefix, ...path];
    player.restore(replay);
    const state = player.read();
    if (stateKey(state) !== stateKey(nodes[id])) throw new Error(`Non-reproducible screen ${state.label}`);
    // Identical labels can have different parents (for example, Book Info or an album).
    player.press("Back");
    const back = player.read();
    probes++;
    observe(candidate, "Back", back);
    if (hit !== undefined) break;
    const context = JSON.stringify([stateKey(back), Boolean(state.mediaKind), state.online, varied]);
    const used = explored.get(id) ?? new Set();
    if (used.has(context) || used.size >= CONTEXTS_PER_LABEL) continue;
    used.add(context);
    explored.set(id, used);
    contexts++;

    for (const input of BUTTONS) {
      if (input === "Back") continue;
      player.restore(replay);
      player.press(input);
      const next = player.read();
      probes++;
      // One unlabelled Select can reveal conditional settings or submit a
      // one-character search. Keep these witnesses bounded as text is unbounded.
      if (!varied && !state.mediaKind && state.selection && input === "Select" && stateKey(next) === stateKey(state)) {
        queue(id, id, input, next, [...path, input], true);
      } else {
        observe(candidate, input, next);
      }
      if (hit !== undefined) break;
    }
  }

  return {start, nodes, witnesses, known, probes, contexts, hit};
}

function qualify(player, {start, nodes, witnesses, known}) {
  function requireNode(screen, selection) {
    const id = known.get(stateKey({screen, selection}));
    if (id === undefined) throw new Error(`Missing tour target ${screen} · ${selection}`);
    return id;
  }

  function requireArrival(target, row, playing = false) {
    const candidates = nodes.flatMap(({selection}, id) => row.test(selection) ? [id] : []);
    candidates.sort((a, b) => witnesses[a].length - witnesses[b].length);
    for (const from of candidates) {
      player.restore(witnesses[from]);
      player.press("Select");
      const state = player.read();
      if (stateKey(state) === stateKey(nodes[target]) && (!playing || state.playing)) {
        return {from, input: "Select"};
      }
    }
    throw new Error(`No matching Select arrival into ${nodes[target].screen} from a row matching ${row}`);
  }

  const home = start;
  if (nodes[home].screen !== "Q2") throw new Error("The packaged player no longer starts on the Q2 home screen");
  // Start at the featured album and discover the covers beyond it. Reversing
  // that list gives the tour a single sweep ending on the album it will open.
  const featuredCover = requireNode("Cover Flow", "Cylinders");
  player.restore(witnesses[featuredCover]);
  const sleeves = [featuredCover];
  while (true) {
    player.press("Down");
    const state = player.read();
    const id = requireNode("Cover Flow", state.selection);
    if (state.screen !== "Cover Flow") throw new Error(`Cover Flow wheel left Cover Flow for ${state.label}`);
    if (id === sleeves.at(-1)) break;
    if (sleeves.includes(id)) throw new Error("Cover Flow wheel no longer stops at the last album");
    sleeves.push(id);
  }
  if (sleeves.length < 2) throw new Error("Cover Flow tour must advance across multiple albums");
  for (const id of sleeves.slice(0, -1).reverse()) {
    player.press("Up");
    if (stateKey(player.read()) !== stateKey(nodes[id])) throw new Error("Cover Flow wheel could not retrace the album order");
  }

  const targets = {
    home, sleeves: sleeves.reverse(),
    playing: requireNode("Now Playing", "Cylinder One by Chris Zabriskie"),
    download: requireNode("Downloads", "Cylinders"),
    book: requireNode("Book Info", ""),
    radio: requireNode("Featured Stations", "FIP"),
    sound: requireNode("Graphic EQ", ""),
  };
  const targetArrivals = {
    playing: requireArrival(targets.playing, /^(?:\d+\. )?Cylinder One$/u, true),
    book: requireArrival(targets.book, /^The Wonderful Wizard of Oz$/u),
  };
  const keyframes = [...Object.values(targets).flat(), ...Object.values(targetArrivals).map(({from}) => from)];
  for (const from of keyframes) {
    const reachable = new Set([from]);
    for (const id of reachable) {
      for (const input of TOUR_BUTTONS) {
        const next = nodes[id].edges[input];
        if (next !== undefined) reachable.add(next);
        for (const alternative of nodes[id].alternatives?.[input] ?? []) reachable.add(alternative);
      }
    }
    const missing = keyframes.find(id => !reachable.has(id));
    if (missing !== undefined) {
      throw new Error(`Tour target ${nodes[missing].screen} is unreachable from ${nodes[from].screen}`);
    }
  }
  return {targets, targetArrivals};
}

function findPath(player, target, prefix) {
  const {hit, nodes, witnesses} = discover(player, {prefix, stopAt: target});
  if (hit === undefined) {
    const selection = target.selection === undefined ? "" : ` · ${target.selection}`;
    throw new Error(`No observed path to ${target.screen}${selection}`);
  }
  const path = witnesses[hit];
  player.restore([...prefix, ...path]);
  const state = player.read();
  if (stateKey(state) !== stateKey(nodes[hit])) throw new Error(`Non-reproducible path ended at ${state.label}`);
  return {label: state.label, path};
}

function buildTimeline(player, map, known, chapters) {
  const expected = Object.keys(map.targets).filter(name => name !== "home");
  const missing = expected.filter(name => !chapters.includes(name));
  const extra = chapters.filter(name => !expected.includes(name));
  if (missing.length || extra.length || chapters.length !== expected.length) {
    throw new Error(`Tour chapters differ from generated screen targets (${[...missing, ...extra].join(", ") || "duplicate IDs"})`);
  }
  if (chapters[0] !== "sleeves") throw new Error("The tour must open on the Cover Flow chapter");

  const source = readFileSync(new URL("../dist/studio/route-planner.js", import.meta.url), "utf8");
  const createPlanner = runInNewContext(`${source}\nq2RoutePlanner;`, {}, {filename: "route-planner.js"});
  const plan = createPlanner(map);
  let spinning;
  player.restore([]);

  function observe() {
    const state = player.read();
    const id = known.get(stateKey(state));
    if (id === undefined) throw new Error(`Timeline reached unmapped state ${state.label}`);
    return {id, state};
  }

  function endSpin() {
    if (!spinning) return;
    const before = observe();
    player.send("WheelEnd");
    spinning = undefined;
    const after = observe();
    if (after.id !== before.id) {
      throw new Error(`Finishing a timeline wheel gesture changed ${before.state.label} to ${after.state.label}`);
    }
  }

  function step(action, steps) {
    if (spinning && action !== spinning) endSpin();
    const from = observe().id;
    player.send(action);
    if (WHEEL.has(action)) spinning = action;
    const result = observe();
    steps.push({action, from, to: result.id});
    return result;
  }

  function navigate(name, steps) {
    const value = map.targets[name];
    const goal = Array.isArray(value) ? value[0] : value;
    const arrival = map.targetArrivals[name];
    const visits = new Map();
    const observed = new Map();
    for (let i = 0; i < MAX_INPUT_DEPTH; i++) {
      const {id} = observe();
      if (!arrival && id === goal) {
        endSpin();
        return;
      }
      const entry = arrival?.from === id;
      const action = entry ? arrival.input : plan.nextInput(id, arrival?.from ?? goal, observed);
      const visit = `${id}:${action}`;
      const attempts = (visits.get(visit) ?? 0) + 1;
      visits.set(visit, attempts);
      if (attempts > 3 || ![...TOUR_BUTTONS, "HoldCenter"].includes(action)) break;
      const result = step(action, steps);
      if (action !== "Back") {
        if (!observed.has(id)) observed.set(id, new Map());
        observed.get(id).set(action, result.id);
      }
      if (entry) {
        if (result.id !== goal || (name === "playing" && !result.state.playing)) {
          throw new Error(`Timeline selected the entry for ${name} but reached ${result.state.label}`);
        }
        endSpin();
        return;
      }
    }
    throw new Error(`Timeline could not reach ${name} from ${observe().state.label}`);
  }

  const intro = [];
  navigate(chapters[0], intro);
  const segments = chapters.slice(1).map((to, index) => {
    const from = chapters[index];
    const steps = [];
    if (from === "sleeves") {
      for (const cover of map.targets.sleeves.slice(1)) {
        const result = step("Up", steps);
        if (result.id !== cover) throw new Error(`Timeline wheel did not reach the next cover from ${result.state.label}`);
      }
      endSpin();
      const album = observe().state.selection;
      const opened = step("Select", steps);
      if (opened.state.screen !== album) throw new Error(`Center did not open the selected album ${album}`);
    }
    navigate(to, steps);
    return {from, to, steps};
  });
  return {intro, segments};
}

function main() {
  const [wasmPath, devicePath, option, ...query] = process.argv.slice(2);
  const startOption = query.indexOf("--from");
  const [screen, selection, ...extraTarget] = startOption === -1 ? query : query.slice(0, startOption);
  const [startScreen, startSelection, ...extraStart] = startOption === -1 ? [] : query.slice(startOption + 1);
  const validPath = option === "--path" && screen && (startOption === -1 || startScreen) && !extraTarget.length && !extraStart.length;
  const validChapters = option === "--chapters" && query.length === 1;
  if (!wasmPath || !devicePath || (option && !validPath && !validChapters)) {
    throw new Error("Usage: node map-screens.mjs PLAYER.wasm PACKAGED-DEMO.js [--chapters JSON | --path SCREEN [SELECTION] [--from SCREEN [SELECTION]]]");
  }
  const wasm = readFileSync(wasmPath === "-" ? 0 : wasmPath);
  const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
  const player = openPlayer(wasm, packagedInputs(devicePath));
  if (option === "--path") {
    const from = startScreen ? findPath(player, {screen: startScreen, selection: startSelection}, []) : undefined;
    const result = findPath(player, {screen, selection}, from?.path ?? []);
    console.log(JSON.stringify({wasmSha256, from, ...result}, null, 2));
    return;
  }
  const {nodes, start, probes, contexts, known, witnesses} = discover(player);
  const {targets, targetArrivals} = qualify(player, {nodes, start, known, witnesses});
  const map = {
    wasmSha256, start, targets, targetArrivals,
    coverage: {probes, contexts, contextsPerLabel: CONTEXTS_PER_LABEL, screens: new Set(nodes.map(node => node.screen)).size},
    nodes,
  };
  const chapters = validChapters ? JSON.parse(query[0]) : Object.keys(targets).filter(name => name !== "home");
  if (!Array.isArray(chapters)) throw new Error("Chapter order must be a JSON array of IDs");
  const timeline = buildTimeline(player, map, known, chapters);
  const eqControls = player.eqControls(witnesses[targets.sound]);
  const fields = Object.entries({wasmSha256, start, targets, targetArrivals, eqControls, coverage: map.coverage, timeline})
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  process.stdout.write([
    "// Generated by simulator/map-screens.mjs from the packaged player.",
    "// Edges represent observed labels under button input. Back and other inputs can depend on the arrival history.",
    "// This fixture map holds time still, sends no screen taps, and samples at most one unlabelled Select per witness.",
    "// Timeline wheel ticks in the same direction form one gesture and finish before the next action or chapter.",
    q2ScreenState.toString(), "",
    "const q2ScreenMap = {", ...fields, '  "nodes": [',
    nodes.map(node => `    ${JSON.stringify(node)}`).join(",\n"),
    "  ]", "};", "",
  ].join("\n"));
}

try {
  main();
} catch (error) {
  console.error(`map-screens: ${error.message}`);
  process.exitCode = 1;
}
