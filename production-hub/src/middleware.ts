import { NextResponse, type NextRequest } from "next/server";

// Fast first gate only: no session cookie → login page.
// The real check (valid session, role, permissions) happens on the server for every page and action.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("pbhub_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/hub/:path*", "/crew/:path*"] };
