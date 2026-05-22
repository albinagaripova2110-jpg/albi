import crypto from 'crypto'

// ─── Shared constants ────────────────────────────────────────────────────────
const PLANS = {
  monthly:   { name: 'Albi 1 месяц',   price: 249,  days: 30  },
  quarterly: { name: 'Albi 3 месяца',  price: 599,  days: 90  },
  halfyear:  { name: 'Albi 6 месяцев', price: 1290, days: 180 },
  yearly:    { name: 'Albi 1 год',     price: 1990, days: 365 }, // legacy
}
const PLAN_DAYS     = { monthly: 30, quarterly: 90, halfyear: 180, yearly: 365 }
const REFERRAL_BONUS = { monthly: 7, quarterly: 14, halfyear: 21, yearly: 30 }

// ─── Shared helpers ──────────────────────────────────────────────────────────
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

async function sendTelegram(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
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

function verifySign(data, secretKey) {
  try {
    const { sign, ...params } = data
    const sortedValues = Object.keys(params).sort().map(k => String(params[k] ?? '')).join('|')
    const expected = crypto.createHmac('sha256', secretKey).update(sortedValues).digest('hex')
    return sign === expected
  } catch { return false }
}

// ─── /api/payment/create ────────────────────────────────────────────────────
async function handleCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { telegram_id, plan, promo_code } = req.body
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  let hasDiscount = false
  if (supabaseUrl && supabaseKey) {
    try {
      const refs = await fetch(
        `${supabaseUrl}/rest/v1/referrals?referee_id=eq.${telegram_id}&select=id&limit=1`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      ).then(r => r.json())
      if (Array.isArray(refs) && refs.length > 0) hasDiscount = true
    } catch {}
  }

  if (!plan || plan === 'check' || !PLANS[plan]) {
    if (plan && plan !== 'check') return res.status(400).json({ error: 'Invalid plan' })
    return res.status(200).json({ has_discount: hasDiscount })
  }

  const domain = (process.env.PRODAMUS_DOMAIN || 'albinagaripova.payform.ru')
    .replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const secretKey = process.env.PRODAMUS_SECRET_KEY

  let price = PLANS[plan].price
  if (hasDiscount) price = Math.round(price * 0.9)

  let promoRow = null
  if (promo_code && supabaseUrl && supabaseKey) {
    try {
      const code = promo_code.toUpperCase().trim()
      const promoText = await fetch(
        `${supabaseUrl}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=*&limit=1`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      ).then(r => r.text())
      const promoRows = JSON.parse(promoText)
      if (Array.isArray(promoRows) && promoRows.length > 0) {
        const p = promoRows[0]
        const expired = p.expires_at && new Date(p.expires_at) < new Date()
        const maxed = p.max_uses !== null && p.uses_count >= p.max_uses
        if (!expired && !maxed) {
          promoRow = p
          if (p.discount_pct) price = Math.round(price * (1 - p.discount_pct / 100))
        }
      }
    } catch {}
  }

  const orderId = `albi_${telegram_id}_${plan}_${Date.now()}`

  if (supabaseUrl && supabaseKey) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/payment_orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'resolution=ignore-duplicates',
        },
        body: JSON.stringify({ order_id: orderId, telegram_id: parseInt(telegram_id), plan, price, created_at: new Date().toISOString() }),
      })
    } catch {}

    if (promoRow) {
      try {
        await fetch(`${supabaseUrl}/rest/v1/promo_codes?id=eq.${promoRow.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ uses_count: (promoRow.uses_count || 0) + 1 }),
        })
      } catch {}
    }
  }

  const params = {
    do: 'pay',
    order_id: orderId,
    sum: price.toString(),
    currency: 'rub',
    'products[0][name]': PLANS[plan].name,
    'products[0][price]': price.toString(),
    'products[0][quantity]': '1',
    link_success: 'https://albi-scan.vercel.app/',
  }

  if (secretKey) {
    const sortedValues = Object.keys(params).sort().map(k => params[k]).join('|')
    params.sign = crypto.createHmac('sha256', secretKey).update(sortedValues).digest('hex')
  }

  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  return res.status(200).json({
    url: `https://${domain}/?${query}`,
    price,
    original_price: PLANS[plan].price,
    has_discount: hasDiscount,
    order_id: orderId,
  })
}

// ─── /api/payment/webhook ───────────────────────────────────────────────────
async function handleWebhook(req, res) {
  if (req.method !== 'POST') return res.status(200).end()

  const secretKey  = process.env.PRODAMUS_SECRET_KEY
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  const botToken   = process.env.TELEGRAM_BOT_TOKEN

  try {
    let data = req.body
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch {
        data = Object.fromEntries(new URLSearchParams(data))
      }
    }
    console.log('Prodamus webhook received:', JSON.stringify(data))

    if (secretKey && data.sign) {
      if (!verifySign(data, secretKey)) console.warn('Prodamus: signature mismatch, proceeding anyway')
    }

    const status = data.payment_status || data.status || data.paymentStatus || ''
    if (status !== 'success') return res.status(200).json({ ok: true })

    const rawOrderId = data.order_id || data.orderId || data.order_num || ''
    let telegramId, plan, days

    const parts = rawOrderId.split('_')
    if (parts.length >= 4 && parts[0] === 'albi') {
      telegramId = parseInt(parts[1]); plan = parts[2]; days = PLAN_DAYS[plan]
    }

    if (!telegramId || !days) {
      const candidates = [data.payment_orderid, data.merchant_order_id, data.custom_order_id, data.description, data.comment, data.order_description].filter(Boolean)
      for (const c of candidates) {
        const p = String(c).split('_')
        if (p.length >= 4 && p[0] === 'albi') {
          telegramId = parseInt(p[1]); plan = p[2]; days = PLAN_DAYS[plan]; break
        }
      }
    }

    if ((!telegramId || !days) && supabaseUrl && supabaseKey) {
      const orders = await db(`payment_orders?processed=eq.false&order=created_at.desc&limit=5`, supabaseUrl, supabaseKey, { method: 'GET' })
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
      const refs = await db(`referrals?referee_id=eq.${telegramId}&bonus_applied=eq.false&limit=1`, supabaseUrl, supabaseKey, { method: 'GET' })
      if (Array.isArray(refs) && refs.length > 0) {
        const ref = refs[0]
        const referrerId = ref.referrer_id
        const referrerSubs = await db(`subscriptions?user_id=eq.${referrerId}&plan=eq.pro&order=expires_at.desc&limit=1`, supabaseUrl, supabaseKey, { method: 'GET' })
        let referrerNewExpiry = null
        if (Array.isArray(referrerSubs) && referrerSubs.length > 0) {
          const base = new Date(referrerSubs[0].expires_at) > now ? new Date(referrerSubs[0].expires_at) : now
          base.setDate(base.getDate() + bonusDays)
          referrerNewExpiry = base.toISOString()
          await db(`subscriptions?id=eq.${referrerSubs[0].id}`, supabaseUrl, supabaseKey, {
            method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify({ expires_at: referrerNewExpiry }),
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
      const refLink = `https://t.me/AlbiScan_bot?start=ref_${telegramId}`
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

// ─── /api/payment/apply-promo ───────────────────────────────────────────────
async function handleApplyPromo(req, res) {
  const code = (req.query.code || '').toUpperCase().trim()
  if (!code) return res.status(400).json({ valid: false, error: 'Code required' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ valid: false, error: 'Server error' })

  try {
    const rows = await db(
      `promo_codes?code=eq.${encodeURIComponent(code)}&select=*&limit=1`,
      supabaseUrl, supabaseKey, { method: 'GET' }
    )
    if (!Array.isArray(rows) || rows.length === 0) return res.status(200).json({ valid: false, error: 'Промокод не найден' })

    const promo = rows[0]
    if (!promo.is_active) return res.status(200).json({ valid: false, error: 'Промокод недействителен' })
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) return res.status(200).json({ valid: false, error: 'Срок действия промокода истёк' })
    if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) return res.status(200).json({ valid: false, error: 'Промокод уже использован' })

    const parts = []
    if (promo.discount_pct) parts.push(`Скидка ${promo.discount_pct}%`)
    if (promo.bonus_days)   parts.push(`+${promo.bonus_days} дней`)

    return res.status(200).json({
      valid: true,
      label: parts.join(' · ') || 'Промокод применён',
      discount_pct: promo.discount_pct || 0,
      bonus_days: promo.bonus_days || 0,
    })
  } catch (e) {
    console.error('apply-promo error:', e)
    return res.status(500).json({ valid: false, error: 'Server error' })
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query.action
  if (action === 'create')      return handleCreate(req, res)
  if (action === 'webhook')     return handleWebhook(req, res)
  if (action === 'apply-promo') return handleApplyPromo(req, res)
  return res.status(404).json({ error: 'Not found' })
}
