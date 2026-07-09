export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 640 }}>
      <h1>teio-context</h1>
      <p>Shared context layer. Canonical context lives in git; this is the control plane.</p>
      <p>
        Health: <code>/api/health</code>
      </p>
    </main>
  )
}
