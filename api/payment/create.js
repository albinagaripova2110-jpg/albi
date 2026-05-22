import crypto from 'crypto'

const PLANS = {
  monthly:   { name: 'Albi 1 месяц',    price: 249,  days: 30  },
  quarterly: { name: 'Albi 3 месяца',   price: 599,  days: 90  },
  halfyear:  { name: 'Albi 6 месяцев',  price: 1290, days: 180 },
  yearly:    { name: 'Albi 1 год',      price: 1990, days: 365 }, // legacy
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { telegram_id, plan } = req.body
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  let hasDiscount = false

  // Проверяем реферальную скидку (работает и для plan=check)
  if (supabaseUrl && supabaseKey && telegram_id) {
    try {
      const refs = await fetch(
        `${supabaseUrl}/rest/v1/referrals?referee_id=eq.${telegram_id}&select=id&limit=1`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      ).then(r => r.json())
      if (Array.isArray(refs) && refs.length > 0) hasDiscount = true
    } catch {}
  }

  // Если plan=check — только проверяем скидку, не создаём платёж
  if (!plan || plan === 'check' || !PLANS[plan]) {
    if (plan && plan !== 'check') return res.status(400).json({ error: 'Invalid plan' })
    return res.status(200).json({ has_discount: hasDiscount })
  }

  const domain = (process.env.PRODAMUS_DOMAIN || 'albinagaripova.payform.ru')
    .replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const secretKey = process.env.PRODAMUS_SECRET_KEY

  let price = PLANS[plan].price
  if (hasDiscount) price = Math.round(price * 0.9)

  const orderId = `albi_${telegram_id}_${plan}_${Date.now()}`

  // Сохраняем маппинг orderId → telegram_id + plan (на случай если Продамус не вернёт наш order_id)
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
        body: JSON.stringify({ order_id: orderId, telegram_id: parseInt(telegram_id), plan, price, created_at: new Date().toISOString() })
      })
    } catch {}
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

  // Подпись Продамус: HMAC-SHA256 от значений, сортированных по ключу, через |
  if (secretKey) {
    const sortedValues = Object.keys(params).sort().map(k => params[k]).join('|')
    params.sign = crypto.createHmac('sha256', secretKey).update(sortedValues).digest('hex')
  }

  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const url = `https://${domain}/?${query}`

  return res.status(200).json({
    url,
    price,
    original_price: PLANS[plan].price,
    has_discount: hasDiscount,
    order_id: orderId,
  })
}
