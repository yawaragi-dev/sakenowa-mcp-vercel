import type { NextApiRequest, NextApiResponse } from 'next'

import { createPool } from '@yawaragi/sakenowa-mcp/dist/db.js'
import { createServer } from '@yawaragi/sakenowa-mcp/dist/server.js'
import { createLogger, type LogLevel } from '@yawaragi/sakenowa-mcp/dist/logger.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

/**
 * Vercel deploy wrapper for @yawaragi/sakenowa-mcp.
 *
 * Mirrors sakenowa-mcp's internal `handleRequest` (`dist/http.js`) but
 * targets Vercel's serverless function model rather than a long-running
 * `http.Server.listen()`. The published streamable-HTTP transport is
 * already stateless per request — a fresh `Server` + transport is built
 * inside every invocation — which maps cleanly onto a Vercel function.
 *
 * Shared module-scope state across warm invocations:
 *   - `pool`: one pg pool per function container (cold-start once).
 *   - `logger`: stateless; cheap to construct, but reuse anyway.
 *   - `db`: the `Db` seam sakenowa-mcp expects (`query<R>(sql, params?)`).
 *
 * Per-invocation state:
 *   - A fresh `Server` (the MCP server with the six tool registrations).
 *   - A fresh `StreamableHTTPServerTransport` (stateless mode: no
 *     `sessionIdGenerator`, `enableJsonResponse: true` — same as
 *     sakenowa-mcp's stock config).
 *
 * Subpath imports (`@yawaragi/sakenowa-mcp/dist/server.js`) are brittle
 * because sakenowa-mcp v0.1.0 has no public `exports` field; if its
 * `dist/` layout ever moves, this breaks. A patch-level follow-up
 * against sakenowa-mcp to add an `exports` map is tracked separately.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — point at the Sakenowa-mirrored Postgres')
}

// sakenowa-mcp's `createPool` returns a `pg.Pool` that structurally
// satisfies the package's `Db` interface — no adapter code, no risk of
// the seam drifting if sakenowa-mcp tightens the interface later.
const db = createPool(process.env.DATABASE_URL)

const logger = createLogger((process.env.MCP_LOG_LEVEL as LogLevel) ?? 'error')

// Next.js's default body parser eats the raw request stream; the MCP
// transport needs to read it itself (and we need to JSON.parse manually
// to match sakenowa-mcp's error envelope on bad JSON).
export const config = {
  api: {
    bodyParser: false,
  },
}

function respondError(
  res: NextApiResponse,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null })
}

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  let body: unknown
  if (req.method === 'POST') {
    const raw = await readRawBody(req)
    if (raw !== '') {
      try {
        body = JSON.parse(raw)
      } catch {
        respondError(res, 400, -32700, 'Parse error: request body is not valid JSON')
        return
      }
    }
  }

  try {
    const transport = new StreamableHTTPServerTransport({
      // Stateless mode — `enableJsonResponse: true` returns
      // application/json rather than SSE, which is fine for short
      // synchronous reads (all six Sakenowa tools).
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const server = createServer(db, logger)
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`http request failed: ${message}`)
    if (!res.headersSent) {
      respondError(res, 500, -32603, 'Internal server error')
    }
  }
}
