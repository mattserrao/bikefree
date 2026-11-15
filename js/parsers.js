// Pure byte parsers/encoders. No browser APIs here so they can be unit-tested in Node.

// ---------- FTMS (Fitness Machine Service) ----------

/**
 * Parse an FTMS Indoor Bike Data notification (0x2AD2).
 * @param {DataView} dv
 * @returns {{speedKph?:number, cadenceRpm?:number, distanceM?:number, resistance?:number,
 *            powerW?:number, heartRate?:number, elapsedS?:number}}
 */
export function parseIndoorBikeData(dv) {
  const flags = dv.getUint16(0, true);
  let i = 2;
  const out = {};
  // Bit 0 is "More Data": when 0, Instantaneous Speed IS present.
  if (!(flags & 0x0001)) { out.speedKph = dv.getUint16(i, true) / 100; i += 2; }
  if (flags & 0x0002) { i += 2; } // average speed
  if (flags & 0x0004) { out.cadenceRpm = dv.getUint16(i, true) / 2; i += 2; }
  if (flags & 0x0008) { i += 2; } // average cadence
  if (flags & 0x0010) { out.distanceM = dv.getUint16(i, true) | (dv.getUint8(i + 2) << 16); i += 3; }
  if (flags & 0x0020) { out.resistance = dv.getInt16(i, true); i += 2; }
  if (flags & 0x0040) { out.powerW = dv.getInt16(i, true); i += 2; }
  if (flags & 0x0080) { i += 2; } // average power
  if (flags & 0x0100) { i += 5; } // expended energy: total(2) + per hour(2) + per minute(1)
  if (flags & 0x0200) { out.heartRate = dv.getUint8(i); i += 1; }
  if (flags & 0x0400) { i += 1; } // metabolic equivalent
  if (flags & 0x0800) { out.elapsedS = dv.getUint16(i, true); i += 2; }
  return out;
}

export const FTMS_OP = {
  REQUEST_CONTROL: 0x00,
  RESET: 0x01,
  SET_TARGET_RESISTANCE: 0x04,
  SET_TARGET_POWER: 0x05,
  START_RESUME: 0x07,
  STOP_PAUSE: 0x08,
  SET_SIM_PARAMS: 0x11,
  RESPONSE: 0x80,
};

export const FTMS_RESULT = {
  0x01: 'Success',
  0x02: 'Op code not supported',
  0x03: 'Invalid parameter',
  0x04: 'Operation failed',
  0x05: 'Control not permitted',
};

export function encodeRequestControl() {
  return new Uint8Array([FTMS_OP.REQUEST_CONTROL]);
}

export function encodeStart() {
  return new Uint8Array([FTMS_OP.START_RESUME]);
}

/** ERG: hold a target power in watts. */
export function encodeTargetPower(watts) {
  const b = new Uint8Array(3);
  const dv = new DataView(b.buffer);
  b[0] = FTMS_OP.SET_TARGET_POWER;
  dv.setInt16(1, Math.round(watts), true);
  return b;
}

/**
 * SIM: indoor bike simulation parameters.
 * @param {number} gradePct  grade in percent (e.g. 3.5)
 * @param {object} [o]
 * @param {number} [o.windMps=0]  wind speed m/s
 * @param {number} [o.crr=0.004]  rolling resistance coefficient
 * @param {number} [o.cw=0.51]    wind resistance coefficient kg/m
 */
export function encodeSimParams(gradePct, { windMps = 0, crr = 0.004, cw = 0.51 } = {}) {
  const b = new Uint8Array(7);
  const dv = new DataView(b.buffer);
  b[0] = FTMS_OP.SET_SIM_PARAMS;
  dv.setInt16(1, Math.round(windMps * 1000), true);
  dv.setInt16(3, Math.round(gradePct * 100), true);
  dv.setUint8(5, Math.max(0, Math.min(255, Math.round(crr * 10000))));
  dv.setUint8(6, Math.max(0, Math.min(255, Math.round(cw * 100))));
  return b;
}

/** Parse an FTMS control point indication: [0x80, requestOp, result]. */
export function parseControlPointResponse(dv) {
  if (dv.byteLength < 3 || dv.getUint8(0) !== FTMS_OP.RESPONSE) return null;
  const requestOp = dv.getUint8(1);
  const result = dv.getUint8(2);
  return { requestOp, result, ok: result === 0x01, text: FTMS_RESULT[result] || `Unknown (${result})` };
}

// ---------- Cycling Power Measurement (0x2A63) — cadence fallback ----------

/**
 * Parse a Cycling Power Measurement. Returns power and crank revolution data if present.
 * @returns {{powerW:number, crankRevs?:number, crankTime?:number}}
 */
export function parseCyclingPower(dv) {
  const flags = dv.getUint16(0, true);
  let i = 2;
  const out = { powerW: dv.getInt16(i, true) };
  i += 2;
  if (flags & 0x0001) i += 1; // pedal power balance
  if (flags & 0x0004) i += 2; // accumulated torque
  if (flags & 0x0010) i += 6; // wheel revolution data
  if (flags & 0x0020) {
    out.crankRevs = dv.getUint16(i, true);
    out.crankTime = dv.getUint16(i + 2, true); // 1/1024 s
    i += 4;
  }
  return out;
}

/** Cadence from two crank samples (handles 16-bit rollover). Returns null if no new revolution. */
export function cadenceFromCrank(prev, cur) {
  if (!prev || prev.crankRevs == null || cur.crankRevs == null) return null;
  const dRevs = (cur.crankRevs - prev.crankRevs + 0x10000) & 0xffff;
  const dTime = (cur.crankTime - prev.crankTime + 0x10000) & 0xffff;
  if (dRevs === 0 || dTime === 0) return null;
  return (dRevs * 60 * 1024) / dTime;
}

// ---------- Zwift Ride controller ----------

export const RIDE_ON = new Uint8Array([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]); // "RideOn"

export const ZWIFT_OPCODE = {
  0x19: 'BATTERY_NOTIF',
  0x23: 'CONTROLLER_NOTIFICATION',
  0x2a: 'LOG_DATA',
  0x3c: 'GET_RESPONSE',
  0x3e: 'STATUS_RESPONSE',
  0x52: 'RIDE_ON',
  0xfe: 'LOST_CONTROL',
  0xff: 'VENDOR_MESSAGE',
};

// Bit masks in the ButtonMap. A bit of 0 means PRESSED; 1 means released.
export const RIDE_BUTTONS = [
  ['navLeft', 0x00001],
  ['navUp', 0x00002],
  ['navRight', 0x00004],
  ['navDown', 0x00008],
  ['A', 0x00010],
  ['B', 0x00020],
  ['Y', 0x00040],
  ['Z', 0x00080],
  ['shiftUpLeft', 0x00100],
  ['shiftDownLeft', 0x00200],
  ['powerUpLeft', 0x00400],
  ['onOffLeft', 0x00800],
  ['shiftUpRight', 0x01000],
  ['shiftDownRight', 0x02000],
  ['powerUpRight', 0x04000],
  ['onOffRight', 0x08000],
];

export const PADDLE_THRESHOLD = 25; // analog 0-100; ignore light touches

/** Read a protobuf varint. Returns [value, nextIndex]. */
export function readVarint(bytes, i) {
  let result = 0;
  let shift = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, i];
    shift += 7;
  }
  throw new Error('Truncated varint');
}

function zigzag(n) {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}

/** Skip an unknown protobuf field. Returns next index. */
function skipField(bytes, i, wireType) {
  if (wireType === 0) return readVarint(bytes, i)[1];
  if (wireType === 1) return i + 8;
  if (wireType === 2) { const [len, j] = readVarint(bytes, i); return j + len; }
  if (wireType === 5) return i + 4;
  throw new Error(`Unsupported wire type ${wireType}`);
}

/**
 * Decode a RideKeyPadStatus protobuf (the bytes AFTER the 0x23 opcode).
 * Field 1: ButtonMap (uint32). Field 3: repeated RideAnalogKeyPress {1: location enum, 2: sint32 value}.
 */
export function decodeRideKeyPad(bytes) {
  let buttonMap = null;
  const paddles = [];
  let i = 0;
  while (i < bytes.length) {
    const [tag, j] = readVarint(bytes, i);
    i = j;
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1 && wire === 0) {
      [buttonMap, i] = readVarint(bytes, i);
    } else if (field === 3 && wire === 2) {
      const [len, k] = readVarint(bytes, i);
      const end = k + len;
      let p = k;
      const paddle = { location: 0, value: 0 };
      while (p < end) {
        const [t, q] = readVarint(bytes, p);
        p = q;
        const f = Math.floor(t / 8);
        const w = t & 7;
        if (f === 1 && w === 0) { [paddle.location, p] = readVarint(bytes, p); }
        else if (f === 2 && w === 0) { let v; [v, p] = readVarint(bytes, p); paddle.value = zigzag(v); }
        else p = skipField(bytes, p, w);
      }
      paddles.push(paddle);
      i = end;
    } else {
      i = skipField(bytes, i, wire);
    }
  }
  return { buttonMap, paddles };
}

/** Names of pressed buttons from a decoded keypad status. */
export function pressedButtons({ buttonMap, paddles }) {
  const pressed = [];
  if (buttonMap != null) {
    for (const [name, mask] of RIDE_BUTTONS) {
      if ((buttonMap & mask) === 0) pressed.push(name);
    }
  }
  for (const p of paddles) {
    if (Math.abs(p.value) >= PADDLE_THRESHOLD) {
      if (p.location === 0) pressed.push('paddleLeft');
      else if (p.location === 1) pressed.push('paddleRight');
    }
  }
  return pressed;
}

/** Map a pressed button to a shift direction (+1 harder, -1 easier, 0 none). Used from v0.2. */
export function shiftDirection(name) {
  if (['shiftUpRight', 'shiftDownRight', 'paddleRight', 'powerUpRight'].includes(name)) return +1;
  if (['shiftUpLeft', 'shiftDownLeft', 'paddleLeft', 'powerUpLeft'].includes(name)) return -1;
  return 0;
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}
