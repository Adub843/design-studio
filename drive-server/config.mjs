// Where the library's files are and where its index and thumbnails are kept. Only reads from the roots:
// nothing on E: is ever moved, changed or deleted.
import os from "node:os";
import path from "node:path";

export const DATA_DIR = process.env.DRIVE_DATA ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "design-library");
// Names the index file in use (build-index.mjs writes a new one each run).
export const CURRENT_FILE = path.join(DATA_DIR, "current-index.txt");
export const THUMB_DIR = path.join(DATA_DIR, "thumbs");
export const KEY_FILE = path.join(DATA_DIR, "studio-key.dpapi");
export const PORT = Number(process.env.DRIVE_PORT ?? 8787);

export const ROOTS = [
  {
    src: "e", path: process.env.DRIVE_ROOT ?? "E:\\",
    // Not design art, or system folders.
    skip: ["$RECYCLE.BIN", "System Volume Information", "FOUND.000", "FOUND.001", "FOUND.002", "FOUND.003",
      "Survival Library", "Shit ton of links", "Fraud Account", "Font", "__AI___"],
  },
  // Images saved from the old Creative Lab Studios design lab, kept with each brand's own files.
  { src: "lab", brand: "ed", path: path.join(os.homedir(), "Aaron-Data", "02 Elevated Designs", "Design Lab Images"), skip: [] },
  { src: "lab", brand: "c3d", path: path.join(os.homedir(), "Aaron-Data", "01 Charleston3D", "Design Lab Images"), skip: [] },
];
// Kittl projects and images, listed from Kittl (thumbnails come from Kittl's own image server).
export const KITTL_FILE = path.join(DATA_DIR, "kittl.json");
export const KITTL_HOSTS = new Set(["cache.kittl.com", "assets.kittl.com", "kittl.com"]);
