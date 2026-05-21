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

async function sendTelegram(botToken, chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...extra })
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

    // Команда /start
    if (text.startsWith('/start')) {
      const param = text.split(' ')[1] || '' // ref_545620320

      // Реферальная ссылка
      if (param.startsWith('ref_') && supabaseUrl && supabaseKey) {
        const referrerId = parseInt(param.replace('ref_', ''))

        if (referrerId && referrerId !== chatId) {
          // Убедимся что referee есть в users
          await supabase('users', supabaseUrl, supabaseKey, {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({
              telegram_id: chatId,
              name: userName,
              trial_ends_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
            })
          })

          // Сохраняем реферал (если ещё не зарегистрирован по чьей-то ссылке)
          await supabase('referrals', supabaseUrl, supabaseKey, {
            method: 'POST',
            headers: { 'Prefer': 'resolution=ignore-duplicates' },
            body: JSON.stringify({
              referrer_id: referrerId,
              referee_id: chatId,
              status: 'registered',
            })
          })

          // Отмечаем в users кто пригласил
          await supabase(
            `users?telegram_id=eq.${chatId}`,
            supabaseUrl, supabaseKey,
            {
              method: 'PATCH',
              headers: { 'Prefer': 'return=minimal' },
              body: JSON.stringify({ referred_by: referrerId })
            }
          )

          await sendTelegram(botToken, chatId,
            `Привет, ${userName}! 👋\n\nТы пришёл по реферальной ссылке — при оформлении подписки получишь скидку 10% 🎁\n\nЧтобы открыть приложение Albi, нажми на кнопку в меню бота.`
          )
          return res.status(200).json({ ok: true })
        }
      }

      // Обычный /start
      await sendTelegram(botToken, chatId,
        `Привет, ${userName}! 👋\n\nЗдесь ты можешь написать нам — мы ответим в течение нескольких часов.\n\nЧтобы открыть приложение Albi, нажми на кнопку в меню бота.`
      )
      return res.status(200).json({ ok: true })
    }

    // Входящее сообщение — сохраняем в support
    if (supabaseUrl && supabaseKey) {
      await supabase('support_messages', supabaseUrl, supabaseKey, {
        method: 'POST',
        body: JSON.stringify({
          telegram_id: chatId,
          user_name: userName,
          direction: 'inbound',
          message: text || `[${message.photo ? 'фото' : message.sticker ? 'стикер' : 'медиа'}]`,
        })
      })
    }

    // Авто-ответ
    await sendTelegram(botToken, chatId, `Получила! ✉️ Отвечу как можно скорее.`)

  } catch (e) {
    console.error('Webhook error:', e)
  }

  return res.status(200).json({ ok: true })
}
