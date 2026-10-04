/** Extract only bounded data URLs; uploaded scripts are never executed. */
export function extractEmbeddedListeningMedia(html: string): { html: string; entries: Record<string, Uint8Array>; audioPath?: string; imagePath?: string } {
  const entries: Record<string, Uint8Array> = {};
  let audioPath: string | undefined, imagePath: string | undefined;
  let audioSource: string | undefined, imageSource: string | undefined;
  const cleaned = html.replace(/data:(audio\/mpeg|audio\/mp3|image\/png);base64,([A-Za-z0-9+/=]+)/g, (source, mime: string, encoded: string) => {
    if (encoded.length > 100 * 1024 * 1024) throw new Error("Embedded media too large");
    const audio = mime.startsWith("audio/");
    const existingPath = audio ? audioPath : imagePath;
    const existingSource = audio ? audioSource : imageSource;
    if (existingPath) {
      if (encoded !== existingSource) throw new Error("Multiple distinct embedded media need an explicit ZIP package manifest");
      return `[embedded:${existingPath}]`;
    }
    const path = audio ? "embedded-listening-audio.mp3" : "embedded-listening-map.png";
    const binary = atob(encoded);
    entries[path] = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (audio) { audioPath = path; audioSource = encoded; } else { imagePath = path; imageSource = encoded; }
    return `[embedded:${path}]`;
  });
  return { html: cleaned, entries, audioPath, imagePath };
}
