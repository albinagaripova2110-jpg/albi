export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()
    const userContent = body.messages?.[0]?.content || []
    const imgPart = userContent.find(p => p.type === 'image')
    const textPart = userContent.find(p => p.type === 'text')

    const openaiBody = {
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
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openaiBody),
    })

    const data = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || 'OpenAI error' }), {
        status: res.status, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Convert OpenAI response → Anthropic-style (frontend stays the same)
    const text = data.choices?.[0]?.message?.content || ''
    const converted = { content: [{ type: 'text', text }] }

    return new Response(JSON.stringify(converted), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}
