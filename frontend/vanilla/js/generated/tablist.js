/**
 * Keyboard model for a `role="tablist"`, shared by every tablist in the product.
 *
 * This is the arrow-key half of the ARIA tabs pattern: Left/Right move between tabs and wrap at the
 * ends, Home/End jump to the first and last. It is pure index arithmetic with nothing Writing- or
 * Vocabulary-specific in it, which is why it lives here rather than inside one feature's module —
 * the Vocabulary tablist originally had no keyboard model at all, and the fix is to reuse the rule
 * Writing already had, not to write a second copy of it that can drift.
 *
 * Returning `null` means "this key is not a tablist key", so the caller leaves the event alone and
 * the browser's normal behaviour (Tab moving out of the widget, Enter activating) is preserved.
 */
export function nextTabIndex(current, key, count) {
    if (count <= 0)
        return null;
    if (key === "ArrowRight")
        return (current + 1) % count;
    if (key === "ArrowLeft")
        return (current - 1 + count) % count;
    if (key === "Home")
        return 0;
    if (key === "End")
        return count - 1;
    return null;
}
