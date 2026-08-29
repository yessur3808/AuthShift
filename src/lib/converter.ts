export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface OtpEntry {
  secret: Uint8Array;
  name: string;
  issuer: string;
  algorithm: number;
  digits: number;
  type: number;
  counter: number;
}

export interface MigrationPayload {
  entries: OtpEntry[];
  version: number;
  batchSize: number;
  batchIndex: number;
  batchId: number;
}

export interface BitwardenItem {
  favorite: false;
  id: string;
  login: {
    totp: string;
    username: string;
  };
  name: string;
  type: 1;
}

export interface BitwardenExport {
  encrypted: false;
  items: BitwardenItem[];
}

const algorithms: Record<number, string> = {
  0: "SHA1",
  1: "SHA1",
  2: "SHA256",
  3: "SHA512",
  4: "MD5",
};

const digitCounts: Record<number, number> = {
  0: 6,
  1: 6,
  2: 8,
};

const otpTypes: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "HOTP",
  2: "TOTP",
};

type ProtobufField = {
  number: number;
  wireType: number;
  value: number | Uint8Array;
};

function readVarint(data: Uint8Array, start: number): [number, number] {
  let value = 0;
  let multiplier = 1;
  let offset = start;

  while (true) {
    if (offset >= data.length) {
      throw new MigrationError("Unexpected end of protobuf varint");
    }

    const byte = data[offset++];
    value += (byte & 0x7f) * multiplier;

    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) {
        throw new MigrationError("Protobuf integer is too large");
      }
      return [value, offset];
    }

    multiplier *= 128;
    if (multiplier > Number.MAX_SAFE_INTEGER) {
      throw new MigrationError("Invalid protobuf varint");
    }
  }
}

function protobufFields(data: Uint8Array): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;

  while (offset < data.length) {
    let key: number;
    [key, offset] = readVarint(data, offset);
    const number = Math.floor(key / 8);
    const wireType = key & 0x07;

    if (number === 0) {
      throw new MigrationError("Invalid protobuf field number 0");
    }

    if (wireType === 0) {
      let value: number;
      [value, offset] = readVarint(data, offset);
      fields.push({ number, wireType, value });
      continue;
    }

    if (wireType === 2) {
      let length: number;
      [length, offset] = readVarint(data, offset);
      const end = offset + length;
      if (end > data.length) {
        throw new MigrationError("Truncated protobuf field");
      }
      fields.push({ number, wireType, value: data.slice(offset, end) });
      offset = end;
      continue;
    }

    const byteLength = wireType === 1 ? 8 : wireType === 5 ? 4 : 0;
    if (!byteLength || offset + byteLength > data.length) {
      throw new MigrationError(`Unsupported protobuf wire type ${wireType}`);
    }
    fields.push({
      number,
      wireType,
      value: data.slice(offset, offset + byteLength),
    });
    offset += byteLength;
  }

  return fields;
}

function asBytes(value: number | Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new MigrationError("Expected a length-delimited protobuf field");
  }
  return value;
}

function asNumber(value: number | Uint8Array): number {
  if (typeof value !== "number") {
    throw new MigrationError("Expected a numeric protobuf field");
  }
  return value;
}

function decodeText(value: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(value).trim();
}

function parseOtpParameters(data: Uint8Array): OtpEntry {
  const entry: OtpEntry = {
    secret: new Uint8Array(),
    name: "",
    issuer: "",
    algorithm: 0,
    digits: 0,
    type: 0,
    counter: 0,
  };

  for (const field of protobufFields(data)) {
    if (field.number === 1 && field.wireType === 2) {
      entry.secret = asBytes(field.value);
    } else if (field.number === 2 && field.wireType === 2) {
      entry.name = decodeText(asBytes(field.value));
    } else if (field.number === 3 && field.wireType === 2) {
      entry.issuer = decodeText(asBytes(field.value));
    } else if (field.number === 4 && field.wireType === 0) {
      entry.algorithm = asNumber(field.value);
    } else if (field.number === 5 && field.wireType === 0) {
      entry.digits = asNumber(field.value);
    } else if (field.number === 6 && field.wireType === 0) {
      entry.type = asNumber(field.value);
    } else if (field.number === 7 && field.wireType === 0) {
      entry.counter = asNumber(field.value);
    }
  }

  if (entry.secret.length === 0) {
    throw new MigrationError("Authenticator entry has no secret");
  }
  return entry;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim() + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new MigrationError("Migration payload contains invalid Base64 data");
  }
}

function extractDataParameter(uri: string): string {
  const queryStart = uri.indexOf("?");
  if (queryStart < 0) {
    throw new MigrationError("Migration URI has no data parameter");
  }

  for (const component of uri.slice(queryStart + 1).split("&")) {
    const separator = component.indexOf("=");
    if (separator < 0) continue;
    const key = decodeURIComponent(component.slice(0, separator));
    if (key === "data") {
      return decodeURIComponent(component.slice(separator + 1));
    }
  }
  throw new MigrationError("Migration URI has no data parameter");
}

export function decodeMigrationUri(uri: string): MigrationPayload {
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith("otpauth-migration://")) {
    throw new MigrationError("Not a Google Authenticator migration URI");
  }

  const payload: MigrationPayload = {
    entries: [],
    version: 0,
    batchSize: 1,
    batchIndex: 0,
    batchId: 0,
  };

  for (const field of protobufFields(decodeBase64(extractDataParameter(trimmed)))) {
    if (field.number === 1 && field.wireType === 2) {
      payload.entries.push(parseOtpParameters(asBytes(field.value)));
    } else if (field.number === 2 && field.wireType === 0) {
      payload.version = asNumber(field.value);
    } else if (field.number === 3 && field.wireType === 0) {
      payload.batchSize = asNumber(field.value) || 1;
    } else if (field.number === 4 && field.wireType === 0) {
      payload.batchIndex = asNumber(field.value);
    } else if (field.number === 5 && field.wireType === 0) {
      payload.batchId = asNumber(field.value);
    }
  }

  if (payload.entries.length === 0) {
    throw new MigrationError("Migration payload contains no OTP entries");
  }
  return payload;
}

export function extractMigrationUris(text: string): string[] {
  return text.match(/otpauth-migration:\/\/[^\s"'<>]+/gi) ?? [];
}

function entriesMatch(first: OtpEntry[], second: OtpEntry[]): boolean {
  if (first.length !== second.length) return false;
  return first.every((entry, index) => {
    const other = second[index];
    return (
      entry.name === other.name &&
      entry.issuer === other.issuer &&
      entry.algorithm === other.algorithm &&
      entry.digits === other.digits &&
      entry.type === other.type &&
      entry.counter === other.counter &&
      entry.secret.length === other.secret.length &&
      entry.secret.every((byte, byteIndex) => byte === other.secret[byteIndex])
    );
  });
}

export function assembleBatches(payloads: MigrationPayload[]): OtpEntry[] {
  const batches = new Map<
    string,
    { id: number; size: number; parts: Map<number, OtpEntry[]> }
  >();

  payloads.forEach((payload, payloadIndex) => {
    const standalone = payload.batchId === 0 && payload.batchSize === 1;
    const key = standalone ? `standalone-${payloadIndex}` : String(payload.batchId);
    const batch = batches.get(key) ?? {
      id: payload.batchId,
      size: payload.batchSize,
      parts: new Map<number, OtpEntry[]>(),
    };

    if (batch.size !== payload.batchSize) {
      throw new MigrationError(`Inconsistent batch size for batch ${payload.batchId}`);
    }

    const existing = batch.parts.get(payload.batchIndex);
    if (existing && !entriesMatch(existing, payload.entries)) {
      throw new MigrationError(
        `Conflicting QR codes for batch ${payload.batchId}, part ${payload.batchIndex + 1}`,
      );
    }
    batch.parts.set(payload.batchIndex, payload.entries);
    batches.set(key, batch);
  });

  const entries: OtpEntry[] = [];
  for (const batch of batches.values()) {
    const missing: number[] = [];
    for (let index = 0; index < batch.size; index += 1) {
      if (!batch.parts.has(index)) missing.push(index + 1);
    }
    if (missing.length) {
      throw new MigrationError(
        `Export is incomplete. Add QR part ${missing.join(", ")} of ${batch.size}.`,
      );
    }
    [...batch.parts.entries()]
      .sort(([first], [second]) => first - second)
      .forEach(([, partEntries]) => entries.push(...partEntries));
  }
  return entries;
}

function splitAccountName(nameValue: string, issuerValue: string): [string, string] {
  const name = nameValue.trim();
  const issuer = issuerValue.trim();

  if (issuer) {
    const prefix = `${issuer}:`;
    const account = name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
      ? name.slice(prefix.length).trim()
      : name;
    return [issuer, account || name || issuer];
  }

  const separator = name.indexOf(":");
  if (separator > 0) {
    const inferredIssuer = name.slice(0, separator).trim();
    const account = name.slice(separator + 1).trim();
    if (inferredIssuer && account) return [inferredIssuer, account];
  }
  return ["", name || "Unknown account"];
}

function base32Encode(secret: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of secret) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function encodeQuery(parameters: Array<[string, string]>): string {
  return parameters
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function makeUuid(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().toUpperCase();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-").toUpperCase();
}

function makeBitwardenItem(entry: OtpEntry): BitwardenItem {
  const otpType = otpTypes[entry.type] ?? "UNKNOWN";
  const algorithm = algorithms[entry.algorithm];
  const digits = digitCounts[entry.digits];

  if (otpType !== "TOTP") {
    throw new MigrationError(`${entry.name || "Unnamed entry"} uses ${otpType}, not TOTP`);
  }
  if (!algorithm || !["SHA1", "SHA256", "SHA512"].includes(algorithm)) {
    throw new MigrationError(
      `${entry.name || "Unnamed entry"} uses an unsupported algorithm`,
    );
  }
  if (digits !== 6 && digits !== 8) {
    throw new MigrationError(
      `${entry.name || "Unnamed entry"} uses an unsupported digit count`,
    );
  }

  const [issuer, account] = splitAccountName(entry.name, entry.issuer);
  const label = issuer ? `${issuer}:${account}` : account;
  const parameters: Array<[string, string]> = [
    ["secret", base32Encode(entry.secret)],
    ["algorithm", algorithm],
    ["digits", String(digits)],
    ["period", "30"],
  ];
  if (issuer) parameters.push(["issuer", issuer]);

  const encodedLabel = encodeURIComponent(label).replace(/%3A/gi, ":");
  return {
    favorite: false,
    id: makeUuid(),
    login: {
      totp: `otpauth://totp/${encodedLabel}?${encodeQuery(parameters)}`,
      username: account,
    },
    name: issuer || account || "Authenticator item",
    type: 1,
  };
}

export function buildBitwardenExport(
  entries: OtpEntry[],
  skipUnsupported = false,
): { output: BitwardenExport; skipped: string[] } {
  const items: BitwardenItem[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    try {
      items.push(makeBitwardenItem(entry));
    } catch (error) {
      if (skipUnsupported && error instanceof MigrationError) {
        skipped.push(error.message);
      } else {
        throw error;
      }
    }
  }

  if (!items.length) {
    throw new MigrationError("No supported TOTP entries were found");
  }
  return { output: { encrypted: false, items }, skipped };
}
