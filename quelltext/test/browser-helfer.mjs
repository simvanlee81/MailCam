// Startet einen kleinen lokalen Webserver und Chromium (localhost = sichere Herkunft wie HTTPS)
import pw from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const typen = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
export async function starte(ordner, args = []) {
  const server = http.createServer((req, res) => {
    const p = path.join(ordner, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
    fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": typen[path.extname(p)] || "application/octet-stream" }); res.end(data); });
  });
  await new Promise((r) => server.listen(0, r));
  const browser = await pw.chromium.launch({ args });
  return { url: `http://localhost:${server.address().port}`, browser, stop: async () => { await browser.close(); server.close(); } };
}
