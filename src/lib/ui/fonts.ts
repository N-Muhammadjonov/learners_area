import localFont from "next/font/local";
// Self-hosted OFL-1.1 files from the official Fontsource npm distributions
// (provenance + SHA256 in src/fonts/PROVENANCE.md). Never VocaType's font assets.
// Local files make `next build` independent of Google Fonts network access.
const ui = localFont({ src: "../../fonts/quicksand-latin-wght-normal.woff2", weight: "300 700", display: "swap", variable: "--font-ui", preload: true, fallback: ["system-ui", "sans-serif"] });
const academic = localFont({
  src: [
    { path: "../../fonts/be-vietnam-pro-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/be-vietnam-pro-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/be-vietnam-pro-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../fonts/be-vietnam-pro-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap", variable: "--font-academic", preload: false, fallback: ["system-ui", "sans-serif"],
});
const game = localFont({
  src: [
    { path: "../../fonts/kanit-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../fonts/kanit-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap", variable: "--font-game", preload: false, fallback: ["system-ui", "sans-serif"],
});
const technical = localFont({ src: "../../fonts/roboto-mono-latin-wght-normal.woff2", weight: "100 700", display: "swap", variable: "--font-technical", preload: false, fallback: ["ui-monospace", "monospace"] });
const celebration = localFont({ src: "../../fonts/itim-latin-400-normal.woff2", weight: "400", display: "swap", variable: "--font-celebration", preload: false, fallback: ["system-ui", "sans-serif"] });
export const fontVariables = [ui.variable, academic.variable, game.variable, technical.variable, celebration.variable].join(" ");
