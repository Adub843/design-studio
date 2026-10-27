// A button that changes the live store only on a second click: the first click turns it into a
// question for a few seconds (no browser dialogs, which block the page).
import { el } from "./util.js";

export function confirmButton(label, ask, act, cls = "btn ghost") {
  const b = el("button", { class: cls, type: "button" }, label);
  let armed = false, timer = null;
  const reset = () => { armed = false; b.textContent = label; b.classList.remove("armed"); };
  b.addEventListener("click", async () => {
    if (!armed) {
      armed = true; b.textContent = ask; b.classList.add("armed");
      timer = setTimeout(reset, 5000);
      return;
    }
    clearTimeout(timer); reset(); b.disabled = true;
    try { await act(b); } finally { if (b.isConnected) b.disabled = false; }
  });
  return b;
}
