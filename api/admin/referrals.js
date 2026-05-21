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
  return res.json()
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret)
    return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  const [refs, users] = await Promise.all([
    supabase('referrals?order=created_at.desc&limit=500', supabaseUrl, supabaseKey, { method: 'GET' }),
    supabase('users?select=telegram_id,name,username', supabaseUrl, supabaseKey, { method: 'GET' }),
  ])

  if (!Array.isArray(refs)) return res.status(200).json([])

  // Добавляем имена пользователей
  const userMap = {}
  if (Array.isArray(users)) {
    users.forEach(u => { userMap[u.telegram_id] = u.name || u.username || null })
  }

  const result = refs.map(r => ({
    ...r,
    referrer_name: userMap[r.referrer_id] || null,
    referee_name: userMap[r.referee_id] || null,
  }))

  return res.status(200).json(result)
}
