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

async function sendTelegramMessage(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
  return res.json()
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
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  // GET ?telegram_id=xxx — сообщения конкретного пользователя
  // GET — список диалогов (последнее сообщение по каждому пользователю)
  if (req.method === 'GET') {
    const { telegram_id } = req.query

    if (telegram_id) {
      // Отметить как прочитанные
      await supabase(
        `support_messages?telegram_id=eq.${telegram_id}&direction=eq.inbound&read_at=is.null`,
        supabaseUrl, supabaseKey,
        { method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify({ read_at: new Date().toISOString() }) }
      )
      // Вернуть сообщения
      const msgs = await supabase(
        `support_messages?telegram_id=eq.${telegram_id}&order=created_at.asc`,
        supabaseUrl, supabaseKey, { method: 'GET' }
      )
      return res.status(200).json(Array.isArray(msgs) ? msgs : [])
    }

    // Список диалогов — последнее сообщение от каждого пользователя
    const msgs = await supabase(
      'support_messages?order=created_at.desc&limit=200',
      supabaseUrl, supabaseKey, { method: 'GET' }
    )
    if (!Array.isArray(msgs)) return res.status(200).json([])

    const seen = new Set()
    const dialogs = []
    for (const m of msgs) {
      if (!seen.has(m.telegram_id)) {
        seen.add(m.telegram_id)
        // Count unread for this user
        const unread = msgs.filter(x => x.telegram_id === m.telegram_id && x.direction === 'inbound' && !x.read_at).length
        dialogs.push({ ...m, unread })
      }
    }
    return res.status(200).json(dialogs)
  }

  // POST — отправить сообщение пользователю
  if (req.method === 'POST') {
    const { telegram_id, message, user_name } = req.body
    if (!telegram_id || !message) return res.status(400).json({ error: 'telegram_id and message required' })

    // Отправить через Telegram Bot API
    if (botToken) {
      await sendTelegramMessage(botToken, telegram_id, message)
    }

    // Сохранить в базу
    await supabase(
      'support_messages',
      supabaseUrl, supabaseKey,
      {
        method: 'POST',
        body: JSON.stringify({
          telegram_id,
          user_name: user_name || 'Albi Support',
          direction: 'outbound',
          message,
        })
      }
    )
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
