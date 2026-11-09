// The E: drive library server. Runs on Aaron's PC, listens on 127.0.0.1 only, and is reached through the
// Cloudflare Tunnel by the Design Studio Worker, which signs every request with CONSOLE_KEY (lib.mjs).
// Read only: it lists, previews and hands out files, and never changes anything on E:.
//   GET /search?q=&brand=ed|c3d&kind=&page=&per=   one page of matching files (pictures first, source files after)
//   GET /stats                                     counts per brand and kind
//   GET /thumb/:id                                  a small WebP preview (made once, then cached)
//   GET /file/:id                                   the original file, as a download
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_FILE, DATA_DIR, THUMB_DIR, ROOTS, PORT, KITTL_HOSTS } from "./config.mjs";
import { ID_RE, THUMB_EXTS, CONTENT_TYPES, verifySig } from "./lib.mjs";
import { readKey } from "./key.mjs";

const KEY = readKey();
if (!KEY) { console.error("No studio key yet: run drive-server\\setup.ps1 and type the CONSOLE_KEY when asked."); process.exit(1); }
fs.mkdirSync(THUMB_DIR, { recursive: true });

// The index in use; switches to a new one within a minute of build-index.mjs finishing.
let db = null, dbName = "";
function openIndex() {
  let name = "";
  try { name = fs.readFileSync(CURRENT_FILE, "utf8").trim(); } catch { return; }
  if (!name || name === dbName) return;
  const next = new DatabaseSync(path.join(DATA_DIR, name), { readOnly: true });
  const old = db; db = next; dbName = name;
  try { old?.close(); } catch { /* already closed */ }
  console.log(`Using index ${name}`);
}
openIndex();
setInterval(openIndex, 60_000).unref();

const BRANDS = new Set(["ed", "c3d"]);
const KINDS = new Set(["image", "svg", "dtf", "logo", "source", "3d", "kittl"]);
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "x-content-type-options": "nosniff", "cache-control": "no-store", ...headers });
  res.end(body);
};
const json = (res, status, body) => send(res, status, JSON.stringify(body), { "content-type": "application/json; charset=utf-8" });
const row = (id) => db?.prepare("SELECT * FROM items WHERE id = ?").get(id);
const filePath = (r) => {
  const root = ROOTS[r.root];
  if (!root || !r.rel) return null;
  const full = path.resolve(root.path, r.rel);
  return full.startsWith(path.resolve(root.path)) ? full : null; // never outside its root
};
const pub = (r) => ({ id: r.id, name: r.name, folder: r.folder, ext: r.ext, size: r.size, brand: r.brand, kind: r.kind,
  copies: r.copies, src: r.src, link: r.link, added: r.added, thumb: r.src === "kittl" ? !!r.thumb_url : THUMB_EXTS.has(r.ext) });

function search(q) {
  const brand = BRANDS.has(q.get("brand")) ? q.get("brand") : "ed";
  const kind = KINDS.has(q.get("kind")) ? q.get("kind") : "";
  const per = Math.min(120, Math.max(1, Number(q.get("per")) || 60));
  const page = Math.max(0, Number(q.get("page")) || 0);
  const words = (q.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const where = ["brand = ?"], args = [brand];
  if (kind) { where.push("kind = ?"); args.push(kind); }
  for (const w of words) { where.push("(lower(name) LIKE ? ESCAPE '\\' OR lower(folder) LIKE ? ESCAPE '\\')"); const p = `%${w.replace(/[\\%_]/g, (c) => "\\" + c)}%`; args.push(p, p); }
  const sql = `FROM items WHERE ${where.join(" AND ")}`;
  const total = db.prepare(`SELECT COUNT(*) n ${sql}`).get(...args).n;
  const items = db.prepare(`SELECT * ${sql} ORDER BY CASE kind WHEN 'source' THEN 1 ELSE 0 END, name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, per, page * per).map(pub);
  return { brand, kind, page, per, total, items };
}
const stats = () => ({ kinds: db.prepare("SELECT brand, kind, COUNT(*) n FROM items GROUP BY brand, kind").all(), index: dbName });

let sharp = null;
async function thumb(r) {
  const out = path.join(THUMB_DIR, `${r.id}.webp`);
  if (fs.existsSync(out)) return fs.readFileSync(out);
  let input;
  if (r.src === "kittl") {
    const u = new URL(r.thumb_url);
    if (u.protocol !== "https:" || !KITTL_HOSTS.has(u.hostname)) return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    input = Buffer.from(await res.arrayBuffer());
  } else {
    if (!THUMB_EXTS.has(r.ext)) return null;
    input = filePath(r);
    if (!input || !fs.existsSync(input)) return null;
  }
  sharp ??= (await import("sharp")).default;
  const buf = await sharp(input, { limitInputPixels: false, density: 96, animated: false })
    .resize(400, 400, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  fs.writeFileSync(out, buf);
  return buf;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET") return json(res, 405, { error: "Read only" });
    if (!verifySig(KEY, req.headers["x-drive-exp"], req.headers["x-drive-sig"], req.url)) return json(res, 401, { error: "Not signed" });
    if (!db) return json(res, 503, { error: "The index isn't built yet." });
    const u = new URL(req.url, "http://local");
    if (u.pathname === "/search") return json(res, 200, search(u.searchParams));
    if (u.pathname === "/stats") return json(res, 200, stats());
    const m = u.pathname.match(/^\/(thumb|file)\/([0-9a-f]+)$/);
    if (!m || !ID_RE.test(m[2])) return json(res, 404, { error: "Not found" });
    const r = row(m[2]);
    if (!r) return json(res, 404, { error: "Not found" });
    if (m[1] === "thumb") {
      const buf = await thumb(r).catch(() => null);
      return buf ? send(res, 200, buf, { "content-type": "image/webp", "cache-control": "private, max-age=86400" }) : json(res, 404, { error: "No preview" });
    }
    const full = filePath(r);
    if (!full || !fs.existsSync(full)) return json(res, 404, { error: "That file isn't on the drive any more." });
    res.writeHead(200, { "content-type": CONTENT_TYPES[r.ext] ?? "application/octet-stream", "content-length": fs.statSync(full).size,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(r.name)}`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error("drive server error", e?.message);
    if (!res.headersSent) json(res, 500, { error: "Something went wrong on the PC." });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`Design library server on http://127.0.0.1:${PORT}`));
