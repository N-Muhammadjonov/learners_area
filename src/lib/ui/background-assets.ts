// Content-addressed approved wallpapers: safe for long-lived public caching.
export const BACKGROUND_ASSETS = [
  {
    "theme": "day",
    "role": "DESKTOP",
    "href": "/images/day/LA_DAY_DESKTOP_BACKGROUND.61b34a5a3a32.webp",
    "media": "(min-width: 1024.01px) and (hover: hover), (min-width: 1024.01px) and (pointer: fine), (min-width: 1366.01px)",
    "bytes": 39460,
    "previewBytes": 494
  },
  {
    "theme": "day",
    "role": "LANDSCAPE",
    "href": "/images/day/LA_DAY_LANDSCAPE_BACKGROUND.2c17bc511a25.webp",
    "media": "(max-width: 1024px) and (orientation: landscape), (max-width: 1366px) and (hover: none) and (pointer: coarse) and (orientation: landscape)",
    "bytes": 40766,
    "previewBytes": 528
  },
  {
    "theme": "day",
    "role": "PORTRAIT",
    "href": "/images/day/LA_DAY_PORTRAIT_BACKGROUND.322ba8eda1f7.webp",
    "media": "(max-width: 1024px) and (orientation: portrait), (max-width: 1366px) and (hover: none) and (pointer: coarse) and (orientation: portrait)",
    "bytes": 41318,
    "previewBytes": 1072
  },
  {
    "theme": "night",
    "role": "DESKTOP",
    "href": "/images/night/LA_NIGHT_DESKTOP_BACKGROUND.8458b14681fa.webp",
    "media": "(min-width: 1024px)",
    "bytes": 39502,
    "previewBytes": 552
  },
  {
    "theme": "night",
    "role": "MOBILE",
    "href": "/images/night/LA_NIGHT_MOBILE_BACKGROUND.05afe51af964.webp",
    "media": "(max-width: 767.98px)",
    "bytes": 41668,
    "previewBytes": 1010
  },
  {
    "theme": "night",
    "role": "TABLET",
    "href": "/images/night/LA_NIGHT_TABLET_BACKGROUND.eb7a5b8ca300.webp",
    "media": "(min-width: 768px) and (max-width: 1023.98px)",
    "bytes": 43300,
    "previewBytes": 694
  }
] as const;
