'use client'

import { useEffect, useState } from 'react'

interface SpaceSummary {
  id: string
  slug: string
  name: string
  role: 'owner' | 'editor' | 'reader'
}

const wrap: React.CSSProperties = { fontFamily: 'system-ui', maxWidth: 860, margin: '0 auto', padding: '2rem', lineHeight: 1.5 }
const card: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '0.75rem' }
const btn: React.CSSProperties = { padding: '0.45rem 0.9rem', cursor: 'pointer', borderRadius: 6, border: '1px solid #888', background: '#fafafa' }
const roleTag = (r: string): React.CSSProperties => ({
  fontSize: 12, padding: '2px 8px', borderRadius: 999, marginLeft: 8,
  background: r === 'owner' ? '#eef' : r === 'editor' ? '#efe' : '#eee', color: '#333',
})

export default function Dashboard() {
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null)
  const [isStaff, setIsStaff] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    setErr(null)
    const [meRes, spRes] = await Promise.all([fetch('/api/me'), fetch('/api/spaces')])
    if (meRes.status === 401) {
      window.location.href = '/sign-in'
      return
    }
    const me = await meRes.json().catch(() => ({}))
    setIsStaff(!!me.isStaff)
    const sp = await spRes.json().catch(() => ({ spaces: [] }))
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
      const j = await res.json().catch(() => ({}))
      setErr(j.message ?? `create failed (${res.status})`)
      return
    }
    setSlug('')
    setName('')
    void load()
  }

  return (
    <main style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Your projects</h1>
        <a href="/">home</a>
      </div>

      {err && <p style={{ color: '#b00' }}>{err}</p>}
      {spaces === null && <p>Loading…</p>}
      {spaces?.length === 0 && <p>You're not a member of any project yet.</p>}

      {spaces?.map((s) => (
        <div key={s.id} style={card}>
          <a href={`/spaces/${s.id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>
            {s.name}
          </a>
          <span style={roleTag(s.role)}>{s.role}</span>
          <div style={{ color: '#777', fontSize: 13 }}>{s.slug}</div>
        </div>
      ))}

      {isStaff && (
        <form onSubmit={createProject} style={{ ...card, marginTop: '1.5rem', background: '#fbfbfb' }}>
          <strong>New project</strong> <span style={{ color: '#777', fontSize: 13 }}>(staff)</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Acme Corp)" style={{ padding: 6, flex: 1 }} />
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug (e.g. acme)" style={{ padding: 6, flex: 1 }} />
            <button type="submit" style={btn} disabled={creating || !slug || !name}>
              {creating ? 'Provisioning…' : 'Create'}
            </button>
          </div>
          <div style={{ color: '#777', fontSize: 12, marginTop: 6 }}>Provisions a git repo + branch protection, then registers the space.</div>
        </form>
      )}
    </main>
  )
}
