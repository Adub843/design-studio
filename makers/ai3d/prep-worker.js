// Runs print prep off the page's main thread so the editor stays smooth while a part is built.
import { prepareFromField } from "./print-prep.js";
import { writeStl, write3mf } from "./files.js";

self.onmessage = async (e) => {
  const { id, field, res, threshold, turn, options, title } = e.data;
  try {
    const { mesh, report } = prepareFromField({ field, res, threshold, turn }, options);
    const stl = writeStl(mesh, title);
    const tmf = await write3mf(mesh, title);
    self.postMessage({ id, ok: true, positions: mesh.positions, indices: mesh.indices, report, stl, tmf },
      [mesh.positions.buffer, mesh.indices.buffer, stl.buffer, tmf.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
