import sanitizeHtml from "sanitize-html";

/** Same allowlist on paste and on the authoritative write. No URLs, media or executable attributes. */
export function cleanStudyHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "div", "span", "br", "b", "strong", "i", "em", "u", "s", "mark", "font", "ul", "ol", "li", "blockquote", "h2", "h3", "h4", "table", "tbody", "tr", "th", "td", "sub", "sup"],
    allowedAttributes: { "*": ["style"], font: ["face", "color", "size"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
    allowedStyles: { "*": {
      "font-family": [/^[a-zA-Z0-9 ,"'\-]+$/],
      "font-size": [/^(?:[1-9]\d?|1[0-4]\d)(?:px|pt)$/, /^(?:[0-3](?:\.\d+)?)(?:em|rem)$/],
      "font-weight": [/^(?:normal|bold|[1-9]00)$/],
      "font-style": [/^(?:normal|italic)$/],
      "text-decoration": [/^(?:none|underline|line-through)$/],
      "text-align": [/^(?:left|center|right|justify)$/],
      color: [/^#[0-9a-fA-F]{3,8}$/, /^[a-zA-Z]+$/, /^rgba?\([\d., %]+\)$/],
      "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^[a-zA-Z]+$/, /^rgba?\([\d., %]+\)$/],
    } },
  });
}
