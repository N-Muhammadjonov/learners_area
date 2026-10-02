import localFont from "next/font/local";
// Self-hosted OFL-1.1 files from the official Fontsource npm distributions
// (provenance + SHA256 in src/fonts/PROVENANCE.md). Never VocaType's font assets.
// Local files make `next build` independent of Google Fonts network access.
// Owner master prompt §8: Geist Sans for body/UI, Sora for major headings.
// Both are variable-weight files, so 450–500 body and 600–750 display weights
// are real, not synthesized.
const ui = localFont({ src: "../../fonts/geist-latin-wght-normal.woff2", weight: "100 900", display: "swap", variable: "--font-ui", preload: true, fallback: ["system-ui", "sans-serif"] });
const heading = localFont({ src: "../../fonts/sora-latin-wght-normal.woff2", weight: "100 800", display: "swap", variable: "--font-heading", preload: false, fallback: ["system-ui", "sans-serif"] });
const game = localFont({
  src: [
    { path: "../../fonts/kanit-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../fonts/kanit-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap", variable: "--font-game", preload: false, fallback: ["system-ui", "sans-serif"],
});
const technical = localFont({ src: "../../fonts/roboto-mono-latin-wght-normal.woff2", weight: "100 700", display: "swap", variable: "--font-technical", preload: false, fallback: ["ui-monospace", "monospace"] });
const celebration = localFont({ src: "../../fonts/itim-latin-400-normal.woff2", weight: "400", display: "swap", variable: "--font-celebration", preload: false, fallback: ["system-ui", "sans-serif"] });
export const fontVariables = [ui.variable, heading.variable, game.variable, technical.variable, celebration.variable].join(" ");
