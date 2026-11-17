// Keep the screen awake while riding (Screen Wake Lock API, Chrome 84+). The browser drops the lock whenever the
// tab is hidden or the Mac sleeps, so we ask again whenever it's wanted and the page is visible.
export class ScreenAwake {
  constructor(log = () => {}) {
    this.log = log;
    this.sentinel = null;
    this.wanted = false;
    this.supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    this._busy = false;
    if (this.supported) document.addEventListener('visibilitychange', () => this._sync());
  }

  /** @param {boolean} on  true while a ride is set up or a trainer is connected */
  want(on) {
    if (on === this.wanted && (!on || this.sentinel)) return;
    // still wanted but not held (a failed request): try again at most every 5 s
    if (on === this.wanted && Date.now() - (this._triedAt || 0) < 5000) return;
    this.wanted = on;
    this._sync();
  }

  async _sync() {
    if (!this.supported || this._busy) return;
    this._busy = true;
    try {
      if (this.wanted && !this.sentinel && document.visibilityState === 'visible') {
        this._triedAt = Date.now();
        this.sentinel = await navigator.wakeLock.request('screen');
        this.sentinel.addEventListener('release', () => { this.sentinel = null; });
        this.log('app', 'Screen will stay awake while you ride', 'debug');
      } else if (!this.wanted && this.sentinel) {
        const s = this.sentinel; this.sentinel = null;
        await s.release();
      }
    } catch (err) {
      this.log('app', `Could not keep the screen awake (${err.message})`, 'debug');
    } finally {
      this._busy = false;
    }
  }
}
