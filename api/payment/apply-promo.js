export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const code = (req.query.code || '').toUpperCase().trim()
  if (!code) return res.status(400).json({ valid: false, error: 'Code required' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ valid: false, error: 'Server error' })
  }

  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}&select=*&limit=1`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        }
      }
    )
    const text = await resp.text()
    let rows
    try { rows = JSON.parse(text) } catch { rows = null }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json({ valid: false, error: 'Промокод не найден' })
    }

    const promo = rows[0]

    if (!promo.is_active) {
      return res.status(200).json({ valid: false, error: 'Промокод недействителен' })
    }
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return res.status(200).json({ valid: false, error: 'Срок действия промокода истёк' })
    }
    if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
      return res.status(200).json({ valid: false, error: 'Промокод уже использован' })
    }

    // Build a human-readable label
    const parts = []
    if (promo.discount_pct) parts.push(`Скидка ${promo.discount_pct}%`)
    if (promo.bonus_days) parts.push(`+${promo.bonus_days} дней`)
    const label = parts.join(' · ') || 'Промокод применён'

    return res.status(200).json({
      valid: true,
      label,
      discount_pct: promo.discount_pct || 0,
      bonus_days: promo.bonus_days || 0,
    })
  } catch (e) {
    console.error('apply-promo error:', e)
    return res.status(500).json({ valid: false, error: 'Server error' })
  }
}
