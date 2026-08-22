import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { AVATAR_FRAMES } from "./avatar-frames";
import { GAME_CARD_PRODUCTS } from "./game-card-products";

interface PngInfo {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  centerAlpha: number;
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function readRgbaPng(filePath: string): PngInfo {
  const data = fs.readFileSync(filePath);
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(data.subarray(0, signature.length)).toEqual(signature);

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }

  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6);
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  let rawOffset = 0;
  let previousRow = Buffer.alloc(rowBytes);
  let centerAlpha = -1;
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const encodedRow = raw.subarray(rawOffset, rawOffset + rowBytes);
    rawOffset += rowBytes;
    const row = Buffer.alloc(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const above = previousRow[index];
      const upperLeft =
        index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;
      const value = encodedRow[index];
      if (filter === 0) row[index] = value;
      else if (filter === 1) row[index] = (value + left) & 0xff;
      else if (filter === 2) row[index] = (value + above) & 0xff;
      else if (filter === 3) row[index] = (value + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        row[index] =
          (value + paethPredictor(left, above, upperLeft)) & 0xff;
      } else {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    if (y === centerY) centerAlpha = row[centerX * bytesPerPixel + 3];
    previousRow = row;
  }

  return { width, height, colorType, bitDepth, centerAlpha };
}

describe("frame asset contract", () => {
  it("keeps every game card frame transparent at the content center", () => {
    for (const product of GAME_CARD_PRODUCTS) {
      for (const ratio of ["square", "wide"] as const) {
        const asset = product.assets[ratio];
        const info = readRgbaPng(
          path.join(
            process.cwd(),
            "resources",
            "game-card-products",
            product.id,
            asset.fileName,
          ),
        );
        if (ratio === "square") expect(info.width).toBe(info.height);
        else expect(info.width / info.height).toBeGreaterThan(1.7);
        expect(info.centerAlpha).toBe(0);
        expect(asset.contentInsetPercent.top).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every avatar frame as an RGBA resource with a transparent center", () => {
    for (const frame of AVATAR_FRAMES) {
      const info = readRgbaPng(
        path.join(
          process.cwd(),
          "resources",
          "avatar-frames",
          frame.imageFileName,
        ),
      );
      expect(info.width).toBe(info.height);
      expect(info.centerAlpha).toBe(0);
      expect(frame.contentInsetPx.left).toBeGreaterThan(0);
    }
  });
});
