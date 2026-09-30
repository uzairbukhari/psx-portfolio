// Browsers probe /favicon.ico regardless of <link rel="icon">; point them at the SVG.
export function GET(req: Request) {
  return Response.redirect(new URL('/favicon.svg', req.url).toString(), 301);
}
