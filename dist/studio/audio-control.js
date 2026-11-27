"use strict";

// The player's transport and volume settings keep working independently of
// the visitor's permission to hear the browser preview.
class ShowcaseAudio extends PreviewAudio {
  #muted = true;

  unlock() {
    if (!this.#muted) super.unlock();
  }

  sync(demo) {
    if (!this.#muted) super.sync(demo);
  }

  bindToggle(currentDemo) {
    const toggle = document.querySelector("#audio-toggle");
    const updateLabel = () => {
      toggle.title = this.#muted ? "Unmute" : "Mute";
      toggle.setAttribute("aria-label", toggle.title);
    };
    toggle.addEventListener("click", event => {
      if (!event.isTrusted) return;
      this.#muted = !this.#muted;
      updateLabel();
      if (this.#muted) {
        this.mute();
        return;
      }
      // Create or resume the AudioContext while the trusted click is active.
      this.unlock();
      const demo = currentDemo();
      if (demo) this.sync(demo);
    });
    window.addEventListener("pagehide", () => {
      this.mute();
      updateLabel();
    });
  }

  mute() {
    this.#muted = true;
    this.setVolume(0);
    this.reset();
  }

  issue() {
    if (!this.#muted) super.issue();
  }
}
