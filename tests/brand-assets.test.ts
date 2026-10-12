import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  BRAND_ASSETS,
  BRAND_ASSET_DIR,
  allBrandAssets,
  brandLogoFor,
  getBrand,
} from "../src/lib/config/brand";

/**
 * The six approved brand files.
 *
 * The artwork is supplied by the centre and is final: this test does not inspect
 * what the pictures look like, only that the files the interface asks for are
 * really there, are really PNGs, and are named in exactly one place. A missing
 * asset is a broken image on a public page, so it fails here rather than in front
 * of a student.
 *
 * Nothing in this file (or anywhere else) generates, recolours or substitutes
 * artwork. If a file is absent, the fix is to put the approved file back.
 */

const PUBLIC_DIR = join(process.cwd(), "public");

const EXPECTED_FILES = [
  "learners-area-logo-master-dark.png",
  "Learners_Area_V11_Exact_Cutout_Logo.png",
  "owner-neon-day.png",
  "learners-area-logo-horizontal-dark.png",
  "learners-area-logo-horizontal-light.png",
  "learners-area-favicon.png",
];

test("the six approved assets are configured under one directory", () => {
  const assets = allBrandAssets();
  assert.equal(assets.length, 6);
  for (const asset of assets) {
    assert.ok(asset.path.startsWith(`${BRAND_ASSET_DIR}/`), `${asset.key} is not under ${BRAND_ASSET_DIR}`);
    assert.ok(asset.path.endsWith(".png"), `${asset.key} is not a PNG`);
  }
  assert.deepEqual(
    assets.map((asset) => asset.path.split("/").pop()).sort(),
    [...EXPECTED_FILES].sort()
  );
  // The values are unique: two purposes pointing at one file would silently show
  // the wrong variant on one of the two surfaces.
  assert.equal(new Set(assets.map((asset) => asset.path)).size, 6);
});

test("every configured asset exists on disk and is a real PNG", () => {
  for (const asset of allBrandAssets()) {
    const file = join(PUBLIC_DIR, asset.path.replace(/^\//, ""));
    assert.ok(existsSync(file), `missing approved asset on disk: public${asset.path}`);
    const head = readFileSync(file).subarray(0, 8);
    // The PNG signature, so an HTML error page saved as .png cannot pass.
    assert.deepEqual(
      [...head],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${asset.key} is not a PNG file`
    );
    assert.ok(statSync(file).size > 1024, `${asset.key} is suspiciously small`);
  }
});

test("no brand artwork is duplicated outside the canonical directory", () => {
  // The brief is explicit: exactly one copy of each approved file, and no
  // look-alike under `public/logo.png`, `public/sidebar-logo.png` and so on.
  const stray: string[] = [];
  const walk = (dir: string, relative: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const rel = `${relative}/${entry}`;
      if (statSync(path).isDirectory()) {
        walk(path, rel);
        continue;
      }
      if (!/\.(png|jpg|jpeg|svg|webp|ico)$/i.test(entry)) continue;
      if (rel.startsWith("/brand/")) continue;
      if (/logo|brand|icon|favicon|learners-area/i.test(entry)) stray.push(`public${rel}`);
    }
  };
  if (existsSync(PUBLIC_DIR)) walk(PUBLIC_DIR, "");
  assert.deepEqual(stray, []);
});

test("the theme picks the supplied file for that theme, never a filter", () => {
  assert.equal(brandLogoFor("mark", "day"), BRAND_ASSETS.logoMarkLight);
  assert.equal(brandLogoFor("mark", "night"), BRAND_ASSETS.logoMarkDark);
  assert.equal(brandLogoFor("horizontal", "day"), BRAND_ASSETS.logoHorizontalDark);
  assert.equal(brandLogoFor("horizontal", "night"), BRAND_ASSETS.logoMarkDark);
  // The master artwork is supplied once; it is returned for both themes rather
  // than manufactured from the other file.
  assert.equal(brandLogoFor("master", "day"), BRAND_ASSETS.logoMasterDark);
  assert.equal(brandLogoFor("master", "night"), BRAND_ASSETS.logoMarkDark);

  const css = readFileSync(join("src", "app", "globals.css"), "utf8");
  assert.equal(/invert|hue-rotate|grayscale/.test(css), false, "brand artwork must never be filtered");
});

test("no component builds a brand path of its own", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(path)) continue;
      if (path.endsWith(join("src", "lib", "config", "brand.ts"))) continue;
      const source = readFileSync(path, "utf8");
      if (/["'`]\/brand\//.test(source)) offenders.push(path);
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});

test("the name and the line under it are configuration, not literals", () => {
  const brand = getBrand();
  assert.ok(brand.siteName.length > 0);
  assert.equal(brand.siteName, "Learners Area");
  // The approved wording, to the letter — including the word order, which was
  // once written the other way round.
  assert.equal(brand.brandLine, "Take your learning journey with us");
  assert.equal(brand.brandLine.includes("journey of learning"), false);
});
