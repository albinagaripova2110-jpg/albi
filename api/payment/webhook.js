import crypto from 'crypto'

const PLAN_DAYS = {
  monthly:   30,
  quarterly: 90,
  halfyear:  180,
  yearly:    365, // legacy
}

const REFERRAL_BONUS = {
  monthly:   7,
  quarterly: 14,
  halfyear:  21,
  yearly:    30, // legacy
}

const PLAN_NAMES = {
  monthly:   '1 месяц',
  quarterly: '3 месяца',
  halfyear:  '6 месяцев',
  yearly:    '1 год',
}

// Сообщение рефереру при начислении бонуса
function referralBonusText(userName, bonusDays, newExpiry, plan, referrerId) {
  const date = new Date(newExpiry).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
  const refLink = `https://t.me/AlbiScan_bot?start=ref_${referrerId}`
  if (plan === 'monthly') {
    return `${userName}, твой друг только что оплатил подписку Albi! 🥳\n\nКак и обещали — тебе начислено +${bonusDays} дней бесплатного доступа.\nТвоя подписка теперь действует до: ${date}\n\nЧем больше друзей — тем дольше бесплатно 😉\n\nПоделись ссылкой ещё раз 👇\n${refLink}`
  }
  if (plan === 'quarterly') {
    return `${userName}, отличные новости! 🎊\nТвой друг купил подписку на 3 месяца — и ты получаешь +${bonusDays} дней бесплатно!\n\nТвоя подписка теперь действует до: ${date}\nСпасибо что делишься Albi — это лучшая поддержка 🤍\n${refLink}`
  }
  return `${userName}, это просто огонь! 🔥\nТвой друг взял подписку на 6 месяцев — и ты получаешь +${bonusDays} дней бесплатно!\n\nТвоя подписка теперь действует до: ${date}\nПродолжай делиться — каждый друг приближает тебя к бесплатному Albi навсегда 😄\n${refLink}`
}

async function sendTelegram(botToken, chatId, text) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  })
}

async function db(url, supabaseUrl, supabaseKey, options = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${url}`, {
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

function verifySign(data, secretKey) {
  try {
    const { sign, ...params } = data
    const sortedValues = Object.keys(params).sort().map(k => String(params[k] ?? '')).join('|')
    const expected = crypto.createHmac('sha256', secretKey).update(sortedValues).digest('hex')
    return sign === expected
  } catch { return false }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end()

  const secretKey = process.env.PRODAMUS_SECRET_KEY
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  try {
    // Продамус может слать и JSON и form-encoded
    let data = req.body
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch {
        data = Object.fromEntries(new URLSearchParams(data))
      }
    }

    console.log('Prodamus webhook received:', JSON.stringify(data))

    // Проверяем подпись — логируем но не блокируем
    if (secretKey && data.sign) {
      const valid = verifySign(data, secretKey)
      if (!valid) {
        console.warn('Prodamus: signature mismatch, proceeding anyway')
      }
    }

    // Продамус может называть статус по-разному
    const status = data.payment_status || data.status || data.paymentStatus || ''
    console.log('Payment status:', status)

    if (status !== 'success') {
      console.log('Not a success status, skipping')
      return res.status(200).json({ ok: true })
    }

    // order_id может быть нашим albi_... или внутренним ID Продамуса
    const rawOrderId = data.order_id || data.orderId || data.order_num || ''
    console.log('Raw order_id from Prodamus:', rawOrderId)

    let telegramId, plan, days

    // Сначала пробуем распарсить как наш формат albi_{telegram_id}_{plan}_{timestamp}
    const parts = rawOrderId.split('_')
    if (parts.length >= 4 && parts[0] === 'albi') {
      telegramId = parseInt(parts[1])
      plan = parts[2]
      days = PLAN_DAYS[plan]
      console.log('Parsed from order_id directly:', { telegramId, plan, days })
    }

    // Если не получилось — ищем в payment_orders по нашему orderId из других полей
    if (!telegramId || !days) {
      const candidateIds = [
        data.payment_orderid,
        data.merchant_order_id,
        data.custom_order_id,
        data.description,
        data.comment,
        data.order_description,
      ].filter(Boolean)
      console.log('Trying candidate order fields:', candidateIds)

      for (const candidate of candidateIds) {
        const p = String(candidate).split('_')
        if (p.length >= 4 && p[0] === 'albi') {
          telegramId = parseInt(p[1])
          plan = p[2]
          days = PLAN_DAYS[plan]
          console.log('Found our orderId in field:', { candidate, telegramId, plan })
          break
        }
      }
    }

    // Последний шанс: ищем в таблице payment_orders — самый свежий необработанный
    if ((!telegramId || !days) && supabaseUrl && supabaseKey) {
      console.log('Looking up payment_orders for recent order, rawOrderId:', rawOrderId)
      const orders = await db(
        `payment_orders?processed=eq.false&order=created_at.desc&limit=5`,
        supabaseUrl, supabaseKey, { method: 'GET' }
      )
      console.log('Recent payment_orders:', JSON.stringify(orders))

      if (Array.isArray(orders) && orders.length > 0) {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000)
        const recent = orders.find(o => new Date(o.created_at) > cutoff)
        if (recent) {
          telegramId = recent.telegram_id
          plan = recent.plan
          days = PLAN_DAYS[plan]
          console.log('Using recent payment_order:', { orderId: recent.order_id, telegramId, plan })
          await db(`payment_orders?order_id=eq.${encodeURIComponent(recent.order_id)}`, supabaseUrl, supabaseKey, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ processed: true })
          })
        }
      }
    }

    if (!telegramId || !days) {
      console.error('Could not resolve telegramId/plan from webhook data:', JSON.stringify(data))
      return res.status(200).json({ ok: false, error: 'Cannot resolve order' })
    }

    console.log('Resolved:', { telegramId, plan, days })

    const now = new Date()
    const newExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

    // Активируем подписку
    const subResult = await db('subscriptions', supabaseUrl, supabaseKey, {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: telegramId,
        plan: 'pro',
        starts_at: now.toISOString(),
        expires_at: newExpiry,
        granted_by_admin: false,
        price_paid: Math.round(parseFloat(data.sum || 0) * 100),
      })
    })
    console.log('Subscription result:', JSON.stringify(subResult))

    // Получаем имя пользователя для сообщений
    let userName = ''
    if (supabaseUrl && supabaseKey) {
      const userRow = await db(`users?telegram_id=eq.${telegramId}&select=name&limit=1`, supabaseUrl, supabaseKey, { method: 'GET' })
      userName = Array.isArray(userRow) && userRow[0]?.name ? userRow[0].name.split(' ')[0] : ''
    }

    // Начисляем бонусные дни рефереру
    const bonusDays = REFERRAL_BONUS[plan] || 0
    if (bonusDays > 0) {
      const refs = await db(
        `referrals?referee_id=eq.${telegramId}&bonus_applied=eq.false&limit=1`,
        supabaseUrl, supabaseKey, { method: 'GET' }
      )
      if (Array.isArray(refs) && refs.length > 0) {
        const ref = refs[0]
        const referrerId = ref.referrer_id
        const referrerSubs = await db(
          `subscriptions?user_id=eq.${referrerId}&plan=eq.pro&order=expires_at.desc&limit=1`,
          supabaseUrl, supabaseKey, { method: 'GET' }
        )
        let referrerNewExpiry = null
        if (Array.isArray(referrerSubs) && referrerSubs.length > 0) {
          const base = new Date(referrerSubs[0].expires_at) > now ? new Date(referrerSubs[0].expires_at) : now
          base.setDate(base.getDate() + bonusDays)
          referrerNewExpiry = base.toISOString()
          await db(`subscriptions?id=eq.${referrerSubs[0].id}`, supabaseUrl, supabaseKey, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ expires_at: referrerNewExpiry })
          })
        }
        await db(`referrals?id=eq.${ref.id}`, supabaseUrl, supabaseKey, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'paid', bonus_days: bonusDays, bonus_applied: true })
        })
        // Сообщение рефереру о начислении бонуса
        if (botToken && referrerNewExpiry) {
          const referrerRow = await db(`users?telegram_id=eq.${referrerId}&select=name&limit=1`, supabaseUrl, supabaseKey, { method: 'GET' })
          const referrerName = Array.isArray(referrerRow) && referrerRow[0]?.name ? referrerRow[0].name.split(' ')[0] : ''
          await sendTelegram(botToken, referrerId, referralBonusText(referrerName, bonusDays, referrerNewExpiry, plan, referrerId))
        }
      }
    }

    // Уведомление пользователю после оплаты
    if (botToken) {
      const expiryDate = new Date(newExpiry).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
      const daysLeft = Math.ceil((new Date(newExpiry) - now) / 86400000)
      const refLink = `https://t.me/AlbiScan_bot?start=ref_${telegramId}`
      const greeting = userName ? `${userName}, оплата` : 'Оплата'
      await sendTelegram(botToken, telegramId,
        `${greeting} прошла успешно! 🎉\nПодписка активирована:\n\nДействует до: ${expiryDate}\nОсталось дней: ${daysLeft}\n\nТеперь у тебя полный доступ ко всем функциям Albi без ограничений.\n\nКстати — поделись своей реферальной ссылкой с другом, и когда он оплатит подписку, ты получишь бонусные дни совершенно бесплатно 🤍\n👇 Твоя ссылка:\n${refLink}`
      )
    }

    console.log(`Payment OK: tg=${telegramId} plan=${plan} expires=${newExpiry}`)
    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error('Payment webhook error:', e)
    return res.status(200).json({ ok: true })
  }
}
