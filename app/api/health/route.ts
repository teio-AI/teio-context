export const runtime = 'nodejs'

export async function GET() {
  return Response.json({ ok: true, service: 'teio-context', ts: new Date().toISOString() })
}
