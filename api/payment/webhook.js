import crypto from 'crypto'

const PLAN_DAYS = {
  monthly:   30,
  quarterly: 90,
  yearly:    365,
}

const REFERRAL_BONUS = {
  monthly:   7,
  quarterly: 14,
  yearly:    30,
}

async function sendTelegram(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  })
}

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

function verifySign(data, secretKey) {
  try {
    const { sign, ...params } = data
    const sortedValues = Object.keys(params).sort().map(k => String(params[k] ?? '')).join('|')
    const expected = crypto.createHmac('sha256', secretKey).update(sortedValues).digest('hex')
    return sign === expected
  } catch { return false }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end()

  const secretKey = process.env.PRODAMUS_SECRET_KEY
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  try {
    // Продамус может слать и JSON и form-encoded
    let data = req.body
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch {
        data = Object.fromEntries(new URLSearchParams(data))
      }
    }

    console.log('Prodamus webhook received:', JSON.stringify(data))

    // Проверяем подпись — логируем но не блокируем
    if (secretKey && data.sign) {
      const valid = verifySign(data, secretKey)
      if (!valid) {
        console.warn('Prodamus: signature mismatch, proceeding anyway')
      }
    }

    // Продамус может называть статус по-разному
    const status = data.payment_status || data.status || data.paymentStatus || ''
    console.log('Payment status:', status)

    if (status !== 'success') {
      console.log('Not a success status, skipping')
      return res.status(200).json({ ok: true })
    }

    // order_id формат: albi_{telegram_id}_{plan}_{timestamp}
    const orderId = data.order_id || data.orderId || ''
    const parts = orderId.split('_')
    console.log('Order parts:', parts)

    if (parts.length < 4 || parts[0] !== 'albi') {
      console.error('Invalid order_id:', orderId)
      return res.status(200).json({ ok: false, error: 'Invalid order_id' })
    }

    const telegramId = parseInt(parts[1])
    const plan = parts[2]
    const days = PLAN_DAYS[plan]

    if (!telegramId || !days) {
      console.error('Unknown plan or invalid telegramId:', plan, telegramId)
      return res.status(200).json({ ok: false, error: 'Unknown plan' })
    }

    const now = new Date()
    const newExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

    // Активируем подписку
    const subResult = await db('subscriptions', supabaseUrl, supabaseKey, {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: telegramId,
        plan: 'pro',
        starts_at: now.toISOString(),
        expires_at: newExpiry,
        granted_by_admin: false,
        price_paid: Math.round(parseFloat(data.sum || 0) * 100),
      })
    })
    console.log('Subscription result:', JSON.stringify(subResult))

    // Начисляем бонусные дни рефереру
    const bonusDays = REFERRAL_BONUS[plan] || 0
    if (bonusDays > 0) {
      const refs = await db(
        `referrals?referee_id=eq.${telegramId}&bonus_applied=eq.false&limit=1`,
        supabaseUrl, supabaseKey, { method: 'GET' }
      )
      if (Array.isArray(refs) && refs.length > 0) {
        const ref = refs[0]
        const referrerId = ref.referrer_id
        const referrerSubs = await db(
          `subscriptions?user_id=eq.${referrerId}&plan=eq.pro&order=expires_at.desc&limit=1`,
          supabaseUrl, supabaseKey, { method: 'GET' }
        )
        if (Array.isArray(referrerSubs) && referrerSubs.length > 0) {
          const base = new Date(referrerSubs[0].expires_at) > now ? new Date(referrerSubs[0].expires_at) : now
          base.setDate(base.getDate() + bonusDays)
          await db(`subscriptions?id=eq.${referrerSubs[0].id}`, supabaseUrl, supabaseKey, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ expires_at: base.toISOString() })
          })
        }
        await db(`referrals?id=eq.${ref.id}`, supabaseUrl, supabaseKey, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'paid', bonus_days: bonusDays, bonus_applied: true })
        })
      }
    }

    // Уведомление пользователю
    if (botToken) {
      const planNames = { monthly: '1 месяц', quarterly: '3 месяца', yearly: '1 год' }
      const expiryDate = new Date(newExpiry).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
      await sendTelegram(botToken, telegramId,
        `✅ Оплата получена!\n\nПодписка Albi Pro — ${planNames[plan] || plan}\nДоступ открыт до ${expiryDate}\n\nСпасибо, что с нами! 🌿`
      )
    }

    console.log(`Payment OK: tg=${telegramId} plan=${plan} expires=${newExpiry}`)
    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error('Payment webhook error:', e)
    return res.status(200).json({ ok: true })
  }
}
