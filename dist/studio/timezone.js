"use strict";

// The host supplies wall time. WASM owns the selected zone and clock display.
class PlayerWallClock {
  constructor(decoder) {
    this.decoder = decoder;
  }

  sync(demo, epoch = Date.now()) {
    const id = this.decoder.decode(new Uint8Array(
      demo.memory.buffer, demo.demo_timezone_ptr(), demo.demo_timezone_len(),
    ));
    const utcMinute = Math.floor(epoch / 60000);
    if (this.demo === demo && this.id === id && this.utcMinute === utcMinute) return;
    if (this.id !== id) {
      this.id = id;
      this.fixedOffset = new Map([
        ["<-12>12", -720], ["CST6", -360], ["<+0330>-3:30", 210], ["<+12>-12", 720],
      ]).get(id);
      this.format = undefined;
      if (this.fixedOffset === undefined) {
        try {
          this.format = new Intl.DateTimeFormat("en", {
            timeZone: id, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
          });
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          // Coyhaique joined IANA in 2025b. Older Intl tables lack its name.
          // It has observed UTC−03 year-round since the split from Santiago.
          if (id === "America/Coyhaique" && epoch >= Date.UTC(2025, 2, 20)) this.fixedOffset = -180;
        }
      }
    }
    this.demo = demo;
    this.utcMinute = utcMinute;
    if (this.fixedOffset !== undefined) {
      demo.demo_local_minutes(((utcMinute + this.fixedOffset) % 1440 + 1440) % 1440);
    } else if (this.format) {
      const parts = this.format.formatToParts(epoch);
      const hour = Number(parts.find(part => part.type === "hour").value);
      const minute = Number(parts.find(part => part.type === "minute").value);
      demo.demo_local_minutes((hour % 24) * 60 + minute);
    } else {
      demo.demo_local_minutes(1440);
    }
  }
}
