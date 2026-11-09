// Geometry worker for the CSG makers (organizer, dice, flexi): runs a maker's generator off the page.
// It is served with its own security policy that lets manifold-3d compile its bindings; it can't touch the page.
import { loadManifold } from "/makers/param/geom.js";
const ID = /^[a-z0-9-]+$/;
self.onmessage = async (e) => {
  const { seq, id, p } = e.data;
  try {
    if (!ID.test(id)) throw new Error("Unknown maker.");
    const gen = (await import(`/makers/${id}/gen.js`)).default;
    const result = await gen.build(p, { images: {}, loadManifold });
    const transfer = []; for (const o of result.objects) transfer.push(o.mesh.pos.buffer, o.mesh.idx.buffer);
    self.postMessage({ seq, result }, transfer);
  } catch (err) { self.postMessage({ seq, error: String(err && err.message || err) }); }
};
