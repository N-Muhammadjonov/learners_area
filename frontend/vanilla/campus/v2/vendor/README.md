# Campus renderer dependency

`three-runtime.js` contains Three.js 0.186.1 plus the official OrbitControls,
EffectComposer, RenderPass, UnrealBloomPass and OutputPass addons. All campus
modules share this same module instance and load it from this site's origin.
No third-party CDN is required at runtime.

Source: https://www.npmjs.com/package/three/v/0.186.1

Official package URL: https://registry.npmjs.org/three/-/three-0.186.1.tgz

Package SHA-256: `8cd068708ea44f2c73c944b1cead2ba2f0d5c15c8fc194e5700f4e4f4a033fe7`

Bundle SHA-256: `e37a4bc87dc31948361f164a83a72681b0b8bc8f281aee38d17e3a6f721141a5`

The package was bundled as ESM with esbuild 0.25.12 (`bundle: true`, `minify:
true`, `format: "esm"`). The entry exports all of `three/build/three.module.js`
and the six addon classes above. Addon imports of `three` resolve to that same
package's `build/three.module.js`. Preserve `LICENSE.three` when distributing.
