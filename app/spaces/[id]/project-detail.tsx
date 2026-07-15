'use client'

import { useCallback, useEffect, useState } from 'react'

type Role = 'admin' | 'editor' | 'reader'
type Tab = 'overview' | 'members' | 'tokens' | 'connectors' | 'history'

interface Member { id: string; principal_type: string; principal_id: string; role: Role; created_at: string }
interface TokenMeta { id: string; name: string; role: string; token_prefix: string; connector_id: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Connector { id: string; kind: string; name: string; write_back_policy: string; status: string }
interface AuditEvent { id: string; ts: string; actor_type: string; actor_display: string | null; actor_id: string | null; action: string; path: string | null; outcome: string }
interface Stats { current_sha: string | null; last_updated: string | null; writes_7d: number; docs: number; open_proposals: number }

const wrap: React.CSSProperties = { fontFamily: 'system-ui', maxWidth: 900, margin: '0 auto', padding: '2rem', lineHeight: 1.5 }
const btn: React.CSSProperties = { padding: '0.4rem 0.8rem', cursor: 'pointer', borderRadius: 6, border: '1px solid #888', background: '#fafafa' }
const danger: React.CSSProperties = { ...btn, borderColor: '#c88', color: '#a00' }
const input: React.CSSProperties = { padding: 6 }
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px 10px', fontSize: 13, color: '#555' }
const td: React.CSSProperties = { borderBottom: '1px solid #f0f0f0', padding: '6px 10px', fontSize: 14, verticalAlign: 'top' }
const fmt = (t: string | null) => (t ? new Date(t).toLocaleString() : '—')

async function getJSON(url: string) {
  const r = await fetch(url)
  if (r.status === 401) { window.location.href = '/sign-in'; return null }
  return r.ok ? r.json() : null
}

export default function ProjectDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [name, setName] = useState(id)
  const [role, setRole] = useState<Role>('reader')
  const [stats, setStats] = useState<Stats | null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [tokens, setTokens] = useState<TokenMeta[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [err, setErr] = useState<string | null>(null)
  const isAdmin = role === 'admin'

  // forms
  const [invEmail, setInvEmail] = useState(''); const [invRole, setInvRole] = useState<Role>('reader')
  const [pending, setPending] = useState<{ id: string; email: string; role: string; created_at: string }[]>([])
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
    <main style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ marginBottom: 0 }}>{name}</h1>
        <a href="/dashboard">← all projects</a>
      </div>
      <div style={{ color: '#777', fontSize: 13, marginBottom: 16 }}>your role: <strong>{role}</strong></div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #ddd', marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn, border: 'none', borderBottom: tab === t ? '2px solid #333' : '2px solid transparent', borderRadius: 0, background: 'none', fontWeight: tab === t ? 600 : 400, textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {err && <p style={{ color: '#b00' }}>{err}</p>}

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          <Stat label="Documents" value={stats?.docs ?? '…'} />
          <Stat label="Writes (7d)" value={stats?.writes_7d ?? '…'} />
          <Stat label="Open proposals" value={stats?.open_proposals ?? '…'} />
          <Stat label="Last updated" value={fmt(stats?.last_updated ?? null)} />
          <Stat label="Version" value={stats?.current_sha ? stats.current_sha.slice(0, 8) : '—'} />
        </div>
      )}

      {tab === 'members' && (
        <>
          {isAdmin && (
            <form onSubmit={async (e) => { e.preventDefault(); const r = await mutate(`/api/spaces/${id}/members`, 'POST', { email: invEmail, role: invRole }); if (r) { setInvEmail(''); void loadMembers() } }} style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="teammate@company.com" style={{ ...input, flex: 1 }} />
              <select value={invRole} onChange={(e) => setInvRole(e.target.value as Role)} style={input}>
                <option value="reader">reader</option><option value="editor">editor</option><option value="admin">admin</option>
              </select>
              <button type="submit" style={btn} disabled={!invEmail}>Invite by email</button>
            </form>
          )}
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={th}>Member</th><th style={th}>Type</th><th style={th}>Role</th><th style={th}>Added</th>{isAdmin && <th style={th} />}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={td}><code>{m.principal_id}</code></td><td style={td}>{m.principal_type}</td><td style={td}>{m.role}</td><td style={td}>{fmt(m.created_at)}</td>
                  {isAdmin && <td style={td}><button style={danger} onClick={async () => { if (confirm('Remove member?')) { await mutate(`/api/spaces/${id}/members/${m.id}`, 'DELETE'); void loadMembers() } }}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && pending.length > 0 && (
            <>
              <h3 style={{ marginTop: 20, fontSize: 15 }}>Pending invitations</h3>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>Email</th><th style={th}>Role</th><th style={th}>Invited</th></tr></thead>
                <tbody>{pending.map((p) => <tr key={p.id}><td style={td}>{p.email}</td><td style={td}>{p.role}</td><td style={td}>{fmt(p.created_at)}</td></tr>)}</tbody>
              </table>
              <p style={{ color: '#777', fontSize: 12 }}>They become members automatically once they sign up / log in with that email.</p>
            </>
          )}
          {!isAdmin && <p style={{ color: '#777', fontSize: 13 }}>Only admins can invite or remove members.</p>}
        </>
      )}

      {tab === 'tokens' && (
        <>
          {!isAdmin && <p style={{ color: '#777' }}>Only owners can manage tokens.</p>}
          {isAdmin && (
            <form onSubmit={async (e) => { e.preventDefault(); const r = await mutate(`/api/spaces/${id}/tokens`, 'POST', { name: tokName, role: tokRole, connectorId: tokConn || undefined }); if (r?.token) { setNewToken(r.token); setTokName(''); void loadTokens() } }} style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <input value={tokName} onChange={(e) => setTokName(e.target.value)} placeholder="Token name (e.g. ai-agent)" style={{ ...input, flex: 1 }} />
              <select value={tokRole} onChange={(e) => setTokRole(e.target.value)} style={input}><option value="reader">reader</option><option value="editor">editor</option></select>
              <select value={tokConn} onChange={(e) => setTokConn(e.target.value)} style={input}>
                <option value="">no connector</option>
                {connectors.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.write_back_policy})</option>)}
              </select>
              <button type="submit" style={btn} disabled={!tokName}>Generate</button>
            </form>
          )}
          {newToken && (
            <div style={{ border: '1px solid #cc9', background: '#fffbe6', borderRadius: 6, padding: 12, marginBottom: 12 }}>
              <strong>Copy this token now — it is shown only once:</strong>
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <code style={{ flex: 1, wordBreak: 'break-all' }}>{newToken}</code>
                <button style={btn} onClick={() => navigator.clipboard?.writeText(newToken)}>Copy</button>
                <button style={btn} onClick={() => setNewToken(null)}>Done</button>
              </div>
            </div>
          )}
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Role</th><th style={th}>Prefix</th><th style={th}>Last used</th><th style={th}>Created</th>{isAdmin && <th style={th} />}</tr></thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} style={{ opacity: t.revoked_at ? 0.45 : 1 }}>
                  <td style={td}>{t.name}</td><td style={td}>{t.role}</td><td style={td}><code>{t.token_prefix}…</code></td>
                  <td style={td}>{fmt(t.last_used_at)}</td><td style={td}>{fmt(t.created_at)}</td>
                  {isAdmin && <td style={td}>{t.revoked_at ? <span style={{ color: '#999' }}>revoked</span> : <button style={danger} onClick={async () => { if (confirm('Revoke token?')) { await mutate(`/api/spaces/${id}/tokens/${t.id}`, 'DELETE'); void loadTokens() } }}>Revoke</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === 'connectors' && (
        <>
          {isAdmin && (
            <form onSubmit={async (e) => { e.preventDefault(); const r = await mutate(`/api/spaces/${id}/connectors`, 'POST', { kind: connKind, name: connName, writeBackPolicy: connPolicy }); if (r) { setConnName(''); void loadConnectors() } }} style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <select value={connKind} onChange={(e) => setConnKind(e.target.value)} style={input}><option value="mcp">mcp</option><option value="teio">teio</option><option value="customer">customer</option></select>
              <input value={connName} onChange={(e) => setConnName(e.target.value)} placeholder="Connector name" style={{ ...input, flex: 1 }} />
              <select value={connPolicy} onChange={(e) => setConnPolicy(e.target.value)} style={input}><option value="inherit">inherit</option><option value="auto_merge_clean">auto_merge_clean</option><option value="proposal_only">proposal_only</option></select>
              <button type="submit" style={btn} disabled={!connName}>Add</button>
            </form>
          )}
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Kind</th><th style={th}>Write-back policy</th><th style={th}>Status</th></tr></thead>
            <tbody>{connectors.map((c) => <tr key={c.id}><td style={td}>{c.name}</td><td style={td}>{c.kind}</td><td style={td}>{c.write_back_policy}</td><td style={td}>{c.status}</td></tr>)}</tbody>
          </table>
        </>
      )}

      {tab === 'history' && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={th}>When</th><th style={th}>Actor</th><th style={th}>Action</th><th style={th}>Path</th><th style={th}>Outcome</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={td}>{fmt(e.ts)}</td>
                <td style={td}>{e.actor_display ?? e.actor_id ?? e.actor_type}</td>
                <td style={td}>{e.action}</td>
                <td style={td}>{e.path ?? '—'}</td>
                <td style={{ ...td, color: e.outcome === 'ok' ? '#080' : e.outcome === 'conflict' ? '#a60' : '#b00' }}>{e.outcome}</td>
              </tr>
            ))}
            {events.length === 0 && <tr><td style={td} colSpan={5}>No activity yet.</td></tr>}
          </tbody>
        </table>
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: '0.75rem 1rem' }}>
      <div style={{ fontSize: 12, color: '#777' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  )
}
