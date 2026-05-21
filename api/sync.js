async function supabaseRequest(url, options, supabaseKey) {
  const res = await fetch(url, {
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  // GET — загрузить данные
  if (req.method === 'GET') {
    const { telegram_id } = req.query
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

    const data = await supabaseRequest(
      `${supabaseUrl}/rest/v1/user_data?telegram_id=eq.${telegram_id}&select=*`,
      { method: 'GET' },
      supabaseKey
    )

    if (Array.isArray(data) && data.length > 0) {
      return res.status(200).json(data[0])
    }
    return res.status(200).json(null)
  }

  // POST — сохранить данные
  if (req.method === 'POST') {
    const { telegram_id, tg_name, tg_username, profile, history, weights, reminders } = req.body
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

    // Убедимся что пользователь существует в таблице users (с именем и username)
    await supabaseRequest(
      `${supabaseUrl}/rest/v1/users`,
      {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          telegram_id,
          name: tg_name || profile?.name || null,
          username: tg_username || null,
          last_seen_at: new Date().toISOString(),
        })
      },
      supabaseKey
    )

    // Убираем картинки из истории перед сохранением (экономим место)
    const historyNoImages = history ? Object.fromEntries(
      Object.entries(history).map(([date, day]) => [
        date,
        {
          ...day,
          meals: (day.meals || []).map(m => ({ ...m, img: null }))
        }
      ])
    ) : null

    const result = await supabaseRequest(
      `${supabaseUrl}/rest/v1/user_data`,
      {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          telegram_id,
          profile: profile || null,
          history: historyNoImages || null,
          weights: weights || null,
          reminders: reminders || null,
          updated_at: new Date().toISOString(),
        })
      },
      supabaseKey
    )

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } }
}
