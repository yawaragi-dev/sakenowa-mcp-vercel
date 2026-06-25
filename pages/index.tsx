export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', lineHeight: 1.5 }}>
      <h1>sakenowa-mcp-vercel</h1>
      <p>
        Vercel deploy wrapper for <code>@yawaragi/sakenowa-mcp</code>. The MCP streamable-HTTP
        endpoint is at <code>/api/mcp</code>.
      </p>
      <p>
        Source:{' '}
        <a href="https://github.com/yawaragi-dev/sakenowa-mcp-vercel">
          github.com/yawaragi-dev/sakenowa-mcp-vercel
        </a>
      </p>
    </main>
  )
}
