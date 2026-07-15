'use client'

import { useCallback, useEffect, useState } from 'react'
import { Shell } from '../../shell'

type Role = 'admin' | 'editor' | 'reader'
type Tab = 'overview' | 'members' | 'tokens' | 'connectors' | 'history'

interface Member { id: string; principal_type: string; principal_id: string; role: Role; created_at: string }
interface Pending { id: string; email: string; role: string; created_at: string }
interface TokenMeta { id: string; name: string; role: string; token_prefix: string; connector_id: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Connector { id: string; kind: string; name: string; write_back_policy: string; status: string }
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
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [err, setErr] = useState<string | null>(null)
  const isAdmin = role === 'admin'

  const [invEmail, setInvEmail] = useState(''); const [invRole, setInvRole] = useState<Role>('reader')
  const [tokName, setTokName] = useState(''); const [tokRole, setTokRole] = useState('editor'); const [tokConn, setTokConn] = useState('')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [connKind, setConnKind] = useState('mcp'); const [connName, setConnName] = useState(''); const [connPolicy, setConnPolicy] = useState('inherit')

  const loadCore = useCallback(async () => {
    const sp = await getJSON('/api/spaces')
    const mine = sp?.spaces?.find((s: { id: string }) => s.id === id)
    if (mine) { setName(mine.name); setRole(mine.role) }
    const act = await getJSON(`/api/spaces/${id}/activity`)
    if (act) { setStats(act.stats); setEvents(act.events ?? []) }
  }, [id])
  const loadMembers = useCallback(async () => { const d = await getJSON(`/api/spaces/${id}/members`); if (d) { setMembers(d.members ?? []); setPending(d.pending ?? []) } }, [id])
  const loadTokens = useCallback(async () => { const d = await getJSON(`/api/spaces/${id}/tokens`); if (d) setTokens(d.tokens ?? []) }, [id])
  const loadConnectors = useCallback(async () => { const d = await getJSON(`/api/spaces/${id}/connectors`); if (d) setConnectors(d.connectors ?? []) }, [id])

  useEffect(() => { void loadCore() }, [loadCore])
  useEffect(() => {
    if (tab === 'members') void loadMembers()
    if (tab === 'tokens') { void loadTokens(); void loadConnectors() }
    if (tab === 'connectors') void loadConnectors()
  }, [tab, loadMembers, loadTokens, loadConnectors])

  async function mutate(url: string, method: string, body?: unknown): Promise<any> {
    setErr(null)
    const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    if (!r.ok && r.status !== 204) { const j = await r.json().catch(() => ({})); setErr(j.message ?? j.error ?? `${method} failed (${r.status})`); return null }
    return r.status === 204 ? {} : r.json().catch(() => ({}))
  }

  const tabs: Tab[] = ['overview', 'members', 'tokens', 'connectors', 'history']

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
                    <td><code>{m.principal_id}</code></td><td className="muted">{m.principal_type}</td>
                    <td><span className={`tag tag-${m.role}`}>{m.role}</span></td><td className="muted">{fmt(m.created_at)}</td>
                    {isAdmin && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-danger" onClick={async () => { if (confirm('Remove member?')) { await mutate(`/api/spaces/${id}/members/${m.id}`, 'DELETE'); void loadMembers() } }}>Remove</button></td>}
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
                  <thead><tr><th>Email</th><th>Role</th><th>Invited</th></tr></thead>
                  <tbody>{pending.map((p) => <tr key={p.id}><td>{p.email}</td><td><span className={`tag tag-${p.role}`}>{p.role}</span></td><td className="muted">{fmt(p.created_at)}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          {!isAdmin && <p className="faint">Only admins can invite or remove members.</p>}
        </div>
      )}

      {tab === 'tokens' && (
        <div className="stack">
          {!isAdmin && <p className="faint">Only admins can manage tokens.</p>}
          {isAdmin && (
            <form className="card card-pad" onSubmit={async (e) => { e.preventDefault(); const r = await mutate(`/api/spaces/${id}/tokens`, 'POST', { name: tokName, role: tokRole, connectorId: tokConn || undefined }); if (r?.token) { setNewToken(r.token); setTokName(''); void loadTokens() } }}>
              <div className="row">
                <input className="input" style={{ flex: 1 }} value={tokName} onChange={(e) => setTokName(e.target.value)} placeholder="Token name — e.g. ai-agent" />
                <select className="select" value={tokRole} onChange={(e) => setTokRole(e.target.value)}><option value="reader">reader</option><option value="editor">editor</option></select>
                <select className="select" value={tokConn} onChange={(e) => setTokConn(e.target.value)}>
                  <option value="">no connector</option>
                  {connectors.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.write_back_policy})</option>)}
                </select>
                <button type="submit" className="btn btn-primary" disabled={!tokName}>Generate</button>
              </div>
            </form>
          )}
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
          <div className="card">
            <table className="table">
              <thead><tr><th>Name</th><th>Role</th><th>Prefix</th><th>Last used</th><th>Created</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} style={{ opacity: t.revoked_at ? 0.45 : 1 }}>
                    <td>{t.name}</td><td className="muted">{t.role}</td><td><code>{t.token_prefix}…</code></td>
                    <td className="muted">{fmt(t.last_used_at)}</td><td className="muted">{fmt(t.created_at)}</td>
                    {isAdmin && <td style={{ textAlign: 'right' }}>{t.revoked_at ? <span className="faint">revoked</span> : <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm('Revoke token?')) { await mutate(`/api/spaces/${id}/tokens/${t.id}`, 'DELETE'); void loadTokens() } }}>Revoke</button>}</td>}
                  </tr>
                ))}
                {tokens.length === 0 && <tr><td className="muted" colSpan={6}>No tokens yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'connectors' && (
        <div className="stack">
          {isAdmin && (
            <form className="card card-pad" onSubmit={async (e) => { e.preventDefault(); const r = await mutate(`/api/spaces/${id}/connectors`, 'POST', { kind: connKind, name: connName, writeBackPolicy: connPolicy }); if (r) { setConnName(''); void loadConnectors() } }}>
              <div className="row">
                <select className="select" value={connKind} onChange={(e) => setConnKind(e.target.value)}><option value="mcp">mcp</option><option value="teio">teio</option><option value="customer">customer</option></select>
                <input className="input" style={{ flex: 1 }} value={connName} onChange={(e) => setConnName(e.target.value)} placeholder="Connector name" />
                <select className="select" value={connPolicy} onChange={(e) => setConnPolicy(e.target.value)}><option value="inherit">inherit</option><option value="auto_merge_clean">auto_merge_clean</option><option value="proposal_only">proposal_only</option></select>
                <button type="submit" className="btn btn-primary" disabled={!connName}>Add</button>
              </div>
            </form>
          )}
          <div className="card">
            <table className="table">
              <thead><tr><th>Name</th><th>Kind</th><th>Write-back policy</th><th>Status</th></tr></thead>
              <tbody>
                {connectors.map((c) => <tr key={c.id}><td>{c.name}</td><td className="muted">{c.kind}</td><td>{c.write_back_policy}</td><td className="muted">{c.status}</td></tr>)}
                {connectors.length === 0 && <tr><td className="muted" colSpan={4}>No connectors yet.</td></tr>}
              </tbody>
            </table>
          </div>
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
