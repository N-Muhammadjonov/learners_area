#!/usr/bin/env node
/**
 * Build the runtime derivatives of the approved brand artwork.
 *
 * The six supplied files are masters: the mark is 1254×1254 and around 1.3 MB,
 * and the horizontal lock-up is 1983px wide and about 1 MB. They are the approved
 * artwork and they stay exactly as they are — but they are storage and print
 * sized, not screen sized. Serving a 1.3 MB file to draw a 40px icon is the kind
 * of thing that turns a fast page into a slow one, and no amount of caching makes
 * a first visit cheaper.
 *
 * So: the masters are untouched, and this script writes small, faithful
 * derivatives into `public/brand/derived/`. Nothing is recoloured, cropped,
 * re-traced or "improved" — the pixels come from the approved master and the
 * only operations are resampling and PNG compression.
 *
 *   node scripts/build-brand-derivatives.mjs [--check]
 *
 * `--check` re-derives in memory and compares against what is on disk, so the
 * repository can prove the derivatives still match the masters.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "public", "brand");
const OUT_DIR = join(SOURCE_DIR, "derived");

const SOURCES = {
  markLight: "learners-area-logo-mark-light.png",
  markDark: "learners-area-logo-mark-dark.png",
  horizontalLight: "learners-area-logo-horizontal-light.png",
  horizontalDark: "learners-area-logo-horizontal-dark.png",
  favicon: "learners-area-favicon.png",
  ownerNight: "Learners_Area_V11_Exact_Cutout_Logo.png",
};

/**
 * What each surface actually needs.
 *
 * 96px covers a 40–48px mark at 2× device pixel ratio; 192px is there for a 96px
 * mark (the brand preview and any future large use). The horizontal lock-up is
 * displayed at ~320px wide, so 640px covers it at 2×.
 */
const TARGETS = [
  { name: "owner-v11-night-96.png", source: "ownerNight", width: 96 },
  { name: "owner-v11-night-192.png", source: "ownerNight", width: 192 },
  { name: "mark-light-96.png", source: "markLight", width: 96 },
  { name: "mark-light-192.png", source: "markLight", width: 192 },
  { name: "mark-dark-96.png", source: "markDark", width: 96 },
  { name: "mark-dark-192.png", source: "markDark", width: 192 },
  { name: "horizontal-light-640.png", source: "horizontalLight", width: 640 },
  { name: "horizontal-dark-640.png", source: "horizontalDark", width: 640 },
  { name: "favicon-32.png", source: "favicon", width: 32 },
  { name: "favicon-180.png", source: "favicon", width: 180 },
];

const CHECK = process.argv.includes("--check");

/**
 * A real .ico, built by hand.
 *
 * Browsers still ask for `/favicon.ico` directly when no icon link has been
 * resolved yet, and answering that request with a 404 leaves a blank tab icon.
 * The ICO container is trivial: a header, one directory entry per image, then the
 * frames. Each frame here is a PNG (supported since Vista), so the pixels are
 * still the approved artwork, resampled — nothing is redrawn.
 */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(frames.length, 4);

  const entries = [];
  let offset = 6 + frames.length * 16;
  for (const frame of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 0); // width
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(frame.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += frame.png.length;
  }

  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)]);
}

async function derive(sourcePath, width) {
  return sharp(readFileSync(sourcePath))
    .resize({ width, withoutEnlargement: true, fit: "inside" })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let stale = 0;

  for (const target of TARGETS) {
    const sourcePath = join(SOURCE_DIR, SOURCES[target.source]);
    const outPath = join(OUT_DIR, target.name);
    const buffer = await derive(sourcePath, target.width);

    if (CHECK) {
      let current = null;
      try {
        current = readFileSync(outPath);
      } catch {
        current = null;
      }
      const same = current !== null && Buffer.compare(current, buffer) === 0;
      console.log(`${same ? "ok  " : "DIFF"} ${target.name} (${(buffer.length / 1024).toFixed(1)} KB)`);
      if (!same) stale += 1;
      continue;
    }

    writeFileSync(outPath, buffer);
    console.log(`wrote ${target.name} (${(buffer.length / 1024).toFixed(1)} KB)`);
  }

  // The ICO that /favicon.ico must answer with.
  const icoFrames = [];
  for (const size of [16, 32, 48]) {
    icoFrames.push({ size, png: await derive(join(SOURCE_DIR, SOURCES.favicon), size) });
  }
  const ico = buildIco(icoFrames);
  const icoPath = join(OUT_DIR, "favicon.ico");

  if (CHECK) {
    let current = null;
    try {
      current = readFileSync(icoPath);
    } catch {
      current = null;
    }
    const same = current !== null && Buffer.compare(current, ico) === 0;
    console.log(`${same ? "ok  " : "DIFF"} favicon.ico (${(ico.length / 1024).toFixed(1)} KB)`);
    if (!same) stale += 1;
    if (stale > 0) {
      console.error(`\n${stale} derivative(s) do not match the masters. Run without --check to rebuild.`);
      process.exit(1);
    }
    console.log("\nall derivatives match the approved masters");
    return;
  }

  writeFileSync(icoPath, ico);
  console.log(`wrote favicon.ico (${(ico.length / 1024).toFixed(1)} KB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
