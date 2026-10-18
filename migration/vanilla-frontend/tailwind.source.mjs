/**
 * Colours come from CSS variables, not from hex literals in components.
 *
 * Every palette entry is `rgb(var(--token) / <alpha-value>)`, so the same class
 * (`bg-paper-raised`, `border-ink-100`, `text-ink-500`) renders correctly in Day
 * Mode and Night Mode, and the opacity modifiers Tailwind generates keep
 * working. The palettes themselves live in src/app/globals.css — that file is
 * the single place a colour is defined.
 *
 * Night Mode's palette is the Learners Area Work & Career visual language:
 * dark-navy surfaces, warm off-white text and a restrained gold accent.
 */
const config = {
    darkMode: ["class", '[data-theme="night"]'],
    content: ["./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                ink: {
                    /*
                     * §15 — `bg-ink-50` is referenced by 22 files (~39 sites: loading skeletons, recessed panels)
                     * but `50` was never in this scale, so Tailwind generated NO utility for it and every one of
                     * those elements rendered with no background at all — invisible loading skeletons across the
                     * website. Proven from the built stylesheet: `.bg-ink-50` appears 0 times while the control
                     * utilities `.bg-ink-100`, `.bg-ink-900`, `.bg-ink-950` and `.bg-paper-sunken` each appear.
                     * Adding the shade fixes every call site at once and also makes the existing
                     * `.listening-workspace` override of `--ink-50` (the owner's Listening study pack palette)
                     * live, which was previously dead for the same reason.
                     */
                    50: "rgb(var(--ink-50) / <alpha-value>)",
                    950: "rgb(var(--ink-950) / <alpha-value>)",
                    900: "rgb(var(--ink-900) / <alpha-value>)",
                    700: "rgb(var(--ink-700) / <alpha-value>)",
                    500: "rgb(var(--ink-500) / <alpha-value>)",
                    300: "rgb(var(--ink-300) / <alpha-value>)",
                    100: "rgb(var(--ink-100) / <alpha-value>)",
                },
                signal: {
                    50: "rgb(var(--accent-soft) / <alpha-value>)",
                    100: "rgb(var(--accent-soft) / <alpha-value>)",
                    400: "rgb(var(--accent) / <alpha-value>)",
                    500: "rgb(var(--accent) / <alpha-value>)",
                    600: "rgb(var(--accent) / <alpha-value>)",
                    700: "rgb(var(--accent-strong) / <alpha-value>)",
                    /** Text/icon colour that stays readable on `signal-600`. */
                    contrast: "rgb(var(--accent-contrast) / <alpha-value>)",
                },
                paper: {
                    DEFAULT: "rgb(var(--paper) / <alpha-value>)",
                    raised: "rgb(var(--paper-raised) / <alpha-value>)",
                    sunken: "rgb(var(--paper-sunken) / <alpha-value>)",
                },
                band: {
                    good: "rgb(var(--band-good) / <alpha-value>)",
                    warn: "rgb(var(--band-warn) / <alpha-value>)",
                    bad: "rgb(var(--band-bad) / <alpha-value>)",
                },
                /** The centre's brand gold, available in both themes. */
                gold: {
                    DEFAULT: "rgb(var(--gold) / <alpha-value>)",
                    light: "rgb(var(--gold-light) / <alpha-value>)",
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
                card: "var(--shadow-card)",
                raised: "var(--shadow-raised)",
            },
        },
    },
    plugins: [],
};
export default config;
