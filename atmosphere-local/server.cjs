const http = require("node:http");
const sirv = require("sirv");

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const immutableAssets = sirv("public", {
  etag: true,
  gzip: true,
  brotli: true,
  maxAge: 31536000,
  immutable: true,
});

const pages = sirv("public", {
  etag: true,
  single: true,
  maxAge: 0,
});

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "picture-in-picture=(self)");

  if (pathname.startsWith("/assets/") || pathname.startsWith("/build/")) {
    immutableAssets(request, response, () => pages(request, response));
    return;
  }

  pages(request, response);
});

server.listen(port, host, () => {
  console.log(`Atmosphere is available on http://${host}:${port}`);
});
