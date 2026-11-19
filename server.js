import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(__filename);
const PORT = 4173;
const HOST = "127.0.0.1";

// 配信しないパス（顧客データ置き場と VCS 内部）。
const DENIED_PREFIXES = ["/inputs/private/", "/.git/"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function isInsideRoot(candidate) {
  return candidate === rootDir || candidate.startsWith(rootDir + path.sep);
}

const server = http.createServer((req, res) => {
  let reqPath;
  try {
    reqPath = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("400 Bad Request");
    return;
  }
  if (reqPath === "/" || reqPath === "/web" || reqPath === "/web/") {
    reqPath = "/web/index.html";
  }

  if (DENIED_PREFIXES.some((prefix) => reqPath.startsWith(prefix))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // 正規化してから包含判定する（接頭辞文字列の衝突では判定しない）。
  const resolved = path.resolve(rootDir, `.${reqPath}`);
  if (!isInsideRoot(resolved)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // シンボリックリンク経由の外向き参照も実パスで遮断する。
  fs.realpath(resolved, (realErr, realPath) => {
    if (realErr || !isInsideRoot(realPath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }

    fs.stat(realPath, (err, stats) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }

      const target = stats.isDirectory() ? path.join(realPath, "index.html") : realPath;
      const ext = path.extname(target).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      const stream = fs.createReadStream(target);
      stream.on("open", () => {
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        });
        stream.pipe(res);
      });
      stream.on("error", () => {
        if (!res.headersSent) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        }
        res.end("404 Not Found");
      });
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`PMO-kit workbench server running at http://${HOST}:${PORT}/web/`);
});
