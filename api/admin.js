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

  // ?section=payments — список платежей
  if (req.query.section === 'payments') {
    try {
      const payments = await supabaseGet(supabaseUrl, supabaseKey,
        'payment_orders?order=created_at.desc&limit=300&select=*')
      // Подтягиваем имена пользователей
      const users = await supabaseGet(supabaseUrl, supabaseKey, 'users?select=telegram_id,name,username')
      const userMap = {}
      if (Array.isArray(users)) users.forEach(u => { userMap[u.telegram_id] = u })
      const result = (Array.isArray(payments) ? payments : []).map(p => ({
        ...p,
        user_name: userMap[p.telegram_id]?.name || null,
        user_username: userMap[p.telegram_id]?.username || null,
      }))
      return res.status(200).json(result)
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  try {
    const [users, scans, subs] = await Promise.all([
      supabaseGet(supabaseUrl, supabaseKey, 'users?select=*&order=created_at.desc'),
      supabaseGet(supabaseUrl, supabaseKey, 'scans?select=id,user_id,created_at'),
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
      ? subs.filter(s => s.plan === 'pro' && s.expires_at && new Date(s.expires_at) > now).length
      : 0

    const trialUsers = Array.isArray(users)
      ? users.filter(u => u.trial_ends_at && new Date(u.trial_ends_at) > now).length
      : 0

    // Добавляем total_scans к каждому пользователю
    const scanCounts = {}
    if (Array.isArray(scans)) {
      scans.forEach(s => { scanCounts[s.user_id] = (scanCounts[s.user_id] || 0) + 1 })
    }
    const usersWithScans = Array.isArray(users)
      ? users.map(u => ({ ...u, total_scans: scanCounts[u.telegram_id] || 0 }))
      : []

    return res.status(200).json({
      stats: {
        totalUsers: Array.isArray(users) ? users.length : 0,
        newUsersThisWeek,
        scansThisMonth,
        proUsers,
        trialUsers,
      },
      users: usersWithScans,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
