'use client'

import { useCallback, useEffect, useState } from 'react'
import { Shell } from '../../shell'

type Role = 'admin' | 'editor' | 'reader'
type Tab = 'overview' | 'context' | 'members' | 'tokens' | 'history'

interface Member { id: string; principal_type: string; principal_id: string; role: Role; created_at: string; email?: string | null; is_owner?: boolean }
interface Pending { id: string; email: string; role: string; created_at: string }
interface TokenMeta { id: string; name: string; role: string | null; user_id: string | null; proposal_only: boolean; token_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null; owner_email?: string | null }
interface AuditEvent { id: string; ts: string; actor_type: string; actor_display: string | null; actor_id: string | null; action: string; path: string | null; outcome: string }
interface Stats { current_sha: string | null; last_updated: string | null; writes_7d: number; docs: number; open_proposals: number }

const fmt = (t: string | null) => (t ? new Date(t).toLocaleString() : '—')

async function getJSON(url: string) {
  const r = await fetch(url)
  if (r.status === 401) { window.location.href = '/sign-in'; return null }
  return r.ok ? r.json() : null
}

export default function ProjectDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [name, setName] = useState('Project')
  const [role, setRole] = useState<Role>('reader')
  const [stats, setStats] = useState<Stats | null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [tokens, setTokens] = useState<TokenMeta[]>([])
  const [docs, setDocs] = useState<{ path: string; title: string | null; updated_at: string }[]>([])
  const [openDoc, setOpenDoc] = useState<{ path: string; content: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const isAdmin = role === 'admin'

  const [invEmail, setInvEmail] = useState(''); const [invRole, setInvRole] = useState<Role>('reader')
  const [tokName, setTokName] = useState(''); const [tokReview, setTokReview] = useState(false); const [tokRole, setTokRole] = useState('editor')
  const [newToken, setNewToken] = useState<string | null>(null)

  const loadCore = useCallback(async () => {
    const sp = await getJSON('/api/spaces')
    const mine = sp?.spaces?.find((s: { id: string }) => s.id === id)
    if (mine) { setName(mine.name); setRole(mine.role) }
    const act = await getJSON(`/api/spaces/${id}/activity`)
    if (act) { setStats(act.stats); setEvents(act.events ?? []) }
  }, [id])
  const loadMembers = useCallback(async () => { const d = await getJSON(`/api/spaces/${id}/members`); if (d) { setMembers(d.members ?? []); setPending(d.pending ?? []) } }, [id])
  const loadTokens = useCallback(async () => { const d = await getJSON(`/api/spaces/${id}/tokens`); if (d) setTokens(d.tokens ?? []) }, [id])
  const loadDocs = useCallback(async () => { const d = await getJSON(`/api/spaces/${id}/documents`); if (d) setDocs(d.documents ?? []) }, [id])
  const openDocument = useCallback(async (path: string) => {
    const d = await getJSON(`/api/spaces/${id}/context?path=${encodeURIComponent(path)}`)
    if (d) setOpenDoc({ path, content: d.content ?? '' })
  }, [id])

  useEffect(() => { void loadCore() }, [loadCore])
  useEffect(() => {
    if (tab === 'members') void loadMembers()
    if (tab === 'tokens') void loadTokens()
    if (tab === 'context') void loadDocs()
  }, [tab, loadMembers, loadTokens, loadDocs])

  async function mutate(url: string, method: string, body?: unknown): Promise<any> {
    setErr(null)
    const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    if (!r.ok && r.status !== 204) { const j = await r.json().catch(() => ({})); setErr(j.message ?? j.error ?? `${method} failed (${r.status})`); return null }
    return r.status === 204 ? {} : r.json().catch(() => ({}))
  }

  // Tokens (service tokens) are admin-only — the tab is hidden from non-admins.
  const tabs: Tab[] = ['overview', 'context', 'members', ...(isAdmin ? (['tokens'] as Tab[]) : []), 'history']

  return (
    <Shell>
      <div className="page-head">
        <div>
          <div className="faint" style={{ marginBottom: 4 }}><a href="/dashboard">Projects</a> / {name}</div>
          <h1 className="page-title">
            {name} <span className={`tag tag-${role}`} style={{ verticalAlign: 'middle', marginLeft: 6 }}>{role}</span>
          </h1>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {err && <p className="neg">{err}</p>}

      {tab === 'overview' && (
        <div className="grid grid-stats">
          <Stat label="Documents" value={stats?.docs ?? '…'} />
          <Stat label="Writes (7d)" value={stats?.writes_7d ?? '…'} />
          <Stat label="Open proposals" value={stats?.open_proposals ?? '…'} />
          <Stat label="Version" value={stats?.current_sha ? stats.current_sha.slice(0, 8) : '—'} />
          <Stat label="Last updated" value={<span style={{ fontSize: 13 }}>{fmt(stats?.last_updated ?? null)}</span>} />
        </div>
      )}

      {tab === 'context' && (
        <div className="stack">
          <div className="card">
            <table className="table">
              <thead><tr><th>Document</th><th>Path</th><th>Updated</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.path} style={{ cursor: 'pointer' }} onClick={() => openDocument(d.path)}>
                    <td>{d.title ?? d.path.split('/').pop()}</td>
                    <td className="muted"><code>{d.path}</code></td>
                    <td className="muted">{fmt(d.updated_at)}</td>
                  </tr>
                ))}
                {docs.length === 0 && <tr><td className="muted" colSpan={3}>No context yet. Writes via the API/MCP or an agent&apos;s /teio-start appear here.</td></tr>}
              </tbody>
            </table>
          </div>
          {openDoc && (
            <div className="card card-pad">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong><code>{openDoc.path}</code></strong>
                <button className="btn btn-sm" onClick={() => setOpenDoc(null)}>Close</button>
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, background: 'var(--bg-subtle)', padding: 14, borderRadius: 8, margin: 0, maxHeight: 480, overflow: 'auto' }}>{openDoc.content}</pre>
            </div>
          )}
          <p className="faint">Context is markdown stored in git. This is the read view; agents/services write it via the API/MCP.</p>
        </div>
      )}

      {tab === 'members' && (
        <div className="stack">
          {isAdmin && (
            <form className="card card-pad" onSubmit={async (e) => { e.preventDefault(); const r = await mutate(`/api/spaces/${id}/members`, 'POST', { email: invEmail, role: invRole }); if (r) { setInvEmail(''); void loadMembers() } }}>
              <div className="row">
                <input className="input" style={{ flex: 1 }} type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="teammate@company.com" />
                <select className="select" value={invRole} onChange={(e) => setInvRole(e.target.value as Role)}>
                  <option value="reader">reader</option><option value="editor">editor</option><option value="admin">admin</option>
                </select>
                <button type="submit" className="btn btn-primary" disabled={!invEmail}>Invite by email</button>
              </div>
              <div className="faint" style={{ marginTop: 8 }}>They get an email; they become a member automatically once they sign up / log in with that address.</div>
            </form>
          )}
          <div className="card">
            <table className="table">
              <thead><tr><th>Member</th><th>Type</th><th>Role</th><th>Added</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.email ? <span>{m.email}</span> : <code>{m.principal_id}</code>}{m.email && <div className="faint" style={{ fontSize: 11 }}>{m.principal_id}</div>}</td><td className="muted">{m.principal_type}</td>
                    <td>{m.is_owner ? <span className="tag tag-admin">owner</span> : <span className={`tag tag-${m.role}`}>{m.role}</span>}</td><td className="muted">{fmt(m.created_at)}</td>
                    {isAdmin && <td style={{ textAlign: 'right' }}>{m.is_owner ? <span className="faint">—</span> : <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm('Remove member?')) { await mutate(`/api/spaces/${id}/members/${m.id}`, 'DELETE'); void loadMembers() } }}>Remove</button>}</td>}
                  </tr>
                ))}
                {members.length === 0 && <tr><td className="muted" colSpan={5}>No members.</td></tr>}
              </tbody>
            </table>
          </div>
          {isAdmin && pending.length > 0 && (
            <>
              <div className="section-label">Pending invitations</div>
              <div className="card">
                <table className="table">
                  <thead><tr><th>Email</th><th>Role</th><th>Invited</th><th /></tr></thead>
                  <tbody>{pending.map((p) => (
                    <tr key={p.id}>
                      <td>{p.email}</td><td><span className={`tag tag-${p.role}`}>{p.role}</span></td><td className="muted">{fmt(p.created_at)}</td>
                      <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Cancel the invite to ${p.email}?`)) { await mutate(`/api/spaces/${id}/invitations/${p.id}`, 'DELETE'); void loadMembers() } }}>Cancel</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
          {!isAdmin && <p className="faint">Only admins can invite or remove members.</p>}
        </div>
      )}

      {tab === 'tokens' && (
        <div className="stack">
          {/* Service tokens — for NON-HUMAN consumers (platform, CI, an external
              agent). Admin-only. Humans use their personal token (dashboard). */}
          <form className="card card-pad" onSubmit={async (e) => { e.preventDefault(); const r = await mutate(`/api/spaces/${id}/tokens`, 'POST', { name: tokName, role: tokRole, proposalOnly: tokReview }); if (r?.token) { setNewToken(r.token); setTokName(''); void loadTokens() } }}>
            <div className="row">
              <input className="input" style={{ flex: 1 }} value={tokName} onChange={(e) => setTokName(e.target.value)} placeholder="Service name — e.g. teio-platform" />
              <select className="select" value={tokRole} onChange={(e) => setTokRole(e.target.value)} aria-label="service token role">
                <option value="reader">reader</option><option value="editor">editor</option>
              </select>
              <label className="row faint" style={{ gap: 5 }}><input type="checkbox" checked={tokReview} onChange={(e) => setTokReview(e.target.checked)} /> require review</label>
              <button type="submit" className="btn btn-primary" disabled={!tokName}>Generate</button>
            </div>
            <div className="faint" style={{ marginTop: 8 }}>
              A <strong>service token</strong> for a non-human consumer, with a fixed role. &ldquo;Require review&rdquo; makes its writes open a PR. For your own agent/MCP, use your <strong>personal token</strong> on the dashboard instead.
            </div>
          </form>
          {newToken && (
            <div className="reveal">
              <strong>Copy this token now — it&apos;s shown only once:</strong>
              <div className="row" style={{ marginTop: 8 }}>
                <code style={{ flex: 1, wordBreak: 'break-all' }}>{newToken}</code>
                <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(newToken)}>Copy</button>
                <button className="btn btn-sm" onClick={() => setNewToken(null)}>Done</button>
              </div>
            </div>
          )}
          <div className="section-label">Service tokens</div>
          <div className="card">
            <table className="table">
              <thead><tr><th>Name</th><th>Owner</th><th>Role</th><th>Writes</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} style={{ opacity: t.revoked_at ? 0.45 : 1 }}>
                    <td>{t.name}</td>
                    <td className="muted">{t.owner_email ?? '—'}</td>
                    <td className="muted">{t.role ?? '—'}</td>
                    <td>{t.proposal_only ? <span className="tag tag-editor">review → PR</span> : <span className="muted">auto-merge</span>}</td>
                    <td className="muted">{fmt(t.last_used_at)}</td>
                    <td style={{ textAlign: 'right' }}>{t.revoked_at ? <span className="faint">revoked</span> : <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm('Revoke this token? Anything using it stops working immediately.')) { await mutate(`/api/spaces/${id}/tokens/${t.id}`, 'DELETE'); void loadTokens() } }}>Revoke</button>}</td>
                  </tr>
                ))}
                {tokens.length === 0 && <tr><td className="muted" colSpan={6}>No service tokens yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="faint">Owner column shows who created the token.</div>
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <table className="table">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Path</th><th>Outcome</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{fmt(e.ts)}</td>
                  <td>{e.actor_display ?? e.actor_id ?? e.actor_type}</td>
                  <td>{e.action}</td>
                  <td className="muted">{e.path ?? '—'}</td>
                  <td className={e.outcome === 'ok' ? 'pos' : e.outcome === 'conflict' ? '' : 'neg'} style={e.outcome === 'conflict' ? { color: 'var(--warn)' } : undefined}>{e.outcome}</td>
                </tr>
              ))}
              {events.length === 0 && <tr><td className="muted" colSpan={5}>No activity yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  )
}
