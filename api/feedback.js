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

async function sendTelegram(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {})
}

function starsLine(rating) {
  return '⭐'.repeat(rating) + '☆'.repeat(5 - rating)
}

function buildNotification(telegram_id, rating, liked, issues, comment) {
  const stars = starsLine(rating)
  let msg = `<b>Новый отзыв ${stars}</b>\n`

  if (telegram_id) msg += `👤 tg_id: <code>${telegram_id}</code>\n`

  if (liked && liked.length > 0) {
    msg += `\n✅ <b>Понравилось:</b> ${liked.join(', ')}`
  }
  if (issues && issues.length > 0) {
    msg += `\n⚠️ <b>Мешает:</b> ${issues.join(', ')}`
  }
  if (comment) {
    msg += `\n\n💬 <i>${comment}</i>`
  }

  return msg
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  const botToken    = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.ADMIN_CHAT_ID

  const { telegram_id, rating, liked, issues, comment, created_at } = req.body || {}

  if (!rating) return res.status(400).json({ error: 'rating required' })

  // Сохраняем в Supabase
  if (supabaseUrl && supabaseKey) {
    await supabaseRequest(
      `${supabaseUrl}/rest/v1/feedback`,
      {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          telegram_id: telegram_id || null,
          rating,
          liked:   Array.isArray(liked)  ? liked  : [],
          issues:  Array.isArray(issues) ? issues : [],
          comment: comment || null,
          created_at: created_at || new Date().toISOString(),
        }),
      },
      supabaseKey
    )
  }

  // Шлём уведомление тебе в Telegram
  if (botToken && adminChatId) {
    const text = buildNotification(telegram_id, rating, liked, issues, comment)
    await sendTelegram(botToken, adminChatId, text)
  }

  return res.status(200).json({ ok: true })
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
}
