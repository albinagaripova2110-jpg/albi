import crypto from 'crypto'

const PLANS = {
  monthly:   { name: 'Albi 1 месяц',   price: 249,  days: 30  },
  quarterly: { name: 'Albi 3 месяца',  price: 599,  days: 90  },
  halfyear:  { name: 'Albi 6 месяцев', price: 1099, days: 180 },
  yearly:    { name: 'Albi 1 год',     price: 1990, days: 365 }, // legacy
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  // ── GET ?code=XXX — валидация промокода ──────────────────────────
  if (req.method === 'GET') {
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ valid: false, error: 'Code required' })
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ valid: false, error: 'Server error' })

    try {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}&select=*&limit=1`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      )
      const text = await resp.text()
      let rows
      try { rows = JSON.parse(text) } catch { rows = null }

      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(200).json({ valid: false, error: 'Промокод не найден' })

      const promo = rows[0]
      if (!promo.is_active)
        return res.status(200).json({ valid: false, error: 'Промокод недействителен' })
      if (promo.expires_at && new Date(promo.expires_at) < new Date())
        return res.status(200).json({ valid: false, error: 'Срок действия промокода истёк' })
      if (promo.max_uses !== null && promo.uses_count >= promo.max_uses)
        return res.status(200).json({ valid: false, error: 'Промокод уже использован' })

      const parts = []
      if (promo.discount_pct) parts.push(`Скидка ${promo.discount_pct}%`)
      if (promo.bonus_days)   parts.push(`+${promo.bonus_days} дней`)

      return res.status(200).json({
        valid: true,
        label: parts.join(' · ') || 'Промокод применён',
        discount_pct: promo.discount_pct || 0,
        bonus_days:   promo.bonus_days   || 0,
      })
    } catch (e) {
      console.error('promo validation error:', e)
      return res.status(500).json({ valid: false, error: 'Server error' })
    }
  }

  // ── POST — создание платежа ───────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { telegram_id, plan, promo_code } = req.body
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

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

  // plan=check — только проверка скидки
  if (!plan || plan === 'check' || !PLANS[plan]) {
    if (plan && plan !== 'check') return res.status(400).json({ error: 'Invalid plan' })
    return res.status(200).json({ has_discount: hasDiscount })
  }

  const domain = (process.env.PRODAMUS_DOMAIN || 'albinagaripova.payform.ru')
    .replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const secretKey = process.env.PRODAMUS_SECRET_KEY

  let price = PLANS[plan].price
  if (hasDiscount) price = Math.round(price * 0.9)

  // Применяем промокод
  let promoRow = null
  if (promo_code && supabaseUrl && supabaseKey) {
    try {
      const code = promo_code.toUpperCase().trim()
      const rows = await fetch(
        `${supabaseUrl}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=*&limit=1`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      ).then(r => r.json())
      if (Array.isArray(rows) && rows.length > 0) {
        const p = rows[0]
        const expired = p.expires_at && new Date(p.expires_at) < new Date()
        const maxed   = p.max_uses !== null && p.uses_count >= p.max_uses
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
