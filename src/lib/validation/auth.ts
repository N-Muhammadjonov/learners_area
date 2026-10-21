import { z } from "zod";
export const registrationFullNameSchema=z.string().trim().min(3).max(200).refine(value=>/^\S+(?:\s+\S+)+$/u.test(value),'First and last name required');

export const registerSchema = z.object({
  name: registrationFullNameSchema,
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  gender: z.enum(["male", "female"]),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const requestResetSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});

export const confirmResetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
