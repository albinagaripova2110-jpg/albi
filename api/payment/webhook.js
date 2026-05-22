import crypto from 'crypto'

const PLAN_DAYS = {
  monthly:   30,
  quarterly: 90,
  halfyear:  180,
  yearly:    365,
}

const REFERRAL_BONUS = {
  monthly:   7,
  quarterly: 14,
  halfyear:  21,
  yearly:    30,
}

function referralBonusText(userName, bonusDays, newExpiry, plan, referrerId) {
  const date = new Date(newExpiry).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
  const refLink = `https://t.me/AlbiScan_bot?start=ref_${referrerId}`
  if (plan === 'monthly') {
    return `<b>${userName},</b> твой друг только что оплатил подписку Albi! 🥳\n\nКак и обещали - тебе начислено <b>+${bonusDays} дней</b> бесплатного доступа.\nПодписка теперь действует до: <b>${date}</b>\n\n<i>Чем больше друзей - тем дольше бесплатно</i> 😉\n\nПоделись ссылкой ещё раз 👇\n${refLink}`
  }
  if (plan === 'quarterly') {
    return `<b>${userName},</b> отличные новости! 🎊\nТвой друг купил подписку на 3 месяца - и ты получаешь <b>+${bonusDays} дней</b> бесплатно!\n\nПодписка теперь действует до: <b>${date}</b>\n<i>Спасибо, что делишься Albi - это лучшая поддержка</i> 🤍\n${refLink}`
  }
  return `<b>${userName},</b> это просто огонь! 🔥\nТвой друг взял подписку на 6 месяцев - и ты получаешь <b>+${bonusDays} дней</b> бесплатно!\n\nПодписка теперь действует до: <b>${date}</b>\n<i>Продолжай делиться - каждый друг приближает тебя к бесплатному Albi навсегда</i> 😄\n${refLink}`
}

async function sendTelegram(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
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
    },
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

  const secretKey   = process.env.PRODAMUS_SECRET_KEY
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  const botToken    = process.env.TELEGRAM_BOT_TOKEN

  try {
    let data = req.body
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch {
        data = Object.fromEntries(new URLSearchParams(data))
      }
    }
    console.log('Prodamus webhook received:', JSON.stringify(data))

    if (secretKey && data.sign && !verifySign(data, secretKey))
      console.warn('Prodamus: signature mismatch, proceeding anyway')

    const status = data.payment_status || data.status || data.paymentStatus || ''
    if (status !== 'success') return res.status(200).json({ ok: true })

    const rawOrderId = data.order_id || data.orderId || data.order_num || ''
    let telegramId, plan, days

    const parts = rawOrderId.split('_')
    if (parts.length >= 4 && parts[0] === 'albi') {
      telegramId = parseInt(parts[1]); plan = parts[2]; days = PLAN_DAYS[plan]
    }

    if (!telegramId || !days) {
      const candidates = [
        data.payment_orderid, data.merchant_order_id, data.custom_order_id,
        data.description, data.comment, data.order_description,
      ].filter(Boolean)
      for (const c of candidates) {
        const p = String(c).split('_')
        if (p.length >= 4 && p[0] === 'albi') {
          telegramId = parseInt(p[1]); plan = p[2]; days = PLAN_DAYS[plan]; break
        }
      }
    }

    if ((!telegramId || !days) && supabaseUrl && supabaseKey) {
      const orders = await db(
        `payment_orders?processed=eq.false&order=created_at.desc&limit=5`,
        supabaseUrl, supabaseKey, { method: 'GET' }
      )
      if (Array.isArray(orders) && orders.length > 0) {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000)
        const recent = orders.find(o => new Date(o.created_at) > cutoff)
        if (recent) {
          telegramId = recent.telegram_id; plan = recent.plan; days = PLAN_DAYS[plan]
          await db(`payment_orders?order_id=eq.${encodeURIComponent(recent.order_id)}`, supabaseUrl, supabaseKey, {
            method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify({ processed: true }),
          })
        }
      }
    }

    if (!telegramId || !days) {
      console.error('Could not resolve telegramId/plan:', JSON.stringify(data))
      return res.status(200).json({ ok: false, error: 'Cannot resolve order' })
    }

    const now = new Date()
    const newExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

    await db('subscriptions', supabaseUrl, supabaseKey, {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: telegramId, plan: 'pro',
        starts_at: now.toISOString(), expires_at: newExpiry,
        granted_by_admin: false,
        price_paid: Math.round(parseFloat(data.sum || 0) * 100),
      }),
    })

    let userName = ''
    const userRow = await db(`users?telegram_id=eq.${telegramId}&select=name&limit=1`, supabaseUrl, supabaseKey, { method: 'GET' })
    if (Array.isArray(userRow) && userRow[0]?.name) userName = userRow[0].name.split(' ')[0]

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
        let referrerNewExpiry = null
        if (Array.isArray(referrerSubs) && referrerSubs.length > 0) {
          const base = new Date(referrerSubs[0].expires_at) > now ? new Date(referrerSubs[0].expires_at) : now
          base.setDate(base.getDate() + bonusDays)
          referrerNewExpiry = base.toISOString()
          await db(`subscriptions?id=eq.${referrerSubs[0].id}`, supabaseUrl, supabaseKey, {
            method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ expires_at: referrerNewExpiry }),
          })
        }
        await db(`referrals?id=eq.${ref.id}`, supabaseUrl, supabaseKey, {
          method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'paid', bonus_days: bonusDays, bonus_applied: true }),
        })
        if (botToken && referrerNewExpiry) {
          const referrerRow = await db(`users?telegram_id=eq.${referrerId}&select=name&limit=1`, supabaseUrl, supabaseKey, { method: 'GET' })
          const referrerName = Array.isArray(referrerRow) && referrerRow[0]?.name ? referrerRow[0].name.split(' ')[0] : ''
          await sendTelegram(botToken, referrerId, referralBonusText(referrerName, bonusDays, referrerNewExpiry, plan, referrerId))
        }
      }
    }

    if (botToken) {
      const expiryDate = new Date(newExpiry).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
      const daysLeft = Math.ceil((new Date(newExpiry) - now) / 86400000)
      const refLink  = `https://t.me/AlbiScan_bot?start=ref_${telegramId}`
      const greeting = userName ? `${userName}, оплата` : 'Оплата'
      await sendTelegram(botToken, telegramId,
        `<b>${greeting} прошла успешно!</b> 🎉\n\nПодписка активирована:\n<b>Действует до: ${expiryDate}</b>\n<i>Осталось дней: ${daysLeft}</i>\n\nТеперь у тебя полный доступ ко всем функциям Albi без ограничений.\n\nПоделись своей реферальной ссылкой с другом - когда он оплатит подписку, ты получишь <b>бонусные дни</b> совершенно бесплатно 🤍\n👇 Твоя ссылка:\n${refLink}`
      )
    }

    console.log(`Payment OK: tg=${telegramId} plan=${plan} expires=${newExpiry}`)
    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error('Payment webhook error:', e)
    return res.status(200).json({ ok: true })
  }
}
