import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#161422",
          900: "#1E1B2E",
          700: "#3A3555",
          500: "#635C82",
          300: "#A6A0C2",
          100: "#E8E6F2",
        },
        signal: {
          700: "#4433A6",
          600: "#5C46C9",
          500: "#725BE0",
          400: "#9683EA",
          100: "#EEEAFB",
        },
        paper: {
          DEFAULT: "#FBFAFE",
          raised: "#FFFFFF",
          sunken: "#F2F0F9",
        },
        band: {
          good: "#1E7F5C",
          warn: "#B4750E",
          bad: "#C2492D",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "10px",
        lg: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(30, 27, 46, 0.06), 0 1px 1px rgba(30, 27, 46, 0.04)",
        raised: "0 4px 16px rgba(30, 27, 46, 0.10)",
      },
    },
  },
  plugins: [],
};

export default config;
