// Turns a Workers KV namespace (the IMAGES binding) into the small blob store lib/images.mjs uses.
// Each image is one KV value: the file's bytes, with its name, type, size, tags and date as the
// key's KV metadata, so listing the library is a single list call with no extra reads.
// Keys are stored as "image:<key>" so the namespace can hold other things later without mixing.
//
// Workers KV limits this relies on: values up to 25 MiB (uploads are capped at 20 MB in
// lib/images.mjs), metadata up to 1024 bytes (name and tags are capped there too), and list
// pages of up to 1000 keys (followed here by cursor). KV is eventually consistent: a new or
// deleted image can take up to a minute to show in the list from other locations.
export const PREFIX = "image:";

// The Creative Lab engine keeps a saved copy of the shirt apps' public list under this key (its lib/kv-store.mjs).
// A change here drops it, once per store, so the apps see the change on their next visit.
export const SNAPSHOT_KEY = "snapshot:public-images";

export function kvBlobStore(kv) {
  let dropped = false;
  const changed = async () => {
    if (dropped) return;
    dropped = true;
    try { await kv.delete(SNAPSHOT_KEY); } catch { /* the copy also expires by age */ }
  };
  return {
    async list() {
      const blobs = [];
      let cursor;
      do {
        const page = await kv.list({ prefix: PREFIX, cursor });
        for (const k of page.keys) blobs.push({ key: k.name.slice(PREFIX.length), metadata: k.metadata ?? null });
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return { blobs };
    },
    async getWithMetadata(key, { type = "arrayBuffer" } = {}) {
      const { value, metadata } = await kv.getWithMetadata(PREFIX + key, { type });
      return value === null ? null : { data: value, metadata: metadata ?? {} };
    },
    async set(key, data, { metadata } = {}) {
      await kv.put(PREFIX + key, data, { metadata });
      await changed();
    },
    async delete(key) {
      await kv.delete(PREFIX + key);
      await changed();
    },
  };
}
