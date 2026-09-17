import { describe, it, expect } from "vitest";
import {
  getUnicodeLength,
  isValidPixelMdLength,
  isValidMessageMdLength,
  MESSAGE_STATUSES,
  MessageStatus,
} from "../src/index.js";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Protocol: Unicode Length & Boundary Tests", () => {
  const fixturePath = path.resolve(
    __dirname,
    "../../../tests/fixtures/golden/unicode_length_vector.json"
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

  it("should match Python len(str) on ASCII exact 2000 & 2001", () => {
    expect(getUnicodeLength(fixture.ascii_exact_2000)).toBe(2000);
    expect(isValidPixelMdLength(fixture.ascii_exact_2000)).toBe(true);

    expect(getUnicodeLength(fixture.ascii_2001)).toBe(2001);
    expect(isValidPixelMdLength(fixture.ascii_2001)).toBe(false);
  });

  it("should match Python len(str) on Chinese characters 2000 & 2001", () => {
    expect(getUnicodeLength(fixture.chinese_exact_2000)).toBe(2000);
    expect(isValidPixelMdLength(fixture.chinese_exact_2000)).toBe(true);

    expect(getUnicodeLength(fixture.chinese_2001)).toBe(2001);
    expect(isValidPixelMdLength(fixture.chinese_2001)).toBe(false);
  });

  it("should handle surrogate emojis and match Python code point counts", () => {
    for (const sample of fixture.emoji_surrogate_samples) {
      expect(getUnicodeLength(sample.char)).toBe(sample.python_len);
    }
  });

  it("should correctly validate boundary cases around 1999, 2000, 2001", () => {
    const boundary = fixture.boundary_test;
    expect(getUnicodeLength(boundary.text_1999_mixed)).toBe(1999);
    expect(isValidPixelMdLength(boundary.text_1999_mixed)).toBe(true);
    expect(isValidMessageMdLength(boundary.text_1999_mixed)).toBe(true);

    expect(getUnicodeLength(boundary.text_2000_mixed)).toBe(2000);
    expect(isValidPixelMdLength(boundary.text_2000_mixed)).toBe(true);
    expect(isValidMessageMdLength(boundary.text_2000_mixed)).toBe(true);

    expect(getUnicodeLength(boundary.text_2001_mixed)).toBe(2001);
    expect(isValidPixelMdLength(boundary.text_2001_mixed)).toBe(false);
    expect(isValidMessageMdLength(boundary.text_2001_mixed)).toBe(false);
  });
});

describe("Protocol: Status & Contract Enums", () => {
  it("should expose all standard message statuses", () => {
    const expected: MessageStatus[] = [
      "QUEUED",
      "PROCESSING",
      "RESERVED",
      "CALLING",
      "RESPONSE_STORED",
      "COMMITTED",
      "WAITING_PIXEL_BUDGET",
      "WAITING_RUN_BUDGET",
    ];

    for (const status of expected) {
      expect(MESSAGE_STATUSES[status]).toBe(status);
    }
  });
});
