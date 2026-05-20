const FREE_SCAN_LIMIT = 5

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
  return res.json()
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

async function checkScanLimit(supabaseUrl, supabaseKey, telegramId) {
  if (!telegramId) return { allowed: true }

  const [subData] = await supabaseRequest(
    `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${telegramId}&select=plan,expires_at`,
    { method: 'GET' },
    supabaseKey
  )
  const isPro = subData?.plan === 'pro' && subData?.expires_at && new Date(subData.expires_at) > new Date()
  if (isPro) return { allowed: true, plan: 'pro' }

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const scansData = await supabaseRequest(
    `${supabaseUrl}/rest/v1/scans?user_id=eq.${telegramId}&created_at=gte.${monthStart.toISOString()}&select=id`,
    { method: 'GET' },
    supabaseKey
  )
  const count = Array.isArray(scansData) ? scansData.length : 0

  return { allowed: count < FREE_SCAN_LIMIT, used: count, limit: FREE_SCAN_LIMIT, plan: 'free' }
}

async function logScan(supabaseUrl, supabaseKey, telegramId, calories) {
  if (!telegramId) return

  await supabaseRequest(
    `${supabaseUrl}/rest/v1/scans`,
    {
      method: 'POST',
      body: JSON.stringify({
        user_id: telegramId,
        calories: calories || null,
      })
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

    const limit = await checkScanLimit(supabaseUrl, supabaseKey, telegramId)
    if (!limit.allowed) {
      return res.status(403).json({
        error: 'limit_reached',
        message: `Бесплатный лимит: ${limit.limit} сканирований в месяц. Оформи подписку для безлимитного доступа.`,
        used: limit.used,
        limit: limit.limit,
      })
    }
  }

  try {
    const body = req.body
    const userContent = body.messages?.[0]?.content || []
    const imgPart = userContent.find(p => p.type === 'image')
    const textPart = userContent.find(p => p.type === 'text')

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: body.max_tokens || 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${imgPart.source.media_type};base64,${imgPart.source.data}`,
                detail: 'low'
              }
            },
            { type: 'text', text: textPart.text }
          ]
        }]
      })
    })

    const data = await openaiRes.json()

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({ error: data.error?.message || 'OpenAI error' })
    }

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
