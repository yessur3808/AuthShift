import { describe, expect, it } from "vitest";
import {
  assembleBatches,
  buildBitwardenExport,
  decodeMigrationUri,
  type MigrationPayload,
} from "./converter";

function varint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return bytes;
}

function bytesField(number: number, value: Uint8Array): number[] {
  return [...varint((number << 3) | 2), ...varint(value.length), ...value];
}

function intField(number: number, value: number): number[] {
  return [...varint(number << 3), ...varint(value)];
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function migrationUri(batchSize = 1, batchIndex = 0): string {
  const entry = new Uint8Array([
    ...bytesField(1, text("synthetic-secret")),
    ...bytesField(2, text("Example:alice@example.com")),
    ...bytesField(3, text("Example")),
    ...intField(4, 1),
    ...intField(5, 1),
    ...intField(6, 2),
  ]);
  const payload = new Uint8Array([
    ...bytesField(1, entry),
    ...intField(2, 1),
    ...intField(3, batchSize),
    ...intField(4, batchIndex),
    ...intField(5, 4321),
  ]);
  let binary = "";
  payload.forEach((byte) => (binary += String.fromCharCode(byte)));
  return `otpauth-migration://offline?data=${encodeURIComponent(btoa(binary))}`;
}

describe("Google Authenticator conversion", () => {
  it("decodes a migration payload", () => {
    const payload = decodeMigrationUri(migrationUri());
    expect(payload.batchId).toBe(4321);
    expect(payload.entries[0].issuer).toBe("Example");
  });

  it("creates Bitwarden Authenticator JSON", () => {
    const payload = decodeMigrationUri(migrationUri());
    const { output, skipped } = buildBitwardenExport(payload.entries);
    expect(skipped).toEqual([]);
    expect(output.encrypted).toBe(false);
    expect(output.items[0]).toMatchObject({
      name: "Example",
      type: 1,
      login: { username: "alice@example.com" },
    });
    expect(output.items[0].login.totp).toContain("secret=");
  });

  it("orders multipart payloads by batch index", () => {
    const first = decodeMigrationUri(migrationUri(2, 0));
    const second = decodeMigrationUri(migrationUri(2, 1));
    second.entries[0].name = "Second";
    expect(assembleBatches([second, first]).map((entry) => entry.name)).toEqual([
      "Example:alice@example.com",
      "Second",
    ]);
  });

  it("reports missing QR parts", () => {
    const payload: MigrationPayload = decodeMigrationUri(migrationUri(3, 0));
    expect(() => assembleBatches([payload])).toThrow("part 2, 3 of 3");
  });
});
