// Крон-джоб: уведомление за 1 день до конца подписки
// Запускается раз в сутки (например, в 10:00 UTC)
// Vercel cron: добавить в vercel.json -> "crons"

async function db(url, supabaseUrl, supabaseKey, options = {}) {
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

async function sendTelegram(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
}

export default async function handler(req, res) {
  // Защита: только GET с секретом или Vercel cron header
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers['authorization']
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!supabaseUrl || !supabaseKey || !botToken) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const now = new Date()
  // Ищем подписки, истекающие в окне от 23 до 25 часов с этого момента
  const from = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString()
  const to   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString()

  const subs = await db(
    `subscriptions?plan=eq.pro&expires_at=gte.${from}&expires_at=lte.${to}&select=user_id,expires_at`,
    supabaseUrl, supabaseKey, { method: 'GET' }
  )

  if (!Array.isArray(subs) || subs.length === 0) {
    return res.status(200).json({ ok: true, sent: 0 })
  }

  // Получаем имена пользователей
  const ids = subs.map(s => s.user_id).join(',')
  const users = await db(
    `users?telegram_id=in.(${ids})&select=telegram_id,name`,
    supabaseUrl, supabaseKey, { method: 'GET' }
  )
  const nameMap = {}
  if (Array.isArray(users)) {
    users.forEach(u => { nameMap[u.telegram_id] = u.name ? u.name.split(' ')[0] : '' })
  }

  let sent = 0
  for (const sub of subs) {
    const name = nameMap[sub.user_id] || ''
    const expiryDate = new Date(sub.expires_at).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
    const greeting = name ? `<b>${name},</b> завтра` : 'Завтра'
    const text = `${greeting} заканчивается твоя подписка Albi ⏳\n\nСрок действия: <b>${expiryDate}</b>\n\nНе хочется терять свои данные, историю и прогресс? Продли подписку - и ничего не прервётся.\n\n👇 <b>Выбери удобный тариф:</b>\n\n<b>1 месяц</b> - 249 ₽\n<b>3 месяца</b> - 599 ₽ <i>(экономия 20%)</i>\n<b>6 месяцев</b> - 1 099 ₽\n\n<i>P.S. Если есть промокод - введи его при оплате 🎁</i>`
    try {
      await sendTelegram(botToken, sub.user_id, text)
      sent++
    } catch (e) {
      console.error(`Failed to notify ${sub.user_id}:`, e.message)
    }
  }

  console.log(`Expiry notifications sent: ${sent}`)
  return res.status(200).json({ ok: true, sent })
}
