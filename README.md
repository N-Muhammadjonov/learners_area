# Learners Area — approved visual reference

This is a separate reference-only branch. It intentionally contains **no site implementation** and does not modify `main` or `arena/learners-area-next`.

## Original file to be stored here

- Filename: `learners_area_reference.png`
- Source attachment: user-supplied `learners_area_game(4).png`
- Expected dimensions: **1678 × 937**, RGBA PNG
- Expected bytes: **2762847**
- Expected SHA-256: `944835e4caca7c5915bc914d5cd4b0157837811aa1928e6f250f82cb39c65454`

**WARNING: the original PNG is not yet committed.** The connected GitHub interface cannot upload the local binary attachment. Upload the exact original PNG into this branch with GitHub's **Add file → Upload files** (save it as `learners_area_reference.png`). Do **not** re-export, optimize, resize or recompress it. Then run `python3 verify_reference.py` to confirm byte-for-byte identity against the uploaded original.

## Screenshot comparison protocol

1. Verify the SHA-256 of the reference first.
2. Set the browser content screenshot to exactly 1678×937; browser UI and different-sized screenshots are not comparable pixel-by-pixel.
3. Capture the initial isometric camera at a controlled GPU/browser/scale and animation time.
4. Run `python3 verify_reference.py --candidate path/to/screenshot.png` (requires Pillow).
5. Review the whole map and per-region metrics, and inspect architectural details, cyan pathway light, logo, module labels, correct colors and module positions.
6. Repeat after each individual site change; never state 'byte-for-byte identical' without verifying the actual original PNG bytes.

**The animated WebGL render is not expected to have identical PNG *file bytes* to the reference due to renderer/encoding differences. Aim to reduce pixel differences; use the original PNG SHA-256 only to validate the immutable reference source.**
