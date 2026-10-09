import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, constants } from "node:fs";
import { open, link, rm, type FileHandle } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("LAP1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
function assertKey(key: Uint8Array) {
  if (key.byteLength !== 32) throw new Error("portable_encryption_key_must_be_32_bytes");
}
async function privateOutput(destination: string): Promise<{ path: string; handle: FileHandle }> {
  const path = `${destination}.partial-${randomBytes(16).toString("hex")}`;
  return { path, handle: await open(path, "wx", 0o600) };
}
/** Hard-link publication is atomic and exclusive: it never follows/replaces a
 * destination symlink or an accepted file. The temporary is in the same directory.
 */
async function publish(temporary: string, destination: string) {
  await link(temporary, destination);
  await rm(temporary);
}

/** AES-256-GCM streaming envelope. Keys are supplied out-of-band and never stored. */
export async function encryptPortableFile(source: string, destination: string, key: Uint8Array, options: { removeSourceAfterSuccess?: boolean } = {}): Promise<void> {
  assertKey(key);
  if (source === destination) throw new Error("portable_envelope_paths_must_differ");
  const temporary = await privateOutput(destination);
  const output = createWriteStream(temporary.path, { fd: temporary.handle.fd, autoClose: false });
  const iv = randomBytes(IV_BYTES);
  output.write(MAGIC); output.write(iv);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  try {
    await pipeline(createReadStream(source), cipher, output, { end: false });
    await new Promise<void>((resolve, reject) => output.end(cipher.getAuthTag(), (error?: Error | null) => error ? reject(error) : resolve()));
    await temporary.handle.sync();
    await temporary.handle.close();
    await publish(temporary.path, destination);
    if (options.removeSourceAfterSuccess) await rm(source);
  } catch (error) {
    output.destroy(); await temporary.handle.close().catch(() => {}); await rm(temporary.path, { force: true }); throw error;
  }
}

export async function decryptPortableFile(source: string, destination: string, key: Uint8Array, options: { maxBytes?: number } = {}): Promise<void> {
  assertKey(key);
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let temporary: Awaited<ReturnType<typeof privateOutput>> | undefined;
  try {
    const stat = await input.stat();
    if (!stat.isFile()) throw new Error("portable_envelope_invalid");
    if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || stat.size > options.maxBytes + MAGIC.length + IV_BYTES + TAG_BYTES)) throw new Error("portable_envelope_size_limit");
    if (stat.size < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error("portable_envelope_truncated");
    const header = Buffer.alloc(MAGIC.length + IV_BYTES); const tag = Buffer.alloc(TAG_BYTES);
    const headRead = await input.read(header, 0, header.length, 0);
    const tagRead = await input.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    if (headRead.bytesRead !== header.length || tagRead.bytesRead !== TAG_BYTES) throw new Error("portable_envelope_truncated");
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("portable_envelope_invalid");
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length)); decipher.setAuthTag(tag);
    temporary = await privateOutput(destination);
    try {
      await pipeline(createReadStream(source, { fd: input.fd, start: header.length, end: stat.size - TAG_BYTES - 1, autoClose: false }), decipher, createWriteStream(temporary.path, { fd: temporary.handle.fd, autoClose: false }));
    } catch (error) { throw new Error("portable_envelope_authentication_failed", { cause: error }); }
    await temporary.handle.sync(); await temporary.handle.close();
    await publish(temporary.path, destination);
  } finally {
    await input.close();
    if (temporary) { await temporary.handle.close().catch(() => {}); await rm(temporary.path, { force: true }); }
  }
}
