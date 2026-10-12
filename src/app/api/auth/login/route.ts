import { NextRequest } from "next/server";
import { authenticatePassword } from "@/lib/auth/password-sign-in";
import { publicAuthPolicy, publicAuthDisabledResponse } from "@/lib/auth/public-auth-policy";

export async function POST(req: NextRequest) {
  if (!publicAuthPolicy().passwordEnabled) return publicAuthDisabledResponse();
  return authenticatePassword(req);
}
