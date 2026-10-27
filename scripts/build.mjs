// Builds dist/: only the app itself (index.html and assets/), which is all the Worker serves as
// files, so lib/, scripts/, worker/, data/, package.json and the README are never downloadable.
// Plain Node, so it works the same on Windows, macOS and Linux. wrangler runs it before dev and deploy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const f of ["index.html", "assets"]) fs.cpSync(path.join(root, f), path.join(dist, f), { recursive: true });
console.log("Built dist/ (index.html and assets/)");
