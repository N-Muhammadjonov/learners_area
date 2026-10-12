import { NextRequest } from "next/server";
import { authenticatePassword } from "@/lib/auth/password-sign-in";

/** Same origin, rate limits, password proof and cookies; ACTIVE owner/admin only. */
export async function POST(req: NextRequest) {
  return authenticatePassword(req, true);
}
