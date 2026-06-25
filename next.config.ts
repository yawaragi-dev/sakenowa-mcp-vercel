import type { NextConfig } from 'next'

const config: NextConfig = {
  // The MCP SDK + @yawaragi/sakenowa-mcp use Node-only APIs (pg, node:http,
  // node:url) — keep them external rather than bundling, which Next would
  // otherwise try to do for an API route.
  serverExternalPackages: ['pg', '@modelcontextprotocol/sdk', '@yawaragi/sakenowa-mcp'],
}

export default config
