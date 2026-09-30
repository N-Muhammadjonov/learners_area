import { z } from "zod";

/** A profile edit deliberately has no authority-bearing or contact fields. */
export const updateProfileNameSchema = z.object({
  name: z.string().trim().min(2).max(200),
}).strict();
