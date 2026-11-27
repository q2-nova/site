// Shared by the live player and the importer that rehearses the scroll tour.
function q2RoutePlanner(q2ScreenMap) {
  const forward = ["Select", "Down", "Up", "HoldCenter"];
  const playbackScreen = q2ScreenMap.nodes[q2ScreenMap.targets.playing].screen;

  // Back depends on the path the visitor used to enter this screen. Search
  // forward from the current row first, then use a real Back and read it again.
  function nextInput(start, goal, observed) {
    if (start === undefined) return "Back";
    const seen = new Set([start]);
    const queue = [{ id: start, first: null }];
    for (let i = 0; i < queue.length; i++) {
      const { id, first } = queue[i];
      const node = q2ScreenMap.nodes[id];
      for (const action of forward) {
        const edges = observed.get(id);
        const dest = edges?.has(action) ? edges.get(action) : node.edges[action];
        if (dest == null || seen.has(dest)) continue;
        const destination = q2ScreenMap.nodes[dest];
        if (action === "HoldCenter") {
          // Open a contextual overlay only from its own parent state.
          if (destination.screen !== node.screen ||
              ![destination.edges.Back, ...(destination.alternatives?.Back ?? [])].includes(id)) continue;
        } else if (action === "Select") {
          // Use menu entries that open a screen and offer a way back. Applying
          // presets or confirming settings can also change screens, as a side effect.
          const parents = [destination.edges.Back, ...(destination.alternatives?.Back ?? [])];
          // Don't start another item as a shortcut to its playback menu.
          if (destination.screen === playbackScreen || node.screen === destination.screen ||
              !parents.some(parent => q2ScreenMap.nodes[parent]?.screen === node.screen)) continue;
        } else if (destination.screen !== node.screen) continue;
        if (dest === goal) return first || action;
        seen.add(dest);
        queue.push({ id: dest, first: first || action });
      }
    }
    return "Back";
  }

  return { nextInput };
}
