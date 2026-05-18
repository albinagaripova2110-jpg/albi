export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()

    // Extract image and prompt from Anthropic-style request
    const userContent = body.messages?.[0]?.content || []
    const imgPart = userContent.find(p => p.type === 'image')
    const textPart = userContent.find(p => p.type === 'text')

    // Build Gemini request
    const geminiBody = {
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: imgPart.source.media_type,
              data: imgPart.source.data,
            }
          },
          { text: textPart.text }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
      }
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      }
    )

    const data = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || 'Gemini error' }), {
        status: res.status, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Convert Gemini response → Anthropic-style response (so frontend stays the same)
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const converted = {
      content: [{ type: 'text', text }]
    }

    return new Response(JSON.stringify(converted), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}
