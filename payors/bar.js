import { Bar as b, Presets as p } from "cli-progress";

class BarPolyfill {
  constructor(options, preset) {
    // noinspection JSUnusedGlobalSymbols
    this._options = options;
    // noinspection JSUnusedGlobalSymbols
    this._preset = preset;
    this._total = 0;
    this._current = 0;
  }

  start(total, value) {
    this._total = total;
    this.update(value);
  }

  update(value) {
    this._current = value;
    this.render();
  }

  stop() {
    console.log("Completed");
  }

  render() {
    const percent = this._total / this._current;
    console.log(` ${this._current}/${this._total} - ${percent}%`);
  }
}

export const Bar = process.stdout.isTTY ? b : BarPolyfill;

export const Presets = p;
