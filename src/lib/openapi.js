export function openapi(base) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Music Search & Download API",
      version: "2.0.0",
      description: "Aggregated legal music search (Deezer, iTunes, Openverse, Internet Archive, Jamendo, SoundCloud) with preview & download proxy.",
    },
    servers: [{ url: base }],
    paths: {
      "/api/v1/search": { get: { summary: "Search tracks", parameters: [
        { name: "q", in: "query", required: true, schema: { type: "string" } },
        { name: "source", in: "query", schema: { type: "string", enum: ["all","deezer","itunes","openverse","archive","jamendo","soundcloud"] } },
        { name: "page", in: "query", schema: { type: "integer" } },
        { name: "lang", in: "query", schema: { type: "string", enum: ["fa","en"] } },
      ], responses: { "200": { description: "Results" } } } },
      "/api/v1/track": { get: { summary: "Track details", parameters: [
        { name: "id", in: "query", required: true, schema: { type: "string" } },
      ], responses: { "200": { description: "Track" }, "404": { description: "Not found" } } } },
      "/api/v1/download": { get: { summary: "Download track (proxied)", parameters: [
        { name: "id", in: "query", required: true, schema: { type: "string" } },
        { name: "index", in: "query", schema: { type: "integer" } },
      ], responses: { "200": { description: "Audio stream" }, "403": { description: "Not downloadable" } } } },
      "/api/v1/stream": { get: { summary: "Preview stream proxy (Range supported)", parameters: [
        { name: "url", in: "query", required: true, schema: { type: "string" } },
      ], responses: { "200": { description: "Audio stream" } } } },
      "/api/v1/cover": { get: { summary: "Cover image proxy", parameters: [
        { name: "url", in: "query", required: true, schema: { type: "string" } },
      ], responses: { "200": { description: "Image" } } } },
      "/health": { get: { summary: "Health; ?deep=1 for upstream checks", responses: { "200": { description: "Status" } } } },
    },
    components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      bearer: { type: "http", scheme: "bearer" } } },
  };
}
