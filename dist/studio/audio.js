"use strict";

// Match the Q2 software mixer: half a decibel per step and hard mute at zero.
function outputGain(percent) {
  return percent === 0 ? 0 : 10 ** ((percent - 100) / 40);
}

// Rust owns queue timing, seeks, speed and volume. The browser supplies a
// looping excerpt at the corresponding point in that timeline.
class PreviewAudio {
  constructor(feedback) {
    this.feedback = feedback;
    this.generation = null;
    this.request = null;
  }

  unlock() {
    try {
      if (!this.context) {
        // Give continuous media more output headroom than a low-latency instrument.
        this.context = new AudioContext({ latencyHint: 0.08 });
        this.context.addEventListener("statechange", () => {
          if (this.context.state !== "running") this.stopSource();
        });
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.context.destination);
      }
      if (this.context.state !== "running" && !this.resuming) {
        this.resuming = this.context.resume().catch(() => this.issue()).finally(() => {
          this.resuming = null;
        });
      }
    } catch {
      this.issue();
    }
  }

  setVolume(percent) {
    if (!this.master || this.volume === percent) return;
    const gain = outputGain(percent);
    if (this.volume === undefined || percent === 0) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.value = gain;
    } else {
      this.master.gain.setTargetAtTime(gain, this.context.currentTime, 0.012);
    }
    this.volume = percent;
  }

  issue() {
    this.feedback.hidden = false;
  }

  stopSource() {
    if (!this.source) return;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  reset() {
    this.stopSource();
    this.request?.abort();
    this.request = null;
    this.buffer = null;
    this.key = null;
    this.loadFailed = false;
    this.generation = null;
    this.feedback.hidden = true;
  }

  async load(key) {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.key = key;
    this.loadFailed = false;
    this.buffer = null;
    this.feedback.hidden = true;
    try {
      const inline = document.getElementById("audio-" + key);
      let bytes;
      if (inline) {
        bytes = Uint8Array.from(atob(inline.textContent), ch => ch.charCodeAt(0)).buffer;
      } else {
        const response = await fetch("./audio-" + key + ".mp3", { signal: request.signal });
        if (!response.ok) throw new Error("Audio unavailable");
        bytes = await response.arrayBuffer();
      }
      const decoded = await this.context.decodeAudioData(bytes);
      if (!request.signal.aborted) this.buffer = decoded;
    } catch {
      if (!request.signal.aborted) {
        this.loadFailed = true;
        this.issue();
      }
    }
  }

  sync(demo) {
    if (!demo.demo_playing()) {
      this.stopSource();
      this.feedback.hidden = true;
      return;
    }
    if (!this.context) return;
    const generation = demo.demo_playback_generation();
    if (this.generation !== generation) {
      this.stopSource();
      this.generation = generation;
      const id = new TextDecoder().decode(new Uint8Array(demo.memory.buffer, demo.demo_media_id(), demo.demo_media_id_len()));
      const kind = demo.demo_media_kind();
      const key = kind === 1 ? id.replace(/-\d+$/, "") : kind === 2 ? "radio" : id.replace(/^demo-/, "");
      const track = Number(id.split("-").pop());
      this.trackOffset = kind === 1 ? ((track - 1) % 4) / 4 : 0;
      if (key !== this.key || this.loadFailed) this.load(key);
    }
    if (this.loadFailed) this.issue();
    this.setVolume(demo.demo_volume());
    if (this.context.state !== "running" || !this.buffer) return;
    const seek = demo.demo_seek_revision();
    const speed = demo.demo_speed_percent();
    if (this.seek !== seek || this.speed !== speed) this.stopSource();
    this.seek = seek;
    this.speed = speed;
    if (this.source) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.playbackRate.value = speed / 100;
    source.connect(this.master);
    const offset = demo.demo_position_ms() / 1000 + this.trackOffset * this.buffer.duration;
    source.start(0, offset % this.buffer.duration);
    this.source = source;
    this.feedback.hidden = true;
  }
}
