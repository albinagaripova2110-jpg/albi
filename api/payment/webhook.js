import crypto from 'crypto'

const PLAN_DAYS = {
  monthly:   30,
  quarterly: 90,
  yearly:    365,
}

// Бонусные дни рефереру
const REFERRAL_BONUS = {
  monthly:   7,
  quarterly: 14,
  yearly:    30,
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

export default async function handler(req, res) {
  // Продамус всегда должен получать 200
  if (req.method !== 'POST') return res.status(200).end()

  const secretKey = process.env.PRODAMUS_SECRET_KEY
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  try {
    const data = req.body

    // Верификация подписи Продамус
    if (secretKey && data.sign) {
      const { sign, ...params } = data
      const sortedValues = Object.keys(params).sort().map(k => String(params[k])).join('|')
      const expected = crypto.createHmac('sha256', secretKey).update(sortedValues).digest('hex')
      if (sign !== expected) {
        console.error('Prodamus: invalid signature')
        return res.status(200).json({ ok: false, error: 'Invalid signature' })
      }
    }

    // Только успешные платежи
    if (data.payment_status !== 'success') {
      return res.status(200).json({ ok: true })
    }

    // order_id формат: albi_{telegram_id}_{plan}_{timestamp}
    const parts = (data.order_id || '').split('_')
    if (parts.length < 4 || parts[0] !== 'albi') {
      console.error('Prodamus webhook: invalid order_id', data.order_id)
      return res.status(200).json({ ok: false, error: 'Invalid order_id' })
    }

    const telegramId = parseInt(parts[1])
    const plan = parts[2]
    const days = PLAN_DAYS[plan]

    if (!telegramId || !days) {
      return res.status(200).json({ ok: false, error: 'Unknown plan' })
    }

    const now = new Date()
    const newExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
    const pricePaid = Math.round(parseFloat(data.sum || 0) * 100)

    // Активируем / продлеваем подписку
    await db('subscriptions', supabaseUrl, supabaseKey, {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: telegramId,
        plan: 'pro',
        starts_at: now.toISOString(),
        expires_at: newExpiry,
        granted_by_admin: false,
        price_paid: pricePaid,
      })
    })

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

        // Ищем подписку реферера
        const referrerSubs = await db(
          `subscriptions?user_id=eq.${referrerId}&plan=eq.pro&order=expires_at.desc&limit=1`,
          supabaseUrl, supabaseKey, { method: 'GET' }
        )

        if (Array.isArray(referrerSubs) && referrerSubs.length > 0) {
          const refSub = referrerSubs[0]
          const base = new Date(refSub.expires_at) > now ? new Date(refSub.expires_at) : now
          base.setDate(base.getDate() + bonusDays)
          await db(`subscriptions?id=eq.${refSub.id}`, supabaseUrl, supabaseKey, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ expires_at: base.toISOString() })
          })
        }

        // Помечаем реферал как оплаченный
        await db(`referrals?id=eq.${ref.id}`, supabaseUrl, supabaseKey, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'paid', bonus_days: bonusDays, bonus_applied: true })
        })
      }
    }

    console.log(`Payment OK: tg=${telegramId} plan=${plan} expires=${newExpiry}`)
    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error('Payment webhook error:', e)
    return res.status(200).json({ ok: true }) // Продамус должен получить 200
  }
}
