export function offsetWithin(block, node, offset) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let counted = 0;
    let current = walker.nextNode();
    while (current) {
        if (current === node)
            return counted + offset;
        counted += current.textContent?.length ?? 0;
        current = walker.nextNode();
    }
    return null;
}
export function splitByHighlights(token, highlights) {
    if (!highlights.length)
        return null;
    const edges = new Set([token.start, token.end]);
    const parts = [];
    const covering = (position) => highlights.find((highlight) => highlight.start <= position && highlight.end > position) ?? null;
    for (const highlight of highlights) {
        if (highlight.start > token.start && highlight.start < token.end)
            edges.add(highlight.start);
        if (highlight.end > token.start && highlight.end < token.end)
            edges.add(highlight.end);
    }
    const points = [...edges].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        if (from === to)
            continue;
        parts.push({ value: token.value.slice(from - token.start, to - token.start), highlightId: covering(from)?.id ?? null });
    }
    if (!parts.some((part) => part.highlightId))
        return null;
    return parts;
}
export function tokenise(text) {
    const tokens = [];
    const pattern = /([A-Za-z][A-Za-z'-]*)/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ value: text.slice(lastIndex, match.index), clean: "", isWord: false, start: lastIndex, end: match.index });
        }
        const value = match[0];
        // Single letters are not worth a popover.
        tokens.push({ value, clean: value, isWord: value.length > 1, start: match.index, end: match.index + value.length });
        lastIndex = match.index + value.length;
    }
    if (lastIndex < text.length) {
        tokens.push({ value: text.slice(lastIndex), clean: "", isWord: false, start: lastIndex, end: text.length });
    }
    return tokens;
}
