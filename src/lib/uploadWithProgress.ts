export type UploadProgressResult = { url: string; key: string; type: "video" | "audio" | "file" };

/**
 * fetch() has no upload-progress event, so a real percentage needs XHR.
 * This is the only place in the app that uses XHR instead of fetch, and
 * only for this reason.
 */
export function uploadFileWithProgress(
  file: File,
  folder: string,
  onProgress: (pct: number) => void
): { promise: Promise<UploadProgressResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<UploadProgressResult>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Bad response from server"));
        }
      } else {
        let message = "Upload failed";
        try {
          message = JSON.parse(xhr.responseText).error ?? message;
        } catch {
          /* ignore */
        }
        reject(new Error(message));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));

    xhr.open("POST", "/api/uploads");
    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}
