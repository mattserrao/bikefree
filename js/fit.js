// Minimal FIT (Garmin Flexible & Interoperable Data Transfer) activity encoder.
// Only the messages and fields bikefree needs. Verified against Garmin's decoder in tests.

const BASE = {
  enum: [0x00, 1, 0xff],
  uint8: [0x02, 1, 0xff],
  sint16: [0x83, 2, 0x7fff],
  uint16: [0x84, 2, 0xffff],
  sint32: [0x85, 4, 0x7fffffff],
  uint32: [0x86, 4, 0xffffffff],
  uint32z: [0x8c, 4, 0x00000000],
};

// [name, fieldNum, baseType, scale=1, offset=0]
const MESSAGES = {
  file_id: { num: 0, fields: [['type', 0, 'enum'], ['manufacturer', 1, 'uint16'], ['product', 2, 'uint16'],
    ['serial_number', 3, 'uint32z'], ['time_created', 4, 'uint32']] },
  event: { num: 21, fields: [['timestamp', 253, 'uint32'], ['event', 0, 'enum'], ['event_type', 1, 'enum']] },
  record: { num: 20, fields: [['timestamp', 253, 'uint32'], ['position_lat', 0, 'sint32'], ['position_long', 1, 'sint32'],
    ['altitude', 2, 'uint16', 5, 500], ['heart_rate', 3, 'uint8'], ['cadence', 4, 'uint8'],
    ['distance', 5, 'uint32', 100], ['speed', 6, 'uint16', 1000], ['power', 7, 'uint16'], ['grade', 9, 'sint16', 100]] },
  lap: { num: 19, fields: [['message_index', 254, 'uint16'], ['timestamp', 253, 'uint32'], ['event', 0, 'enum'],
    ['event_type', 1, 'enum'], ['start_time', 2, 'uint32'], ['total_elapsed_time', 7, 'uint32', 1000],
    ['total_timer_time', 8, 'uint32', 1000], ['total_distance', 9, 'uint32', 100], ['total_calories', 11, 'uint16'],
    ['avg_speed', 13, 'uint16', 1000], ['max_speed', 14, 'uint16', 1000], ['avg_heart_rate', 15, 'uint8'],
    ['max_heart_rate', 16, 'uint8'], ['avg_cadence', 17, 'uint8'], ['max_cadence', 18, 'uint8'],
    ['avg_power', 19, 'uint16'], ['max_power', 20, 'uint16'], ['total_ascent', 21, 'uint16'],
    ['lap_trigger', 24, 'enum'], ['sport', 25, 'enum']] },
  session: { num: 18, fields: [['message_index', 254, 'uint16'], ['timestamp', 253, 'uint32'], ['event', 0, 'enum'],
    ['event_type', 1, 'enum'], ['start_time', 2, 'uint32'], ['sport', 5, 'enum'], ['sub_sport', 6, 'enum'],
    ['total_elapsed_time', 7, 'uint32', 1000], ['total_timer_time', 8, 'uint32', 1000],
    ['total_distance', 9, 'uint32', 100], ['total_calories', 11, 'uint16'], ['avg_speed', 14, 'uint16', 1000],
    ['max_speed', 15, 'uint16', 1000], ['avg_heart_rate', 16, 'uint8'], ['max_heart_rate', 17, 'uint8'],
    ['avg_cadence', 18, 'uint8'], ['max_cadence', 19, 'uint8'], ['avg_power', 20, 'uint16'],
    ['max_power', 21, 'uint16'], ['total_ascent', 22, 'uint16'], ['first_lap_index', 25, 'uint16'],
    ['num_laps', 26, 'uint16']] },
  activity: { num: 34, fields: [['timestamp', 253, 'uint32'], ['total_timer_time', 0, 'uint32', 1000],
    ['num_sessions', 1, 'uint16'], ['type', 2, 'enum'], ['event', 3, 'enum'], ['event_type', 4, 'enum'],
    ['local_timestamp', 5, 'uint32']] },
};

export const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z
export const fitTime = (ms) => Math.round(ms / 1000) - FIT_EPOCH_S;
export const semicircles = (deg) => Math.round((deg * 2 ** 31) / 180);

export const SPORT_CYCLING = 2;
export const SUB_SPORT_INDOOR = 6;
export const SUB_SPORT_VIRTUAL = 58;

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

export function fitCrc(bytes, crc = 0) {
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

export class FitWriter {
  constructor() {
    this.chunks = [];
    this.size = 0;
    this.local = new Map(); // message name → local type
  }

  _push(u8) { this.chunks.push(u8); this.size += u8.length; }

  _define(name) {
    const spec = MESSAGES[name];
    const localType = this.local.size;
    if (localType > 15) throw new Error('Too many message types');
    const b = new Uint8Array(6 + spec.fields.length * 3);
    const dv = new DataView(b.buffer);
    b[0] = 0x40 | localType;
    b[1] = 0;         // reserved
    b[2] = 0;         // little endian
    dv.setUint16(3, spec.num, true);
    b[5] = spec.fields.length;
    spec.fields.forEach(([, num, type], i) => {
      b[6 + i * 3] = num;
      b[7 + i * 3] = BASE[type][1];
      b[8 + i * 3] = BASE[type][0];
    });
    this._push(b);
    this.local.set(name, localType);
    return localType;
  }

  /** Write a data message. Missing/undefined/null/NaN values become FIT "invalid". */
  write(name, values) {
    const spec = MESSAGES[name];
    if (!spec) throw new Error(`Unknown FIT message ${name}`);
    const localType = this.local.has(name) ? this.local.get(name) : this._define(name);
    const size = 1 + spec.fields.reduce((a, [, , t]) => a + BASE[t][1], 0);
    const b = new Uint8Array(size);
    const dv = new DataView(b.buffer);
    b[0] = localType;
    let i = 1;
    for (const [fname, , type, scale = 1, offset = 0] of spec.fields) {
      const [, len, invalid] = BASE[type];
      const raw = values[fname];
      let v = raw == null || Number.isNaN(raw) ? invalid : Math.round((raw + offset) * scale);
      const max = type.startsWith('sint') ? 2 ** (len * 8 - 1) - 2 : 2 ** (len * 8) - 2;
      const min = type.startsWith('sint') ? -(2 ** (len * 8 - 1)) + 1 : 0;
      if (v !== invalid && (v > max || v < min)) v = invalid;
      if (len === 1) dv.setUint8(i, v & 0xff);
      else if (len === 2) (type.startsWith('sint') ? dv.setInt16(i, v, true) : dv.setUint16(i, v, true));
      else (type.startsWith('sint') ? dv.setInt32(i, v, true) : dv.setUint32(i, v >>> 0, true));
      i += len;
    }
    this._push(b);
  }

  /** @returns {Uint8Array} the complete .fit file */
  finish() {
    const header = new Uint8Array(14);
    const hv = new DataView(header.buffer);
    header[0] = 14;
    header[1] = 0x20;             // protocol 2.0
    hv.setUint16(2, 2132, true);  // profile version 21.32
    hv.setUint32(4, this.size, true);
    header.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    hv.setUint16(12, fitCrc(header.subarray(0, 12)), true);

    const out = new Uint8Array(14 + this.size + 2);
    out.set(header, 0);
    let o = 14;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    new DataView(out.buffer).setUint16(o, fitCrc(out.subarray(0, o)), true);
    return out;
  }
}
