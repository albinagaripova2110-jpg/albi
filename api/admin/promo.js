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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret)
    return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  // GET — список промокодов
  if (req.method === 'GET') {
    const data = await supabase(
      'promo_codes?order=created_at.desc',
      supabaseUrl, supabaseKey, { method: 'GET' }
    )
    return res.status(200).json(Array.isArray(data) ? data : [])
  }

  // POST — создать промокод
  if (req.method === 'POST') {
    const { code, bonus_days, discount_pct, max_uses, expires_at } = req.body
    if (!code) return res.status(400).json({ error: 'code required' })

    const result = await supabase(
      'promo_codes',
      supabaseUrl, supabaseKey,
      {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          code: code.toUpperCase().trim(),
          bonus_days: bonus_days || 0,
          discount_pct: discount_pct || 0,
          max_uses: max_uses || null,
          expires_at: expires_at || null,
          is_active: true,
        })
      }
    )
    return res.status(200).json(result)
  }

  // PATCH — включить/выключить промокод
  if (req.method === 'PATCH') {
    const { id, is_active } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })

    await supabase(
      `promo_codes?id=eq.${id}`,
      supabaseUrl, supabaseKey,
      { method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify({ is_active }) }
    )
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
