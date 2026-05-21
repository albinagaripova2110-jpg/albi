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
  const text = await res.text()
  try { return JSON.parse(text) } catch { return null }
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

  // GET — загрузить данные + статус доступа
  if (req.method === 'GET') {
    const { telegram_id } = req.query
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

    const [data, userInfo] = await Promise.all([
      supabaseRequest(
        `${supabaseUrl}/rest/v1/user_data?telegram_id=eq.${telegram_id}&select=*`,
        { method: 'GET' },
        supabaseKey
      ),
      supabaseRequest(
        `${supabaseUrl}/rest/v1/users?telegram_id=eq.${telegram_id}&select=trial_ends_at&limit=1`,
        { method: 'GET' },
        supabaseKey
      )
    ])

    const now = new Date()
    const trialEndsAt = Array.isArray(userInfo) && userInfo[0]?.trial_ends_at
    const trialActive = trialEndsAt && new Date(trialEndsAt) > now

    // Проверяем активную подписку
    const subs = await supabaseRequest(
      `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${telegram_id}&plan=eq.pro&expires_at=gte.${now.toISOString()}&select=expires_at&limit=1`,
      { method: 'GET' },
      supabaseKey
    )
    const hasSubscription = Array.isArray(subs) && subs.length > 0

    const subEndsAt = hasSubscription ? subs[0].expires_at : null

    const access = {
      allowed: trialActive || hasSubscription,
      plan: hasSubscription ? 'pro' : trialActive ? 'trial' : 'expired',
      trialEndsAt: trialEndsAt || null,
      subEndsAt: subEndsAt || null,
    }

    if (Array.isArray(data) && data.length > 0) {
      return res.status(200).json({ ...data[0], access })
    }
    return res.status(200).json({ access })
  }

  // POST — сохранить данные
  if (req.method === 'POST') {
    const { telegram_id, tg_name, tg_username, profile, history, weights, reminders } = req.body
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

    // Проверяем — новый пользователь или нет
    const existing = await supabaseRequest(
      `${supabaseUrl}/rest/v1/users?telegram_id=eq.${telegram_id}&select=telegram_id,trial_ends_at&limit=1`,
      { method: 'GET' },
      supabaseKey
    )
    const isNew = !Array.isArray(existing) || existing.length === 0

    const userPayload = {
      telegram_id,
      name: tg_name || profile?.name || null,
      username: tg_username || null,
      last_seen_at: new Date().toISOString(),
    }
    // Новому пользователю — 3 дня триала
    if (isNew) {
      userPayload.trial_ends_at = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    }

    await supabaseRequest(
      `${supabaseUrl}/rest/v1/users`,
      {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(userPayload)
      },
      supabaseKey
    )

    // Убираем картинки из истории перед сохранением
    const historyNoImages = history ? Object.fromEntries(
      Object.entries(history).map(([date, day]) => [
        date,
        {
          ...day,
          meals: (day.meals || []).map(m => ({ ...m, img: null }))
        }
      ])
    ) : null

    await supabaseRequest(
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
