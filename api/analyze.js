export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' })

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
        max_tokens: 1000,
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

    const text = data.choices?.[0]?.message?.content || ''
    return res.status(200).json({ content: [{ type: 'text', text }] })

  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
}
