// Reads the studio key (CONSOLE_KEY) that setup.ps1 stored. Aaron types it there into a hidden prompt and
// Windows encrypts it for his account only (DPAPI), so it never sits in a plain file, the repo or a log.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { KEY_FILE } from "./config.mjs";

export function readKey() {
  if (process.env.DRIVE_KEY_FOR_TESTS) return process.env.DRIVE_KEY_FOR_TESTS;
  if (!fs.existsSync(KEY_FILE)) return "";
  const ps = "$s = Get-Content -LiteralPath $env:DRIVE_KEY_FILE | ConvertTo-SecureString; " +
    "[Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))";
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps],
      { env: { ...process.env, DRIVE_KEY_FILE: KEY_FILE }, encoding: "utf8", windowsHide: true }).trim();
  } catch { return ""; }
}
