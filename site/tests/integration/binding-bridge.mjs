// This Worker runs only inside Wrangler's isolated integration harness. It lets
// Node-side assertions inspect the same D1 and R2 bindings as the app Worker.
const bindingBridge = {
  async fetch(request, env) {
    try {
      const { operation, sql, params = [], key, value, options } = await request.json();
      let result;
      if (operation === "run" || operation === "all" || operation === "first") {
        result = await env.DB.prepare(sql).bind(...params)[operation]();
      } else if (operation === "r2-put") {
        await env.MEDIA.put(key, value);
        result = { key };
      } else if (operation === "r2-head") {
        const object = await env.MEDIA.head(key);
        result = object ? { key: object.key } : null;
      } else if (operation === "r2-get") {
        const object = await env.MEDIA.get(key);
        result = object ? { key: object.key } : null;
      } else if (operation === "r2-delete") {
        await env.MEDIA.delete(key);
        result = null;
      } else if (operation === "r2-list") {
        const listed = await env.MEDIA.list(options);
        result = { objects: listed.objects.map(({ key: objectKey }) => ({ key: objectKey })) };
      } else {
        return Response.json({ error: "Unknown integration bridge operation" }, { status: 400 });
      }
      return Response.json({ result });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  },
};

export default bindingBridge;
