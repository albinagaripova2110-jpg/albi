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

async function sendTelegram(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end()

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  try {
    const update = req.body
    const message = update.message
    if (!message) return res.status(200).json({ ok: true })

    const chatId = message.chat.id
    const text = message.text || ''
    const from = message.from
    const userName = from?.first_name || from?.username || 'Пользователь'

    // Команда /start — приветствие
    if (text.startsWith('/start')) {
      await sendTelegram(botToken, chatId,
        `Привет, ${userName}! 👋\n\nЗдесь ты можешь написать нам — мы ответим в течение нескольких часов.\n\nЧтобы открыть приложение Albi, нажми на кнопку в меню бота.`
      )
      return res.status(200).json({ ok: true })
    }

    // Сохраняем сообщение в базу
    await supabase(
      'support_messages',
      supabaseUrl, supabaseKey,
      {
        method: 'POST',
        body: JSON.stringify({
          telegram_id: chatId,
          user_name: userName,
          direction: 'inbound',
          message: text || `[${message.photo ? 'фото' : message.sticker ? 'стикер' : 'медиа'}]`,
        })
      }
    )

    // Авто-ответ
    await sendTelegram(botToken, chatId,
      `Получила! ✉️ Отвечу как можно скорее.`
    )

  } catch (e) {
    console.error('Webhook error:', e)
  }

  return res.status(200).json({ ok: true })
}
