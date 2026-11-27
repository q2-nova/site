// Each scroll position names a pose on the input sequence rehearsed by the importer.
const q2Navigation = (() => {
  const map = q2ScreenMap;
  const key = ({screen, selection}) => JSON.stringify([screen, selection]);
  const ids = new Map(map.nodes.map((node, id) => [key(node), id]));
  const { nextInput } = q2RoutePlanner(map);
  const wheel = action => action === "Up" || action === "Down";
  const opposite = action => action === "Down" ? "Up" : "Down";
  const eqInterval = map.timeline.segments.findIndex(segment => segment.to === "sound");
  const eqStart = .52;
  const eqCurve = [4, 3, 1, -1, -2, -1, 1, 2, 1, 0];
  const steps = [...map.timeline.intro];
  let angle = -55;
  const segments = map.timeline.segments.map(segment => {
    const groups = [];
    const start = steps.length;
    for (const step of segment.steps) {
      const prev = groups.at(-1);
      if (wheel(step.action) && prev?.action === step.action) {
        prev.count++;
      } else {
        groups.push({action: step.action, start: steps.length, count: 1, angle});
      }
      if (wheel(step.action)) angle += step.action === "Down" ? 28 : -28;
      steps.push(step);
    }
    // Give the opening cover sweep room to browse. Each remaining gesture
    // gets a share of the distance, with extra travel for a long turn or hold.
    const weights = groups.map(g => wheel(g.action) ? .8 + .35 * g.count : g.action === "HoldCenter" ? 1.65 : 1);
    if (segment.from === "sleeves" && groups.length > 1 && wheel(groups[0].action)) {
      const remaining = weights.slice(1).reduce((a, b) => a + b, 0);
      // Keep the chosen sleeve on screen with the wheel released before pressing Center.
      groups.splice(1, 0, {start: groups[1].start, count: 0});
      weights.splice(0, 1, remaining * .45 / .36, remaining * .19 / .36);
    }
    const total = weights.reduce((a, b) => a + b, 0);
    let end = 0;
    groups.forEach((group, i) => {
      group.begin = end;
      end += weights[i] / total;
      group.end = end;
    });
    return {groups, start, end: steps.length};
  });

  function pose(interval, progress) {
    const {groups, start, end} = segments[interval];
    if (interval === eqInterval) {
      if (progress >= eqStart) return {cursor: end, eq: (progress - eqStart) / (1 - eqStart)};
      progress /= eqStart;
    }
    if (progress <= 0 || !groups.length) return {cursor: start};
    if (progress >= 1) return {cursor: end};
    const group = groups.find(g => progress < g.end) || groups.at(-1);
    if (!group.action) return {cursor: group.start};
    const phase = Math.min(1, (progress - group.begin) / (group.end - group.begin));
    const ticks = group.count * phase;
    const spinning = wheel(group.action);
    const completed = spinning ? Math.round(ticks) : Number(phase >= (group.action === "HoldCenter" ? .84 : .55));
    return {
      cursor: group.start + completed, action: group.action, phase,
      angle: group.angle + (spinning ? ticks * (group.action === "Down" ? 28 : -28) : 0)
    };
  }

  let cursor;
  let spin;
  let lastPosition;
  let reverse = false;
  let lastAction;
  let eqBands;
  function liveState() {
    const bytes = new Uint8Array(demo.memory.buffer, demo.demo_label() >>> 0, demo.demo_label_len() >>> 0);
    return q2ScreenState(decoder.decode(bytes));
  }
  const live = () => ids.get(key(liveState()));
  function endSpin() {
    if (spin && demo) demo.demo_input(Input.WheelEnd);
    spin = undefined;
  }
  function press(action) {
    if (action !== spin) endSpin();
    if (wheel(action)) spin = action;
    demo.demo_input(Input[action]);
    lastAction = action;
  }

  function applyEq(progress) {
    const bands = eqCurve.map(gain => Math.sign(gain) * Math.round(Math.abs(gain) * progress));
    if (bands.every((gain, index) => gain === eqBands?.[index])) return;
    endSpin();
    // The rendered Graphic EQ exposes its ten gain controls in framebuffer pixels.
    // Render after entering the screen so WASM has populated the tap hitboxes.
    demo.demo_frame(Math.max(0, Math.floor(performance.now() - started)));
    const tapBand = (index, gain) => {
      const {centers, neutralY} = map.eqControls;
      if (!demo.demo_click(centers[index], neutralY - gain * 5)) throw new Error("Cannot adjust the tour equalizer");
    };
    bands.forEach((gain, index) => {
      if (index && gain !== eqBands?.[index]) tapBand(index, gain);
    });
    // Leave the first band selected and the wheel ready to browse bands.
    tapBand(0, bands[0]);
    demo.demo_input(Input.Select);
    eqBands = bands;
  }

  // A manual detour or a context-dependent Back may leave a different menu
  // row selected. Find the requested row again with real controls.
  function align(goal) {
    const seen = new Map();
    const observed = new Map();
    let homeDirection = "Up";
    for (let count = 0; count < map.nodes.length; count++) {
      const state = liveState();
      const id = ids.get(key(state));
      if (id === goal) return true;
      // After a manual change a conditional home row may have no mapped ID.
      const unknownHome = id === undefined && state.screen === map.nodes[map.start].screen;
      const action = unknownHome ? homeDirection : nextInput(id, goal, observed);
      const visit = key(state) + "/" + action;
      seen.set(visit, (seen.get(visit) || 0) + 1);
      if (seen.get(visit) > 2) return false;
      press(action);
      if (unknownHome && key(liveState()) === key(state)) homeDirection = "Down";
      if (!observed.has(id)) observed.set(id, new Map());
      observed.get(id).set(action, live());
    }
    return false;
  }

  function advance(step) {
    if (live() !== step.from && !align(step.from)) return false;
    if (step.from === map.targets.sound) applyEq(1);
    press(step.action);
    return live() === step.to || align(step.to);
  }

  function retrace(step) {
    if (step.to === map.targets.sound && live() === step.to) applyEq(0);
    if (wheel(step.action)) press(opposite(step.action));
    else if (step.action !== "Back") press("Back");
    return live() === step.from || align(step.from);
  }

  function replay(target) {
    endSpin();
    if (!align(map.start)) throw new Error("Cannot return to the main menu");
    for (let i = 0; i < target; i++) {
      if (!advance(steps[i])) throw new Error("Cannot reach the tour position");
    }
    cursor = target;
  }

  function scrub(interval, progress, chassis) {
    if (!segments[interval] || !Number.isFinite(progress)) return;
    const p = pose(interval, Math.max(0, Math.min(1, progress)));
    const position = interval + progress;
    if (position !== lastPosition) reverse = position < lastPosition;
    lastPosition = position;
    lastAction = undefined;
    let error;
    playerInput(() => {
      try {
        if (cursor === undefined) replay(p.cursor);
        while (cursor < p.cursor) {
          if (!advance(steps[cursor])) { replay(p.cursor); break; }
          cursor++;
        }
        while (cursor > p.cursor) {
          if (!retrace(steps[cursor - 1])) { replay(p.cursor); break; }
          cursor--;
        }
        if (p.cursor === segments[eqInterval].end) applyEq(p.eq ?? Number(interval > eqInterval));
        if (!wheel(p.action)) endSpin();
      } catch (e) { error = e; }
    });
    if (error) throw error;
    if (!demo) throw new Error("Player unavailable");
    draw(performance.now());
    if (wheel(p.action)) {
      chassis.dataset.tourInput = reverse ? opposite(p.action) : p.action;
      chassis.style.setProperty("--tour-angle", p.angle + "deg");
    } else if (p.action && p.phase > .06 && p.phase < .94) {
      chassis.dataset.tourInput = reverse ? (lastAction || (p.action === "Back" ? "Select" : "Back")) : p.action;
      chassis.style.setProperty("--tour-hold", Math.min(1, p.phase / .84) + "turn");
    } else {
      delete chassis.dataset.tourInput;
    }
  }

  function interrupt(chassis) {
    endSpin();
    cursor = lastPosition = undefined;
    eqBands = undefined;
    delete chassis.dataset.tourInput;
  }
  return {scrub, interrupt};
})();
