import crypto from 'crypto'

const PLANS = {
  monthly:   { name: 'Подписка Albi · 1 месяц',  price: 249,  days: 30  },
  quarterly: { name: 'Подписка Albi · 3 месяца', price: 599,  days: 90  },
  yearly:    { name: 'Подписка Albi · 1 год',     price: 1990, days: 365 },
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { telegram_id, plan } = req.body
  if (!telegram_id || !plan || !PLANS[plan]) {
    return res.status(400).json({ error: 'telegram_id and valid plan required' })
  }

  const domain = (process.env.PRODAMUS_DOMAIN || 'albinagaripova.payform.ru')
    .replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const secretKey = process.env.PRODAMUS_SECRET_KEY
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  let price = PLANS[plan].price
  let hasDiscount = false

  // Реферальная скидка 10%
  if (supabaseUrl && supabaseKey && telegram_id) {
    try {
      const refs = await fetch(
        `${supabaseUrl}/rest/v1/referrals?referee_id=eq.${telegram_id}&select=id&limit=1`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      ).then(r => r.json())
      if (Array.isArray(refs) && refs.length > 0) {
        price = Math.round(price * 0.9)
        hasDiscount = true
      }
    } catch {}
  }

  const orderId = `albi_${telegram_id}_${plan}_${Date.now()}`

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
