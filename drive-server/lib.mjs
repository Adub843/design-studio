// Shared pieces of the E: drive library server: how a file is sorted (brand and kind), its id, and the
// request signature the Studio Worker sends. The Worker side of the signature is lib/drive.mjs.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

export const IMAGE_EXTS = new Set([".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif"]);
export const MODEL_EXTS = new Set([".stl", ".3mf", ".obj", ".step", ".stp"]);
// Design source files: listed and downloadable, shown with a file-type tile instead of a preview.
export const SOURCE_EXTS = new Set([".ai", ".eps", ".pdf", ".dxf", ".cdr", ".psd", ".tif", ".tiff", ".studio3"]);
export const INDEXED_EXTS = new Set([...IMAGE_EXTS, ...MODEL_EXTS, ...SOURCE_EXTS]);
// Thumbnails are made for these (sharp reads them all, SVG included).
export const THUMB_EXTS = new Set([...IMAGE_EXTS, ".tif", ".tiff"]);

// Top folders on E: that hold Charleston3D work. Every 3D model is Charleston3D's wherever it sits.
export const C3D_FOLDERS = new Set(["print files", "comercial downloaded 3d print files"]);

export function classify(relPath) {
  const parts = relPath.split(/[\\/]/);
  const top = parts.length > 1 ? parts[0] : "";
  const ext = path.extname(relPath).toLowerCase();
  const brand = MODEL_EXTS.has(ext) || C3D_FOLDERS.has(top.toLowerCase()) ? "c3d" : "ed";
  const kind = MODEL_EXTS.has(ext) ? "3d"
    : SOURCE_EXTS.has(ext) ? "source"
    : /dtf|halftone/i.test(relPath) ? "dtf"
    : /logo/i.test(relPath) ? "logo"
    : ext === ".svg" ? "svg" : "image";
  return { top, ext, brand, kind };
}

// One id per distinct file: the same name and size in two folders is the same file, listed once.
export const fileId = (name, size) => createHash("sha256").update(`${name.toLowerCase()}|${size}`).digest("hex").slice(0, 20);
export const ID_RE = /^[0-9a-f]{20}$/;

// The Worker signs each request with CONSOLE_KEY: HMAC over the expiry time and the path with its query.
export const MAX_SKEW_S = 300;
export const driveSig = (key, exp, pathAndQuery) =>
  createHmac("sha256", `drive:${key}`).update(`${exp}\n${pathAndQuery}`).digest("base64url");
export function verifySig(key, exp, sig, pathAndQuery, now = Date.now()) {
  if (!key || !sig || !/^\d{10}$/.test(String(exp))) return false;
  if (Math.abs(Number(exp) - Math.floor(now / 1000)) > MAX_SKEW_S) return false;
  const want = Buffer.from(driveSig(key, exp, pathAndQuery)), got = Buffer.from(String(sig));
  return want.length === got.length && timingSafeEqual(want, got);
}

export const CONTENT_TYPES = {
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".pdf": "application/pdf", ".stl": "model/stl", ".3mf": "model/3mf", ".obj": "model/obj", ".step": "model/step", ".stp": "model/step",
};
