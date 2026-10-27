// The studio key check, shared with the Business Console: both Workers use the same CONSOLE_KEY
// secret, so one key unlocks the image library in either place.
import { createHash, timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// A short key can be guessed: anything under MIN_KEY_LENGTH characters is treated as not set.
export const MIN_KEY_LENGTH = 16;
const digest = (s) => createHash("sha256").update(String(s)).digest();

export function requireKey(req, env, what = "Changes") {
  const expected = env("CONSOLE_KEY") ?? "";
  if (!expected) throw new HttpError(403, "key_not_set", `${what} are turned off until CONSOLE_KEY is set in the studio's environment variables.`);
  if (expected.length < MIN_KEY_LENGTH) throw new HttpError(403, "key_too_short", `${what} are turned off until CONSOLE_KEY is at least ${MIN_KEY_LENGTH} characters (a long random password).`);
  const given = req.header("x-console-key");
  if (!given || !timingSafeEqual(digest(given), digest(expected)))
    throw new HttpError(401, "bad_key", "Wrong or missing studio key.");
}
