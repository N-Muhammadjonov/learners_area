import { Quicksand, Be_Vietnam_Pro, Kanit, Roboto_Mono, Itim } from "next/font/google";
// Use licensed upstream font packages, never VocaType's hashed font assets.
const ui = Quicksand({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-ui", preload: true });
const academic = Be_Vietnam_Pro({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-academic", preload: false });
const game = Kanit({ subsets: ["latin"], weight: ["600", "700"], display: "swap", variable: "--font-game", preload: false });
const technical = Roboto_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-technical", preload: false });
const celebration = Itim({ subsets: ["latin"], weight: "400", display: "swap", variable: "--font-celebration", preload: false });
export const fontVariables = [ui.variable, academic.variable, game.variable, technical.variable, celebration.variable].join(" ");
