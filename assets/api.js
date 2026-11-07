// The studio key (the same CONSOLE_KEY as the Business Console), remembered on this device so it is
// typed once, and the small prompt that asks for it. A key the server refuses is dropped at once.
import { el } from "./util.js";

const KEY = "ds-studio-key";
export const consoleKey = {
  get() { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } },
  set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
  clear() { this.set(""); for (const fn of keyListeners) fn(false); },
};
const keyListeners = new Set();
export const onKeyChange = (fn) => keyListeners.add(fn);

let dlg = null, asking = null, settle = null;
// Settles the open question right away. Waiting for the dialog's close event left a short gap
// where a second request (say, a retry right after Cancel) got the old, already cancelled answer.
function finishKey(v) {
  const done = settle;
  settle = null; asking = null;
  if (dlg) dlg.returnValue = "";
  if (v) { consoleKey.set(v); for (const fn of keyListeners) fn(true); }
  done?.(v || null);
}
export function askForKey(reason = "Changes to the library need the studio key (the CONSOLE_KEY value, the same as the Business Console's).") {
  // Two calls at once share one prompt.
  if (asking) return asking;
  if (!dlg) {
    const input = el("input", { class: "field", id: "key-in", type: "password", autocomplete: "off", required: true });
    const msg = el("p", { class: "muted small", id: "key-msg" });
    const cancel = el("button", { class: "btn", type: "button", id: "key-cancel" }, "Cancel");
    const form = el("form", { method: "dialog", class: "stack" },
      el("h2", { id: "key-title" }, "Studio key"), msg,
      el("label", { class: "stack", style: "gap:4px", for: "key-in" }, "Key", input),
      el("p", { class: "muted small" }, "Remembered on this device, so you only type it once."),
      el("div", { class: "row", style: "justify-content:flex-end" }, cancel, el("button", { class: "btn primary", type: "submit", id: "key-save" }, "Use key")));
    dlg = el("dialog", { class: "palette keydlg", "aria-labelledby": "key-title", "aria-describedby": "key-msg" }, form);
    document.body.append(dlg);
    cancel.addEventListener("click", () => { dlg.close(""); finishKey(null); });
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { dlg.close(v); finishKey(v); } });
    // Escape closes the dialog without a button; a newer prompt that is already open is left alone.
    dlg.addEventListener("close", () => { if (!dlg.open && settle) finishKey(dlg.returnValue); });
  }
  dlg.querySelector("#key-msg").textContent = reason;
  const input = dlg.querySelector("#key-in");
  input.value = "";
  asking = new Promise((resolve) => {
    settle = resolve;
    dlg.showModal();
    input.focus();
  });
  return asking;
}
