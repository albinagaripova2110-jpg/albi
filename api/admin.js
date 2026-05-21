async function supabaseGet(supabaseUrl, supabaseKey, path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
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
  const provided = req.headers['x-admin-secret']
  if (!adminSecret || provided !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  try {
    const [users, scans, subs] = await Promise.all([
      supabaseGet(supabaseUrl, supabaseKey, 'admin_users?select=*'),
      supabaseGet(supabaseUrl, supabaseKey, 'scans?select=id,created_at'),
      supabaseGet(supabaseUrl, supabaseKey, 'subscriptions?select=*&plan=eq.pro'),
    ])

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7)

    const scansThisMonth = Array.isArray(scans)
      ? scans.filter(s => new Date(s.created_at) >= monthStart).length
      : 0

    const newUsersThisWeek = Array.isArray(users)
      ? users.filter(u => new Date(u.created_at) >= weekStart).length
      : 0

    const proUsers = Array.isArray(subs)
      ? subs.filter(s => s.plan === 'pro' && (!s.expires_at || new Date(s.expires_at) > now)).length
      : 0

    return res.status(200).json({
      stats: {
        totalUsers: Array.isArray(users) ? users.length : 0,
        newUsersThisWeek,
        scansThisMonth,
        proUsers,
      },
      users: Array.isArray(users) ? users : [],
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
