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

async function trackUser(supabaseUrl, supabaseKey, telegramId, name, username) {
  if (!telegramId) return
  await supabaseRequest(
    `${supabaseUrl}/rest/v1/users`,
    {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        telegram_id: telegramId,
        name: name || null,
        username: username || null,
        last_seen_at: new Date().toISOString(),
      })
    },
    supabaseKey
  )
}

async function checkAccess(supabaseUrl, supabaseKey, telegramId) {
  if (!telegramId) return { allowed: true }

  const now = new Date().toISOString()

  // Проверяем активную подписку
  const subs = await supabaseRequest(
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${telegramId}&plan=eq.pro&expires_at=gte.${now}&select=expires_at&limit=1`,
    { method: 'GET' },
    supabaseKey
  ).catch(() => [])
  if (Array.isArray(subs) && subs.length > 0) return { allowed: true, plan: 'pro' }

  // Проверяем триал
  const users = await supabaseRequest(
    `${supabaseUrl}/rest/v1/users?telegram_id=eq.${telegramId}&select=trial_ends_at&limit=1`,
    { method: 'GET' },
    supabaseKey
  ).catch(() => [])
  const user = Array.isArray(users) ? users[0] : null
  if (user?.trial_ends_at && new Date(user.trial_ends_at) > new Date()) {
    return { allowed: true, plan: 'trial' }
  }

  return { allowed: false, plan: 'expired' }
}

async function logScan(supabaseUrl, supabaseKey, telegramId, calories) {
  if (!telegramId) return
  await supabaseRequest(
    `${supabaseUrl}/rest/v1/scans`,
    {
      method: 'POST',
      body: JSON.stringify({ user_id: telegramId, calories: calories || null })
    },
    supabaseKey
  )
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-User-Id, X-Telegram-User-Name, X-Telegram-Username')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY

  const telegramId = req.headers['x-telegram-user-id'] ? parseInt(req.headers['x-telegram-user-id']) : null
  const telegramName = req.headers['x-telegram-user-name'] || null
  const telegramUsername = req.headers['x-telegram-username'] || null

  if (supabaseUrl && supabaseKey && telegramId) {
    await trackUser(supabaseUrl, supabaseKey, telegramId, telegramName, telegramUsername)

    const access = await checkAccess(supabaseUrl, supabaseKey, telegramId)
    if (!access.allowed) {
      return res.status(403).json({
        error: 'trial_expired',
        message: 'Пробный период закончился. Оформи подписку для продолжения.',
      })
    }
  }

  try {
    const body = req.body
    const userContent = body.messages?.[0]?.content || []
    const imgPart = userContent.find(p => p.type === 'image')
    const textPart = userContent.find(p => p.type === 'text')

    // Text-only mode
    if (body.text_only || !imgPart) {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: body.max_tokens || 1000,
          messages: [{ role: 'user', content: textPart?.text || '' }] })
      })
      const data = await openaiRes.json()
      if (!openaiRes.ok) return res.status(openaiRes.status).json({ error: data.error?.message || 'OpenAI error' })
      const responseText = data.choices?.[0]?.message?.content || ''
      if (supabaseUrl && supabaseKey && telegramId) {
        try { const p=JSON.parse(responseText.replace(/```json\s*/g,'').replace(/```/g,'').trim()); await logScan(supabaseUrl,supabaseKey,telegramId,p?.total?.calories) } catch { await logScan(supabaseUrl,supabaseKey,telegramId,null) }
      }
      return res.status(200).json({ content: [{ type: 'text', text: responseText }] })
    }

    if (!textPart) return res.status(400).json({ error: 'Missing text content' })

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: body.max_tokens || 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imgPart.source.media_type};base64,${imgPart.source.data}`, detail: 'low' } },
            { type: 'text', text: textPart.text }
          ]
        }]
      })
    })

    const data = await openaiRes.json()
    if (!openaiRes.ok) return res.status(openaiRes.status).json({ error: data.error?.message || 'OpenAI error' })

    const responseText = data.choices?.[0]?.message?.content || ''
    if (supabaseUrl && supabaseKey && telegramId) {
      try {
        const parsed = JSON.parse(responseText.replace(/```json\s*/g, '').replace(/```/g, '').trim())
        await logScan(supabaseUrl, supabaseKey, telegramId, parsed?.total?.calories)
      } catch {
        await logScan(supabaseUrl, supabaseKey, telegramId, null)
      }
    }

    return res.status(200).json({ content: [{ type: 'text', text: responseText }] })

  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
}
