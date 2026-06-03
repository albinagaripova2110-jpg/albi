import express from 'express'
import { fileURLToPath } from 'url'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

// ── API handlers (Vercel-style, compatible with Express) ───────────
import analyzeHandler        from './api/analyze.js'
import syncHandler           from './api/sync.js'
import adminHandler          from './api/admin.js'
import botWebhookHandler     from './api/bot-webhook.js'
import adminGrantHandler     from './api/admin/grant.js'
import adminPromoHandler     from './api/admin/promo.js'
import adminReferralsHandler from './api/admin/referrals.js'
import adminSubsListHandler  from './api/admin/subs-list.js'
import adminSupportHandler   from './api/admin/support.js'
import paymentCreateHandler  from './api/payment/create.js'
import paymentWebhookHandler from './api/payment/webhook.js'
import cronNotifyHandler     from './api/cron/notify-expiring.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const app = express()

// ── Body parsing ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── API routes ──────────────────────────────────────────────────────
const wrap = (fn) => (req, res) => fn(req, res)

app.all('/api/analyze',              wrap(analyzeHandler))
app.all('/api/sync',                 wrap(syncHandler))
app.all('/api/admin',                wrap(adminHandler))
app.all('/api/bot-webhook',          wrap(botWebhookHandler))
app.all('/api/admin/grant',          wrap(adminGrantHandler))
app.all('/api/admin/promo',          wrap(adminPromoHandler))
app.all('/api/admin/referrals',      wrap(adminReferralsHandler))
app.all('/api/admin/subs-list',      wrap(adminSubsListHandler))
app.all('/api/admin/support',        wrap(adminSupportHandler))
app.all('/api/payment/create',       wrap(paymentCreateHandler))
app.all('/api/payment/webhook',      wrap(paymentWebhookHandler))
app.all('/api/cron/notify-expiring', wrap(cronNotifyHandler))

// ── Static React build ──────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist')
app.use(express.static(distPath))

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

// ── Start ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Albi server started on port ${PORT}`)
})
