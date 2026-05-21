async function supabase(url, supabaseUrl, supabaseKey, options = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      ...options.headers,
    }
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return null }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret)
    return res.status(401).json({ error: 'Unauthorized' })

  const { telegram_id, days } = req.body
  if (!telegram_id || !days) return res.status(400).json({ error: 'telegram_id and days required' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  const now = new Date()
  let newExpiry

  // Ищем существующую активную подписку
  const existing = await supabase(
    `subscriptions?user_id=eq.${telegram_id}&plan=eq.pro&order=expires_at.desc&limit=1`,
    supabaseUrl, supabaseKey, { method: 'GET' }
  )

  if (Array.isArray(existing) && existing.length > 0 && new Date(existing[0].expires_at) > now) {
    // Продлеваем существующую
    const current = new Date(existing[0].expires_at)
    current.setDate(current.getDate() + parseInt(days))
    newExpiry = current.toISOString()

    const patchRes = await supabase(
      `subscriptions?id=eq.${existing[0].id}`,
      supabaseUrl, supabaseKey,
      {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ expires_at: newExpiry, granted_by_admin: true })
      }
    )
    if (patchRes?.error) return res.status(500).json({ error: patchRes.error.message || 'Patch failed' })
  } else {
    // Создаём новую
    newExpiry = new Date(now.getTime() + parseInt(days) * 24 * 60 * 60 * 1000).toISOString()

    const insertRes = await supabase(
      `subscriptions`,
      supabaseUrl, supabaseKey,
      {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: telegram_id,
          plan: 'pro',
          starts_at: now.toISOString(),
          expires_at: newExpiry,
          granted_by_admin: true,
          price_paid: 0,
        })
      }
    )
    if (insertRes?.error) return res.status(500).json({ error: insertRes.error.message || 'Insert failed' })
  }

  return res.status(200).json({ ok: true, expires_at: newExpiry })
}
