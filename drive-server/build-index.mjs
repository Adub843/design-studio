// Builds the library index: walks every root (read only), keeps one row per distinct file (same name and
// size counts as one, with how many copies there are), and adds the Kittl list. Run it again any time to
// pick up new files: it writes a new index file and then points the server at it, so the server never sees half an index.
//   node drive-server/build-index.mjs
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, CURRENT_FILE, ROOTS, KITTL_FILE } from "./config.mjs";
import { INDEXED_EXTS, classify, fileId } from "./lib.mjs";

fs.mkdirSync(DATA_DIR, { recursive: true });
const name = `index-${Date.now()}.db`;
const db = new DatabaseSync(path.join(DATA_DIR, name));
db.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, src TEXT NOT NULL, root INTEGER, rel TEXT, name TEXT NOT NULL, folder TEXT,
  ext TEXT, size INTEGER, brand TEXT NOT NULL, kind TEXT NOT NULL, copies INTEGER NOT NULL DEFAULT 1, thumb_url TEXT, link TEXT, added INTEGER)`);
const insert = db.prepare(`INSERT INTO items (id, src, root, rel, name, folder, ext, size, brand, kind, copies, thumb_url, link, added)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET copies = copies + 1`);

let files = 0, skippedDirs = 0;
db.exec("BEGIN");
ROOTS.forEach((root, r) => {
  if (!fs.existsSync(root.path)) return console.log(`Skipped ${root.path} (not found)`);
  const skip = new Set(root.skip.map((s) => s.toLowerCase()));
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { skippedDirs++; return; }
    for (const d of entries) {
      const relPath = rel ? `${rel}\\${d.name}` : d.name;
      if (d.isDirectory()) { if (!(rel === "" && skip.has(d.name.toLowerCase()))) walk(path.join(dir, d.name), relPath); continue; }
      if (!d.isFile() || !INDEXED_EXTS.has(path.extname(d.name).toLowerCase())) continue;
      let st; try { st = fs.statSync(path.join(dir, d.name)); } catch { continue; }
      const c = classify(relPath);
      const brand = root.brand ?? c.brand;
      insert.run(fileId(d.name, st.size), root.src, r, relPath, d.name, path.dirname(relPath) === "." ? "" : path.dirname(relPath),
        c.ext, st.size, brand, c.kind, null, null, Math.floor(st.mtimeMs));
      if (++files % 20000 === 0) console.log(`${files} files read…`);
    }
  };
  walk(root.path, "");
});
// Kittl: kittl.json is [{ id, name, kind: "project"|"upload"|"ai", brand, thumbnailUrl, url, createdAt }]. Kittl's image library is
// already copied into the Studio Library by the console's hourly sync, so this lists the projects.
if (fs.existsSync(KITTL_FILE)) {
  for (const k of JSON.parse(fs.readFileSync(KITTL_FILE, "utf8"))) {
    insert.run(fileId(`kittl:${k.id}`, 0), "kittl", null, null, k.name || "Untitled", `Kittl ${k.kind === "project" ? "projects" : k.kind === "ai" ? "AI images" : "uploads"}`,
      "", null, k.brand === "c3d" ? "c3d" : "ed", k.kind === "project" ? "kittl" : "image", k.thumbnailUrl ?? null, k.url ?? null, Date.parse(k.createdAt) || null);
  }
}
db.exec("COMMIT");
db.exec("CREATE INDEX by_brand ON items (brand, kind, name)");
const count = db.prepare("SELECT COUNT(*) n FROM items").get().n;
db.close();
fs.writeFileSync(CURRENT_FILE, name);
// Older indexes go once the server has let go of them (it switches within a minute).
for (const f of fs.readdirSync(DATA_DIR)) if (/^index-\d+\.db$/.test(f) && f !== name) { try { fs.rmSync(path.join(DATA_DIR, f)); } catch { /* still open */ } }
console.log(`Index ready: ${count} distinct files from ${files} read (${skippedDirs} folders could not be opened).`);
