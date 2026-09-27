import { NextRequest, NextResponse } from "next/server";

/**
 * Legacy Login Widget callback.
 *
 * The website now signs in only through a server-owned intent. This route stays
 * so an old widget URL fails closed: it does not create an account, it does not
 * read the database, and it does not issue a session.
 */
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/login?error=telegram", req.url));
}
