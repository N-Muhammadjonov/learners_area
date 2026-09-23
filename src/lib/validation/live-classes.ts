import { z } from "zod";

export const createLiveClassSchema = z.object({
  title: z.string().min(3).max(200),
  topic: z.string().max(500).optional(),
  scheduledAt: z.string().min(1), // ISO datetime-local string
  durationMinutes: z.coerce.number().int().min(15).max(240),
  meetingUrl: z.string().url().optional().or(z.literal("")),
});

export const updateLiveClassSchema = z.object({
  status: z.enum(["upcoming", "live", "completed", "recorded", "cancelled"]).optional(),
  recordingUrl: z.string().url().optional().or(z.literal("")),
  meetingUrl: z.string().url().optional().or(z.literal("")),
});
