'use client'

import { useEffect, useState } from 'react'
import { Shell } from '../shell'

interface PersonalToken {
  id: string
  name: string
  token_prefix: string
  last_used_at: string | null
  revoked_at: string | null
}

export default function Settings() {
  const [ptokens, setPtokens] = useState<PersonalToken[]>([])
  const [ptName, setPtName] = useState('')
  const [newPt, setNewPt] = useState<string | null>(null)

  async function loadPersonal() {
    const r = await fetch('/api/me/tokens')
    if (r.status === 401) {
      window.location.href = '/sign-in'
      return
    }
    if (r.ok) setPtokens((await r.json()).tokens ?? [])
  }
  useEffect(() => {
    void loadPersonal()
  }, [])

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Your personal access token for the API &amp; MCP.</p>
        </div>
      </div>

      <div className="section-label">Personal access token</div>
      <form
        className="card card-pad"
        onSubmit={async (e) => {
          e.preventDefault()
          const r = await fetch('/api/me/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: ptName }) })
          if (r.ok) { setNewPt((await r.json()).token); setPtName(''); void loadPersonal() }
        }}
      >
        <div className="row">
          <input className="input" style={{ flex: 1 }} value={ptName} onChange={(e) => setPtName(e.target.value)} placeholder="Token name — e.g. my-laptop" />
          <button type="submit" className="btn btn-primary" disabled={!ptName}>Generate</button>
        </div>
        <div className="faint" style={{ marginTop: 8 }}>
          One token for <strong>all your projects</strong> — put it in your MCP config once; pick a project with <code>/teio-start &lt;slug&gt;</code>. Acts with your role on each project.
        </div>
      </form>
      {newPt && (
        <div className="reveal">
          <strong>Copy this token now — it&apos;s shown only once:</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <code style={{ flex: 1, wordBreak: 'break-all' }}>{newPt}</code>
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(newPt)}>Copy</button>
            <button className="btn btn-sm" onClick={() => setNewPt(null)}>Done</button>
          </div>
        </div>
      )}
      {ptokens.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <table className="table">
            <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th /></tr></thead>
            <tbody>
              {ptokens.map((t) => (
                <tr key={t.id} style={{ opacity: t.revoked_at ? 0.45 : 1 }}>
                  <td>{t.name}</td>
                  <td className="muted"><code>{t.token_prefix}…</code></td>
                  <td className="muted">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{t.revoked_at ? <span className="faint">revoked</span> : <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm('Revoke this personal token?')) { await fetch(`/api/me/tokens/${t.id}`, { method: 'DELETE' }); void loadPersonal() } }}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}
