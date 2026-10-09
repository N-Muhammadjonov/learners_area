import { constants } from "node:fs";
import { open } from "node:fs/promises";
export async function privatePortableFile(path: string, maximum: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.mode & 0o077 || stat.size > maximum) throw new Error("portable_private_file_required");
    return await file.readFile();
  } finally { await file.close(); }
}
