// Native popovers handle taps, keyboard activation, Escape and outside clicks.
for (const wrapper of document.querySelectorAll(".affiliate")) {
  const trigger = wrapper.querySelector("button");
  const note = wrapper.querySelector("[popover]");
  let hoverOnly = false;
  let closeTimer;

  function position() {
    if (!note.matches(":popover-open")) return;
    const anchor = trigger.getBoundingClientRect();
    const gap = 4;
    const left = Math.max(8, Math.min(anchor.left, document.documentElement.clientWidth - note.offsetWidth - 8));
    const top = anchor.bottom + gap + note.offsetHeight <= innerHeight
      ? anchor.bottom + gap : Math.max(8, anchor.top - note.offsetHeight - gap);
    note.style.setProperty("--note-left", left + "px");
    note.style.setProperty("--note-top", top + "px");
    note.dataset.anchored = "";
  }

  note.addEventListener("toggle", position);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, { passive: true });
  wrapper.addEventListener("pointerenter", event => {
    clearTimeout(closeTimer);
    if (event.pointerType !== "mouse" || note.matches(":popover-open")) return;
    note.showPopover();
    hoverOnly = true;
    position();
  });
  wrapper.addEventListener("pointerleave", () => {
    if (hoverOnly) closeTimer = setTimeout(() => {
      if (hoverOnly && !note.contains(document.activeElement)) note.hidePopover();
    }, 250);
  });
  // A click on a hover preview keeps it open for the next action.
  trigger.addEventListener("click", event => {
    if (hoverOnly && note.matches(":popover-open")) event.preventDefault();
    hoverOnly = false;
  });
}
