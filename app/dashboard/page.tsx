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

      {/* Owner: create is at the top so it never gets buried under a long list. */}
      {isStaff && (
        <form onSubmit={createProject} className="card card-pad" style={{ marginBottom: 4 }}>
          <div className="row">
            <input className="input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Acme Corp" />
            <input className="input" style={{ flex: 1 }} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug — e.g. acme" />
            <button type="submit" className="btn btn-primary" disabled={creating || !slug || !name}>
              {creating ? 'Provisioning…' : 'Create project'}
            </button>
          </div>
          <div className="faint" style={{ marginTop: 8 }}>
            Provisions a git repo + branch protection, then registers the space. You become its Admin.
          </div>
        </form>
      )}

      <div className="section-label">Your projects</div>
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
    </Shell>
  )
}
