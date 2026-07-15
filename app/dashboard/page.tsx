'use client'

import { useEffect, useState } from 'react'
import { Shell } from '../shell'

interface SpaceSummary {
  id: string
  slug: string
  name: string
  role: 'admin' | 'editor' | 'reader'
}

export default function Dashboard() {
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null)
  const [isStaff, setIsStaff] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [ptokens, setPtokens] = useState<{ id: string; name: string; token_prefix: string; last_used_at: string | null; revoked_at: string | null }[]>([])
  const [ptName, setPtName] = useState('')
  const [newPt, setNewPt] = useState<string | null>(null)

  async function loadPersonal() {
    const r = await fetch('/api/me/tokens')
    if (r.ok) setPtokens((await r.json()).tokens ?? [])
  }

  async function load() {
    setErr(null)
    // /api/me first — it reconciles any pending email invitations into memberships.
    const meRes = await fetch('/api/me')
    if (meRes.status === 401) {
      window.location.href = '/sign-in'
      return
    }
    setIsStaff(!!(await meRes.json().catch(() => ({})))?.isStaff)
    const sp = await (await fetch('/api/spaces')).json().catch(() => ({ spaces: [] }))
    setSpaces(sp.spaces ?? [])
    void loadPersonal()
  }
  useEffect(() => {
    void load()
  }, [])

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setErr(null)
    const res = await fetch('/api/spaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, name }),
    })
    setCreating(false)
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).message ?? `create failed (${res.status})`)
      return
    }
    setSlug('')
    setName('')
    void load()
  }

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">Shared-context spaces you can access.</p>
        </div>
      </div>

      {err && <p className="neg">{err}</p>}

      {spaces === null ? (
        <p className="muted">Loading…</p>
      ) : spaces.length === 0 ? (
        <div className="empty">You&apos;re not a member of any project yet.</div>
      ) : (
        <div className="grid grid-cards">
          {spaces.map((s) => (
            <a key={s.id} href={`/spaces/${s.id}`} className="card card-link card-pad">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 15 }}>{s.name}</strong>
                <span className={`tag tag-${s.role}`}>{s.role}</span>
              </div>
              <div className="faint" style={{ marginTop: 2 }}>
                {s.slug}
              </div>
            </a>
          ))}
        </div>
      )}

      {isStaff && (
        <>
          <div className="section-label">Create a project (Owner)</div>
          <form onSubmit={createProject} className="card card-pad">
            <div className="row">
              <input className="input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Acme Corp" />
              <input className="input" style={{ flex: 1 }} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug — e.g. acme" />
              <button type="submit" className="btn btn-primary" disabled={creating || !slug || !name}>
                {creating ? 'Provisioning…' : 'Create'}
              </button>
            </div>
            <div className="faint" style={{ marginTop: 8 }}>
              Provisions a git repo + branch protection, then registers the space. You become its Admin.
            </div>
          </form>
        </>
      )}

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
