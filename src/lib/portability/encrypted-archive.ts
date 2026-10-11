import "server-only";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, open, readFile, rm, stat, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Unzip, type UnzipFile } from "fflate";
import { decryptPortableFile } from "./encryption";
import { verifyManifest, type ImportArchive } from "./archive";
import { PORTABILITY_TABLES } from "./classification";
import type { PortableManifest, PortableObject } from "./types";

/** Read only stored ZIP entries produced by our bounded bundle writer. Unknown,
 * duplicate or compressed entries reject before a destination transaction starts.
 * Authenticated plaintext lives in a private disposable directory, never in a
 * caller-chosen location. Row lines stream; no 1,000-row or archive-memory cap.
 */
const MAX_OBJECT_ENTRIES = 60000;
export async function withEncryptedPortableArchive<T>(input: { source: string; key: Uint8Array; maxBytes?: number }, work: (manifest: PortableManifest, archive: ImportArchive) => Promise<T>): Promise<T> {
  const maximum = input.maxBytes ?? 2 * 1024 * 1024 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("portable_archive_limit_invalid");
  const folder = await mkdtemp(join(tmpdir(), "riwi-import-"));
  const plain = join(folder, "authenticated.zip");
  const entries = new Map<string, { handle: Promise<FileHandle>; complete: boolean; bytes: number; file: UnzipFile }>();
  let writes = Promise.resolve(); let total = 0; let objectCount = 0;
  try {
    await decryptPortableFile(input.source, plain, input.key, { maxBytes: maximum + 4 * 1024 * 1024 });
    await mkdir(join(folder, "tables"), { mode: 0o700 });
    await mkdir(join(folder, "objects"), { mode: 0o700 });
    const unzip = new Unzip(file => {
      const match = /^tables\/([a-z][a-z0-9_]*)\.jsonl$/.exec(file.name);
      // O2 archives carry content-addressed objects/<sha256> entries; anything else stays invalid.
      const objectEntry = /^objects\/[a-f0-9]{64}$/.test(file.name);
      if (file.compression !== 0 || entries.has(file.name) || (file.name !== "manifest.json" && !objectEntry && (!match || !Object.hasOwn(PORTABILITY_TABLES, match[1]!)))) throw new Error("portable_archive_entry_invalid");
      // ZIP central-directory counts are 16-bit; stay below that with room for tables and the manifest.
      if (objectEntry ? objectCount >= MAX_OBJECT_ENTRIES : entries.size - objectCount >= Object.keys(PORTABILITY_TABLES).length + 1) throw new Error("portable_archive_entry_limit");
      if (objectEntry) objectCount += 1;
      const entry = { handle: open(join(folder, file.name), "wx", 0o600), complete: false, bytes: 0, file };
      void entry.handle.catch(() => {}); entries.set(file.name, entry);
      file.ondata = (error, data, final) => {
        if (error) throw error;
        total += data.byteLength; entry.bytes += data.byteLength;
        if (total > maximum || (file.name === "manifest.json" && entry.bytes > 1024 * 1024)) throw new Error("portable_archive_size_limit");
        const bytes = Buffer.from(data);
        writes = writes.then(async () => {
          const handle = await entry.handle;
          let offset = 0;
          while (offset < bytes.length) { const written = await handle.write(bytes, offset, bytes.length - offset); if (!written.bytesWritten) throw new Error("portable_archive_write_failed"); offset += written.bytesWritten; }
          if (final) { await handle.close(); entry.complete = true; }
        });
        void writes.catch(() => {});
      };
      file.start();
    });
    let zipBytes = 0; let tail = Buffer.alloc(0);
    for await (const chunk of createReadStream(plain, { highWaterMark: 64 * 1024 })) {
      zipBytes += chunk.byteLength; tail = Buffer.concat([tail, chunk]).subarray(-22);
      unzip.push(chunk); await writes;
    }
    if (tail.length !== 22 || tail.readUInt32LE(0) !== 0x06054b50 || tail.readUInt16LE(4) !== 0 || tail.readUInt16LE(6) !== 0 || tail.readUInt16LE(8) !== entries.size || tail.readUInt16LE(10) !== entries.size || tail.readUInt16LE(20) !== 0 || tail.readUInt32LE(12) + tail.readUInt32LE(16) + 22 !== zipBytes) throw new Error("portable_archive_truncated");
    unzip.push(new Uint8Array(), true); await writes;
    if (!entries.has("manifest.json") || [...entries.values()].some(entry => !entry.complete)) throw new Error("portable_archive_truncated");
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(folder, "manifest.json")))) as PortableManifest;
    verifyManifest(manifest);
    // keep-r2 (O1) archives carry no object bytes; move-objects (O2) archives carry exactly the manifest's unique objects.
    const wanted = manifest.objectMode === "move-objects" ? new Set(manifest.objects.map(object => `objects/${object.sha256}`)) : new Set<string>();
    if (manifest.objectMode === "keep-r2" ? objectCount !== 0 : (objectCount !== wanted.size || [...wanted].some(name => !entries.has(name)))) throw new Error("portable_archive_object_mismatch");
    if (entries.size !== manifest.tables.length + 1 + objectCount || manifest.tables.some(entry => !entries.has(entry.file))) throw new Error("portable_archive_table_mismatch");
    const archive: ImportArchive = {
      async *readRows(path) {
        if (!manifest.tables.some(entry => entry.file === path)) throw new Error("portable_archive_entry_invalid");
        let pending = "";
        const decoder = new TextDecoder("utf-8", { fatal: true });
        for await (const chunk of createReadStream(join(folder, path), { highWaterMark: 64 * 1024 })) {
          pending += decoder.decode(chunk, { stream: true });
          let split: number;
          while ((split = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, split); pending = pending.slice(split + 1); if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("portable_row_size_limit"); yield line + "\n"; }
          if (Buffer.byteLength(pending) > 1024 * 1024) throw new Error("portable_row_size_limit");
        }
        pending += decoder.decode();
        if (pending) throw new Error("portable_row_truncated");
      },
      async readObject(object: PortableObject) {
        // Only an object present in the verified manifest can be read, by its content hash, at its declared size.
        if (manifest.objectMode !== "move-objects" || !manifest.objects.some(item => item.sha256 === object.sha256 && item.sourceKey === object.sourceKey && item.byteLength === object.byteLength)) throw new Error("portable_archive_entry_invalid");
        const path = join(folder, "objects", object.sha256);
        if ((await stat(path)).size !== object.byteLength) throw new Error(`object_checksum_mismatch:${object.sourceKey}`);
        return new Uint8Array(await readFile(path));
      },
    };
    return await work(manifest, archive);
  } finally {
    for (const entry of entries.values()) entry.file.terminate();
    await writes.catch(() => {});
    for (const entry of entries.values()) await entry.handle.then(handle => handle.close()).catch(() => {});
    await rm(folder, { recursive: true, force: true });
  }
}
