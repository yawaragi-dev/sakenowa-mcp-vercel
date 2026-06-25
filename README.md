# `sakenowa-mcp-vercel`

Vercel deploy wrapper for [`@yawaragi/sakenowa-mcp`](https://github.com/yawaragi-dev/sakenowa-mcp). Exposes the MCP streamable-HTTP endpoint as a Next.js Pages-API function, so the OSS MCP server (which natively wants a long-lived `http.Server.listen()`) can run on Vercel's serverless model.

The endpoint is at `/api/mcp`. Point any MCP client (the Vercel AI SDK's `@ai-sdk/mcp`, Claude Desktop, etc.) at `https://<your-deploy>/mcp` (with the `/api` path prefix configured in the wrapper, see below — `MCP_HTTP_PATH` style env var coming in a follow-up).

## How it works

[`@yawaragi/sakenowa-mcp@0.1.0`](https://www.npmjs.com/package/@yawaragi/sakenowa-mcp) ships a streamable-HTTP transport that is **already stateless per request** — a fresh `Server` + `StreamableHTTPServerTransport` is constructed inside every invocation, then closed when the response stream ends. The published `createMcpHttpServer(...)` wrapper just plugs that per-request handler into Node's `http.createServer`.

This project does the same thing, but plugs the per-request handler into a Next.js Pages-API function instead. Result: each Vercel function invocation does the equivalent of one stock sakenowa-mcp request, with no state shared between invocations except the pg connection pool (which Vercel keeps warm across requests on the same function container).

The handler lives at [`pages/api/mcp.ts`](./pages/api/mcp.ts) and mirrors sakenowa-mcp's internal `handleRequest` (`@yawaragi/sakenowa-mcp/dist/http.js`) closely.

## Deploy

1. **Connect this repo to a Vercel project** in the Vercel dashboard. Set the project name to `sakenowa-mcp` (or whatever — the deploy URL is what matters downstream).
2. **Set the project region to `fra1`** (Frankfurt, EU) for DPA continuity with the Supabase mirror. Already pinned in [`vercel.json`](./vercel.json).
3. **Set the environment variable `DATABASE_URL`** to the Sakenowa-mirrored Postgres connection string. Use the EU pooler URL (`aws-1-eu-central-1.pooler.supabase.com:5432`), NOT the direct DB URL — serverless concurrency would otherwise blow through `max_connections`. See [`.env.example`](./.env.example).
4. **Deploy.** Vercel auto-deploys on push.
5. **Smoke-test** the deployment:

   ```bash
   curl -s -X POST https://<your-deploy>.vercel.app/api/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
   ```

   Expected: a JSON-RPC response advertising the six tools (`list_prefectures`, `search_sakes_by_name`, `find_similar_sakes`, `get_sake_details`, `find_sakes_by_flavor`, `get_top_ranked`).

6. **Point the yawaragi app at the deploy** — set `MCP_SAKENOWA_URL=https://<your-deploy>.vercel.app/api/mcp` on the yawaragi Vercel project (Production + Preview).

## Auth

`@yawaragi/sakenowa-mcp` v0.1.0 ships with no built-in authentication — the OSS asset's contract is "anyone with `DATABASE_URL` can query, anyone with the HTTP endpoint can query." The data is public-domain Sakenowa data, and no PII / user-state ever passes through the server.

If you want to restrict access, layer auth in front: Vercel rewrite with a bearer token, Cloudflare Tunnel with mTLS, etc. **Not built into this wrapper.**

## Caveats

- **`enableJsonResponse: true`** — the wrapper requests plain `application/json` responses, not the SSE-streamed variant. All six tools are short synchronous reads; streaming would only matter if a future tool added long-running work.
- **Cold-start cost**: ~200–500ms to construct the pg pool + first MCP `Server`. Subsequent warm invocations are near-instant.
- **Subpath imports** (`@yawaragi/sakenowa-mcp/dist/server.js`): brittle because v0.1.0 has no public `exports` field. A patch-level follow-up against sakenowa-mcp to add `exports` mapping is tracked separately; once that ships, switch to named subpath imports here.
- **Pool sizing**: default `Pool` has `max: 10`. Vercel can spawn many parallel function containers; the Supabase pooler handles that fine, but if you switch to a direct DB URL you'd need to tune.

## Local dev

```bash
pnpm install
DATABASE_URL=postgresql://... pnpm dev   # binds on :3030 by default

# In another terminal
curl -s -X POST http://localhost:3030/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
