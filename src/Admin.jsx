import { useState, useEffect, useRef } from "react"

const T = {
  bg: "#f9f8f6", surface: "#ffffff", border: "#ececea", borderMd: "#dddbd8",
  text: "#1a1916", muted: "#9a9690", faint: "#c8c4be",
  accent: "#c96a3a", accentBg: "#fdf2ec",
  green: "#5a8a6a", greenBg: "#eef5f1",
  blue: "#4a7aaa", blueBg: "#eef3f9",
  red: "#c04040", redBg: "#fdf2f2",
}

const SECRET_KEY = "admin_secret"

function api(path, options = {}, secret) {
  return fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Admin-Secret": secret, ...options.headers }
  }).then(r => r.json())
}

function fmtDate(iso) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru", { day: "numeric", month: "short", year: "numeric" })
}
function fmtTime(iso) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("ru", { day: "numeric", month: "short" }) + " " +
    d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })
}
function daysLeft(iso) {
  if (!iso) return null
  const diff = new Date(iso) - new Date()
  return Math.ceil(diff / 86400000)
}

// ── Stat Card ────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }) {
  return <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "16px 20px", flex: 1, minWidth: 130 }}>
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".12em", color: T.muted, marginBottom: 6, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 32, fontWeight: 300, fontFamily: "'Cormorant Garamond',serif", color: color || T.text, lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: T.faint, marginTop: 5 }}>{sub}</div>}
  </div>
}

// ── Badge ────────────────────────────────────────────────────────
function Badge({ label, color, bg }) {
  return <span style={{ background: bg, color, fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 50 }}>{label}</span>
}

function PlanBadge({ sub, user }) {
  const now = new Date()
  // Активная подписка
  if (sub) {
    const days = daysLeft(sub.expires_at)
    if (days !== null && days > 0) {
      if (sub.granted_by_admin) return <Badge label={`🎁 ${days} дн.`} color={T.blue} bg={T.blueBg} />
      return <Badge label={`Pro · ${days} дн.`} color={T.green} bg={T.greenBg} />
    }
  }
  // Триал
  if (user?.trial_ends_at && new Date(user.trial_ends_at) > now) {
    const days = daysLeft(user.trial_ends_at)
    return <Badge label={`Триал · ${days} дн.`} color={T.accent} bg={T.accentBg} />
  }
  // Ничего нет
  if (sub) return <Badge label="Истекла" color={T.red} bg={T.redBg} />
  return <Badge label="Нет доступа" color={T.red} bg={T.redBg} />
}

// ── Dashboard Tab ────────────────────────────────────────────────
function DashboardTab({ data }) {
  const { stats, users } = data
  return <div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
      <StatCard label="Всего пользователей" value={stats.totalUsers} color={T.text} />
      <StatCard label="Новых за неделю" value={stats.newUsersThisWeek} color={T.blue} />
      <StatCard label="На триале" value={stats.trialUsers ?? "—"} sub="активных" color={T.accent} />
      <StatCard label="Pro подписок" value={stats.proUsers} sub="активных" color={T.green} />
      <StatCard label="Сканирований" value={stats.scansThisMonth} sub="в этом месяце" color={T.muted} />
    </div>
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "16px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", color: T.muted, textTransform: "uppercase", marginBottom: 12 }}>Последние регистрации</div>
      {users.slice(0, 5).map(u => (
        <div key={u.telegram_id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.border}`, fontSize: 13 }}>
          <span style={{ color: T.text, fontWeight: 500 }}>{u.name || "—"}{u.username ? <span style={{ color: T.muted, fontWeight: 400 }}> @{u.username}</span> : ""}</span>
          <span style={{ color: T.faint, fontSize: 11 }}>{fmtDate(u.created_at)}</span>
        </div>
      ))}
    </div>
  </div>
}

// ── Users Tab ────────────────────────────────────────────────────
function Chip({ label, active, onClick, color }) {
  const c = color || T.accent
  return <button onClick={onClick} style={{
    padding: "5px 14px", borderRadius: 50, border: `1.5px solid ${active ? c : T.border}`,
    background: active ? (color === T.red ? T.redBg : color === T.green ? T.greenBg : T.accentBg) : T.bg,
    color: active ? c : T.muted, cursor: "pointer", fontSize: 12, fontWeight: active ? 600 : 400,
    whiteSpace: "nowrap", transition: "all .15s"
  }}>{label}</button>
}

function UsersTab({ data, secret, onRefresh }) {
  const [search, setSearch]           = useState("")
  const [statusFilter, setStatus]     = useState("all")   // all | pro | trial | expired
  const [planFilter, setPlan]         = useState("all")   // all | monthly | quarterly | halfyear | admin
  const [expiryFilter, setExpiry]     = useState("all")   // all | day1 | day5 | last1 | last3 | last7
  const [selected, setSelected]       = useState(null)
  const [grantDays, setGrantDays]     = useState("30")
  const [granting, setGranting]       = useState(false)
  const [grantMsg, setGrantMsg]       = useState(null)

  const { users, subscriptions } = data
  const now = new Date()

  const getSubForUser = (tid) =>
    (subscriptions || [])
      .filter(s => s.user_id === tid)
      .sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at))[0] || null

  // Угадываем тариф по длине подписки
  const inferPlan = (sub) => {
    if (!sub?.starts_at) return null
    if (sub.granted_by_admin) return "admin"
    const d = Math.round((new Date(sub.expires_at) - new Date(sub.starts_at)) / 86400000)
    if (d <= 35)  return "monthly"
    if (d <= 100) return "quarterly"
    return "halfyear"
  }

  const filtered = (users || []).filter(u => {
    // Поиск
    if (search) {
      const q = search.toLowerCase()
      if (!(u.name || "").toLowerCase().includes(q) &&
          !(u.username || "").toLowerCase().includes(q) &&
          !String(u.telegram_id).includes(q)) return false
    }

    const sub    = getSubForUser(u.telegram_id)
    const isPro  = sub && new Date(sub.expires_at) > now
    const isTrial = !isPro && u.trial_ends_at && new Date(u.trial_ends_at) > now

    // Фильтр по статусу
    if (statusFilter === "pro"     && !isPro)              return false
    if (statusFilter === "trial"   && !isTrial)            return false
    if (statusFilter === "expired" && (isPro || isTrial))  return false

    // Фильтр по тарифу (только для Pro)
    if (planFilter !== "all") {
      if (!isPro) return false
      if (inferPlan(sub) !== planFilter) return false
    }

    // Фильтр по дням подписки / сроку
    if (expiryFilter !== "all") {
      if (!isPro || !sub) return false
      const daysLeft  = Math.ceil((new Date(sub.expires_at) - now) / 86400000)
      const dayOfSub  = Math.ceil((now - new Date(sub.starts_at)) / 86400000)
      if (expiryFilter === "last1"  && daysLeft > 1)   return false
      if (expiryFilter === "last3"  && daysLeft > 3)   return false
      if (expiryFilter === "last7"  && daysLeft > 7)   return false
      if (expiryFilter === "day1"   && dayOfSub > 3)   return false  // первые 3 дня
      if (expiryFilter === "day5"   && (dayOfSub < 4 || dayOfSub > 7)) return false  // дни 4–7
    }

    return true
  })

  const grant = async () => {
    if (!selected || !grantDays) return
    setGranting(true); setGrantMsg(null)
    const res = await api("/api/admin/grant", { method: "POST", body: JSON.stringify({ telegram_id: selected.telegram_id, days: parseInt(grantDays) }) }, secret)
    if (res.ok) { setGrantMsg(`✅ Выдано ${grantDays} дней до ${fmtDate(res.expires_at)}`); onRefresh() }
    else          setGrantMsg("❌ Ошибка: " + (res.error || ""))
    setGranting(false)
  }

  const PLAN_LABELS = { monthly: "1 месяц", quarterly: "3 месяца", halfyear: "6 месяцев", admin: "🎁 Админ" }

  return <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 320px" : "1fr", gap: 16 }}>
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>

      {/* Поиск + счётчик */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 12, alignItems: "center" }}>
        <input placeholder="Поиск по имени, @username, ID…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, background: T.bg, border: `1.5px solid ${T.border}`, borderRadius: 50, padding: "7px 14px", fontSize: 13, color: T.text, outline: "none", fontFamily: "Manrope" }} />
        <span style={{ fontSize: 11, color: T.faint, whiteSpace: "nowrap" }}>{filtered.length} чел.</span>
      </div>

      {/* Фильтры */}
      <div style={{ padding: "12px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Статус */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: ".1em", marginRight: 2 }}>Статус</span>
          {[["all","Все"],["pro","Pro"],["trial","Триал"],["expired","Нет доступа"]].map(([v,l]) =>
            <Chip key={v} label={l} active={statusFilter===v} onClick={()=>{ setStatus(v); setPlan("all"); setExpiry("all") }}
              color={v==="pro"?T.green:v==="trial"?T.accent:v==="expired"?T.red:T.accent} />
          )}
        </div>

        {/* Тариф */}
        {(statusFilter === "pro" || statusFilter === "all") && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: ".1em", marginRight: 2 }}>Тариф</span>
          {[["all","Все"],["monthly","1 месяц"],["quarterly","3 месяца"],["halfyear","6 месяцев"],["admin","🎁 Админ"]].map(([v,l]) =>
            <Chip key={v} label={l} active={planFilter===v} onClick={()=>setPlan(v)} />
          )}
        </div>}

        {/* Дни подписки */}
        {(statusFilter === "pro" || statusFilter === "all") && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: ".1em", marginRight: 2 }}>Срок</span>
          {[
            ["all",   "Все"],
            ["day1",  "Первые дни (1–3)"],
            ["day5",  "День 4–7"],
            ["last7", "До 7 дней"],
            ["last3", "До 3 дней ⚡"],
            ["last1", "Последний день ⚠️"],
          ].map(([v,l]) =>
            <Chip key={v} label={l} active={expiryFilter===v} onClick={()=>setExpiry(v)}
              color={v==="last1"?T.red:v==="last3"?T.accent:T.accent} />
          )}
        </div>}
      </div>

      {/* Список */}
      {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: T.faint, fontSize: 13 }}>Никого не найдено</div>}
      {filtered.map((u, i) => {
        const sub      = getSubForUser(u.telegram_id)
        const isPro    = sub && new Date(sub.expires_at) > now
        const daysLeft = isPro ? Math.ceil((new Date(sub.expires_at) - now) / 86400000) : null
        const dayOfSub = isPro && sub.starts_at ? Math.ceil((now - new Date(sub.starts_at)) / 86400000) : null
        const sel      = selected?.telegram_id === u.telegram_id
        return <div key={u.telegram_id} onClick={() => setSelected(sel ? null : u)}
          style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: "12px 20px", borderBottom: i < filtered.length-1 ? `1px solid ${T.border}` : "none", cursor: "pointer", background: sel ? T.accentBg : "transparent", transition: "background .15s" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{u.name || "—"}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{u.username ? `@${u.username} · ` : ""}{u.telegram_id}</div>
            {isPro && dayOfSub && <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>
              День {dayOfSub} · {PLAN_LABELS[inferPlan(sub)] || ""}
            </div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <PlanBadge sub={sub} user={u} />
            {daysLeft !== null && <div style={{ fontSize: 10, marginTop: 4, color: daysLeft <= 1 ? T.red : daysLeft <= 3 ? T.accent : T.faint }}>
              {daysLeft <= 1 ? "⚠️ последний день" : `ещё ${daysLeft} дн.`}
            </div>}
            {!isPro && <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>{fmtDate(u.created_at)}</div>}
          </div>
        </div>
      })}
    </div>

    {/* Панель пользователя */}
    {selected && <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 20, height: "fit-content", position: "sticky", top: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 400 }}>Пользователь</div>
        <button onClick={() => { setSelected(null); setGrantMsg(null) }} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 18 }}>×</button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{selected.name || "—"}</div>
        {selected.username && <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>@{selected.username}</div>}
        <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>ID: {selected.telegram_id}</div>
        <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>Регистрация: {fmtDate(selected.created_at)}</div>
        <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>Сканирований: {selected.total_scans}</div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", color: T.muted, textTransform: "uppercase", marginBottom: 8 }}>Подписка</div>
        <PlanBadge sub={getSubForUser(selected.telegram_id)} user={selected} />
        {(() => {
          const s = getSubForUser(selected.telegram_id)
          const p = inferPlan(s)
          const isActive = s && new Date(s.expires_at) > now
          const d = isActive ? Math.ceil((now - new Date(s.starts_at)) / 86400000) : null
          const left = isActive ? Math.ceil((new Date(s.expires_at) - now) / 86400000) : null
          return <>
            {s?.expires_at && <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>До: {fmtDate(s.expires_at)}</div>}
            {p && p !== "admin" && <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Тариф: {PLAN_LABELS[p]}</div>}
            {d !== null && <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>День подписки: {d}</div>}
            {left !== null && <div style={{ fontSize: 11, color: left <= 3 ? T.red : T.muted, marginTop: 2, fontWeight: left <= 3 ? 600 : 400 }}>Осталось: {left} дн.</div>}
          </>
        })()}
        {selected.trial_ends_at && <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>Триал до: {fmtDate(selected.trial_ends_at)}</div>}
      </div>
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", color: T.muted, textTransform: "uppercase", marginBottom: 10 }}>Выдать доступ</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {["7", "14", "30", "90"].map(d => <button key={d} onClick={() => setGrantDays(d)}
            style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${grantDays===d?T.accent:T.border}`, background: grantDays===d?T.accentBg:T.bg, color: grantDays===d?T.accent:T.muted, cursor: "pointer", fontSize: 12, fontWeight: 500 }}>{d} дн.</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input type="number" value={grantDays} onChange={e => setGrantDays(e.target.value)} min="1"
            style={{ flex: 1, background: T.bg, border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: T.text, outline: "none" }} />
          <span style={{ alignSelf: "center", fontSize: 12, color: T.muted }}>дней</span>
        </div>
        <button onClick={grant} disabled={granting}
          style={{ width: "100%", background: T.accent, color: "#fff", border: "none", padding: "10px", borderRadius: 50, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Manrope" }}>
          {granting ? "Выдаю…" : "🎁 Выдать доступ"}
        </button>
        {grantMsg && <div style={{ fontSize: 12, marginTop: 8, color: grantMsg.startsWith("✅") ? T.green : T.red }}>{grantMsg}</div>}
      </div>
    </div>}
  </div>
}

// ── Subscriptions Tab ────────────────────────────────────────────
function SubscriptionsTab({ data }) {
  const { subscriptions, users } = data
  const getUser = (tid) => (users || []).find(u => u.telegram_id === tid)

  return <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
    <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 600, letterSpacing: ".12em", color: T.muted, textTransform: "uppercase" }}>
      Все подписки · {(subscriptions || []).length}
    </div>
    {!(subscriptions || []).length && <div style={{ padding: 40, textAlign: "center", color: T.faint, fontSize: 13 }}>Подписок пока нет</div>}
    {(subscriptions || []).map((s, i) => {
      const u = getUser(s.user_id)
      const days = daysLeft(s.expires_at)
      const active = days !== null && days > 0
      return <div key={s.id || i} style={{ display: "grid", gridTemplateColumns: "1fr auto 100px 80px", gap: 12, padding: "12px 20px", borderBottom: i < subscriptions.length - 1 ? `1px solid ${T.border}` : "none", alignItems: "center", fontSize: 13 }}>
        <div>
          <div style={{ fontWeight: 500, color: T.text }}>{u?.name || s.user_id}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{u?.username ? `@${u.username}` : ""}</div>
        </div>
        <div style={{ fontSize: 11, color: T.muted, textAlign: "center" }}>
          <div>{fmtDate(s.starts_at || s.created_at)}</div>
          <div style={{ marginTop: 2 }}>→ {fmtDate(s.expires_at)}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          {active ? <span style={{ color: T.green, fontWeight: 600 }}>{days} дн.</span> : <span style={{ color: T.faint }}>—</span>}
          {s.granted_by_admin && <div style={{ fontSize: 10, color: T.blue, marginTop: 2 }}>🎁 от админа</div>}
        </div>
        <div>{active ? <Badge label="Активна" color={T.green} bg={T.greenBg} /> : <Badge label="Истекла" color={T.faint} bg={T.bg} />}</div>
      </div>
    })}
  </div>
}

// ── Promo Tab ────────────────────────────────────────────────────
function PromoTab({ secret }) {
  const [promos, setPromos] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ code: "", bonus_days: "", discount_pct: "", max_uses: "", expires_at: "" })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = async () => {
    setLoading(true)
    const data = await api("/api/admin/promo", {}, secret)
    setPromos(Array.isArray(data) ? data : [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!form.code) return
    setSaving(true); setMsg(null)
    const res = await api("/api/admin/promo", { method: "POST", body: JSON.stringify({ ...form, bonus_days: +form.bonus_days || 0, discount_pct: +form.discount_pct || 0, max_uses: form.max_uses ? +form.max_uses : null }) }, secret)
    if (Array.isArray(res) || res.id || res.code) {
      setMsg("✅ Промокод создан!")
      setForm({ code: "", bonus_days: "", discount_pct: "", max_uses: "", expires_at: "" })
      load()
    } else { setMsg("❌ " + (res.error || "Ошибка")) }
    setSaving(false)
  }

  const toggle = async (id, is_active) => {
    await api("/api/admin/promo", { method: "PATCH", body: JSON.stringify({ id, is_active }) }, secret)
    load()
  }

  return <div style={{ display: "grid", gap: 16 }}>
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 14 }}>Создать промокод</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        {[["Код (напр. ALBI30)", "code", "text"], ["Бонусных дней", "bonus_days", "number"], ["Скидка %", "discount_pct", "number"], ["Макс. использований", "max_uses", "number"]].map(([ph, k, t]) =>
          <input key={k} type={t} placeholder={ph} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
            style={{ background: T.bg, border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.text, outline: "none", fontFamily: "Manrope" }} />
        )}
      </div>
      <div style={{ marginBottom: 10 }}>
        <input type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
          style={{ width: "100%", background: T.bg, border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.text, outline: "none", fontFamily: "Manrope" }} />
      </div>
      <button onClick={create} disabled={saving || !form.code}
        style={{ background: T.accent, color: "#fff", border: "none", padding: "10px 24px", borderRadius: 50, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Manrope" }}>
        {saving ? "Создаю…" : "+ Создать"}
      </button>
      {msg && <span style={{ fontSize: 12, marginLeft: 12, color: msg.startsWith("✅") ? T.green : T.red }}>{msg}</span>}
    </div>

    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 600, letterSpacing: ".12em", color: T.muted, textTransform: "uppercase" }}>Промокоды · {promos.length}</div>
      {loading && <div style={{ padding: 30, textAlign: "center", color: T.faint, fontSize: 13 }}>Загрузка…</div>}
      {!loading && !promos.length && <div style={{ padding: 30, textAlign: "center", color: T.faint, fontSize: 13 }}>Промокодов пока нет</div>}
      {promos.map((p, i) => <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, padding: "12px 20px", borderBottom: i < promos.length - 1 ? `1px solid ${T.border}` : "none", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.accent, fontFamily: "monospace" }}>{p.code}</span>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
            {p.bonus_days > 0 && `+${p.bonus_days} дней`}
            {p.bonus_days > 0 && p.discount_pct > 0 && " · "}
            {p.discount_pct > 0 && `−${p.discount_pct}%`}
            {p.expires_at && ` · до ${fmtDate(p.expires_at)}`}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.used_count || 0}</div>
          <div style={{ fontSize: 10, color: T.faint }}>{p.max_uses ? `/ ${p.max_uses}` : "∞"}</div>
        </div>
        <button onClick={() => toggle(p.id, !p.is_active)}
          style={{ padding: "5px 14px", borderRadius: 50, border: `1.5px solid ${p.is_active ? T.green : T.border}`, background: p.is_active ? T.greenBg : T.bg, color: p.is_active ? T.green : T.muted, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
          {p.is_active ? "Активен" : "Выкл"}
        </button>
      </div>)}
    </div>
  </div>
}

// ── Support Tab ──────────────────────────────────────────────────
function SupportTab({ secret, adminData }) {
  const [dialogs, setDialogs] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [messages, setMessages] = useState([])
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [msgsLoading, setMsgsLoading] = useState(false)
  const msgEndRef = useRef(null)

  const loadDialogs = async () => {
    const data = await api("/api/admin/support", {}, secret).catch(() => [])
    setDialogs(Array.isArray(data) ? data : [])
    setLoading(false)
  }
  const loadMessages = async (tid) => {
    setMsgsLoading(true)
    const data = await api(`/api/admin/support?telegram_id=${tid}`, {}, secret).catch(() => null)
    if (data !== null) setMessages(Array.isArray(data) ? data : [])
    setMsgsLoading(false)
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
  }

  useEffect(() => { loadDialogs() }, [])
  useEffect(() => {
    if (!selectedUser) return
    loadMessages(selectedUser.telegram_id)
    const iv = setInterval(() => loadMessages(selectedUser.telegram_id), 5000)
    return () => clearInterval(iv)
  }, [selectedUser?.telegram_id])

  const sendReply = async () => {
    if (!reply.trim() || !selectedUser) return
    setSending(true)
    await api("/api/admin/support", { method: "POST", body: JSON.stringify({ telegram_id: selectedUser.telegram_id, message: reply, user_name: selectedUser.user_name }) }, secret)
    setReply("")
    loadMessages(selectedUser.telegram_id)
    loadDialogs()
    setSending(false)
  }

  const totalUnread = dialogs.reduce((s, d) => s + (d.unread || 0), 0)

  return <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, height: 600 }}>
    {/* Dialogs list */}
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 600, letterSpacing: ".1em", color: T.muted, textTransform: "uppercase" }}>
        Диалоги {totalUnread > 0 && <span style={{ background: T.accent, color: "#fff", borderRadius: 50, padding: "1px 7px", fontSize: 10, marginLeft: 6 }}>{totalUnread}</span>}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <div style={{ padding: 20, textAlign: "center", color: T.faint, fontSize: 12 }}>Загрузка…</div>}
        {!loading && !dialogs.length && <div style={{ padding: 20, textAlign: "center", color: T.faint, fontSize: 12 }}>Сообщений пока нет</div>}
        {dialogs.map(d => {
          const sel = selectedUser?.telegram_id === d.telegram_id
          return <div key={d.telegram_id} onClick={() => { setSelectedUser(d); setMessages([]); loadMessages(d.telegram_id); loadDialogs() }}
            style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: sel ? T.accentBg : "transparent", transition: "background .15s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 13, fontWeight: d.unread ? 700 : 500, color: T.text }}>{d.user_name || "Пользователь"}</span>
              {d.unread > 0 && <span style={{ background: T.accent, color: "#fff", borderRadius: 50, padding: "1px 6px", fontSize: 10 }}>{d.unread}</span>}
            </div>
            <div style={{ fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.message}</div>
            <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>{fmtTime(d.created_at)}</div>
          </div>
        })}
      </div>
    </div>

    {/* Chat window */}
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {!selectedUser
        ? <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontSize: 13 }}>Выбери диалог</div>
        : <>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{selectedUser.user_name || "Пользователь"}</div>
              <div style={{ fontSize: 11, color: T.faint }}>ID: {selectedUser.telegram_id}</div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {msgsLoading && !messages.length && <div style={{ textAlign: "center", color: T.faint, fontSize: 12, padding: 20 }}>Загрузка…</div>}
            {!msgsLoading && !messages.length && <div style={{ textAlign: "center", color: T.faint, fontSize: 12, padding: 20 }}>Нет сообщений</div>}
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.direction === "outbound" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "75%", padding: "10px 14px", borderRadius: m.direction === "outbound" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: m.direction === "outbound" ? T.accent : T.bg, color: m.direction === "outbound" ? "#fff" : T.text, fontSize: 13, lineHeight: 1.5 }}>
                  <div>{m.message}</div>
                  <div style={{ fontSize: 10, opacity: .65, marginTop: 4, textAlign: "right" }}>{fmtTime(m.created_at)}</div>
                </div>
              </div>
            ))}
            <div ref={msgEndRef} />
          </div>
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8 }}>
            <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendReply()}
              placeholder="Написать ответ…"
              style={{ flex: 1, background: T.bg, border: `1.5px solid ${T.border}`, borderRadius: 50, padding: "9px 16px", fontSize: 13, color: T.text, outline: "none", fontFamily: "Manrope" }} />
            <button onClick={sendReply} disabled={sending || !reply.trim()}
              style={{ background: T.accent, color: "#fff", border: "none", padding: "9px 20px", borderRadius: 50, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Manrope" }}>
              {sending ? "…" : "→"}
            </button>
          </div>
        </>}
    </div>
  </div>
}

// ── Referrals Tab ────────────────────────────────────────────────
function ReferralsTab({ secret }) {
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api("/api/admin/referrals", {}, secret)
      .then(d => { setRefs(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Группируем по рефереру
  const byReferrer = {}
  refs.forEach(r => {
    if (!byReferrer[r.referrer_id]) byReferrer[r.referrer_id] = { referrer_id: r.referrer_id, referrer_name: r.referrer_name, total: 0, paid: 0, bonus_days: 0 }
    byReferrer[r.referrer_id].total++
    if (r.status === 'paid') byReferrer[r.referrer_id].paid++
    byReferrer[r.referrer_id].bonus_days += r.bonus_days || 0
  })
  const top = Object.values(byReferrer).sort((a, b) => b.paid - a.paid || b.total - a.total)

  return <div style={{ display: "grid", gap: 16 }}>
    {/* Топ рефереров */}
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 600, letterSpacing: ".12em", color: T.muted, textTransform: "uppercase" }}>
        Топ рефереров · {top.length}
      </div>
      {loading && <div style={{ padding: 30, textAlign: "center", color: T.faint, fontSize: 13 }}>Загрузка…</div>}
      {!loading && !top.length && <div style={{ padding: 30, textAlign: "center", color: T.faint, fontSize: 13 }}>Рефералов пока нет</div>}
      {top.map((r, i) => (
        <div key={r.referrer_id} style={{ display: "grid", gridTemplateColumns: "32px 1fr auto auto auto", gap: 12, padding: "12px 20px", borderBottom: i < top.length - 1 ? `1px solid ${T.border}` : "none", alignItems: "center", fontSize: 13 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.faint, textAlign: "center" }}>#{i + 1}</div>
          <div>
            <div style={{ fontWeight: 500, color: T.text }}>{r.referrer_name || `ID ${r.referrer_id}`}</div>
            <div style={{ fontSize: 11, color: T.faint }}>ID: {r.referrer_id}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{r.total}</div>
            <div style={{ fontSize: 10, color: T.faint }}>привёл</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.green }}>{r.paid}</div>
            <div style={{ fontSize: 10, color: T.faint }}>оплатил</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.blue }}>{r.bonus_days}</div>
            <div style={{ fontSize: 10, color: T.faint }}>бонус дн.</div>
          </div>
        </div>
      ))}
    </div>

    {/* Все рефералы */}
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 600, letterSpacing: ".12em", color: T.muted, textTransform: "uppercase" }}>
        Все рефералы · {refs.length}
      </div>
      {!loading && !refs.length && <div style={{ padding: 30, textAlign: "center", color: T.faint, fontSize: 13 }}>Пока никто не пришёл по ссылке</div>}
      {refs.map((r, i) => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 12, padding: "10px 20px", borderBottom: i < refs.length - 1 ? `1px solid ${T.border}` : "none", alignItems: "center", fontSize: 13 }}>
          <div>
            <div style={{ fontWeight: 500, color: T.text }}>{r.referee_name || `ID ${r.referee_id}`}</div>
            <div style={{ fontSize: 11, color: T.faint }}>пришёл от: {r.referrer_name || r.referrer_id}</div>
          </div>
          <div style={{ fontSize: 11, color: T.faint }}>{fmtDate(r.created_at)}</div>
          <div>
            {r.status === 'paid'
              ? <Badge label="Оплатил" color={T.green} bg={T.greenBg} />
              : <Badge label="Зарегистрирован" color={T.muted} bg={T.bg} />}
          </div>
          <div style={{ fontSize: 12, color: T.blue, fontWeight: 600 }}>{r.bonus_days > 0 ? `+${r.bonus_days} дн.` : "—"}</div>
        </div>
      ))}
    </div>
  </div>
}

// ── Payments Tab ─────────────────────────────────────────────────
function PaymentsTab({ secret }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)

  const PLAN_LABELS = { monthly: "1 месяц", quarterly: "3 месяца", halfyear: "6 месяцев", yearly: "1 год" }
  const PLAN_PRICES = { monthly: 249, quarterly: 599, halfyear: 1099, yearly: 1990 }

  useEffect(() => {
    api("/api/admin?section=payments", {}, secret)
      .then(d => { setPayments(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const total = payments.reduce((s, p) => s + (p.price || 0), 0)
  const byPlan = {}
  payments.forEach(p => { byPlan[p.plan] = (byPlan[p.plan] || 0) + 1 })

  return <div style={{ display: "grid", gap: 16 }}>
    {/* Stats row */}
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <StatCard label="Всего оплат" value={payments.length} color={T.text} />
      <StatCard label="Сумма" value={`${(total / 100).toLocaleString("ru")} ₽`} color={T.green} sub="по всем заказам" />
      {Object.entries(byPlan).map(([plan, cnt]) => (
        <StatCard key={plan} label={PLAN_LABELS[plan] || plan} value={cnt} sub={`× ${PLAN_PRICES[plan] || "?"} ₽`} color={T.accent} />
      ))}
    </div>

    {/* Payments list */}
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 600, letterSpacing: ".12em", color: T.muted, textTransform: "uppercase" }}>
        Все платежи · {payments.length}
      </div>
      {loading && <div style={{ padding: 40, textAlign: "center", color: T.faint, fontSize: 13 }}>Загрузка…</div>}
      {!loading && !payments.length && <div style={{ padding: 40, textAlign: "center", color: T.faint, fontSize: 13 }}>Платежей пока нет</div>}
      {payments.map((p, i) => (
        <div key={p.order_id || i} style={{ display: "grid", gridTemplateColumns: "1fr 120px 90px 80px", gap: 12, padding: "12px 20px", borderBottom: i < payments.length - 1 ? `1px solid ${T.border}` : "none", alignItems: "center", fontSize: 13 }}>
          <div>
            <div style={{ fontWeight: 500, color: T.text }}>{p.user_name || `ID ${p.telegram_id}`}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
              {p.user_username ? `@${p.user_username} · ` : ""}{p.telegram_id}
            </div>
            <div style={{ fontSize: 10, color: T.faint, marginTop: 2, fontFamily: "monospace" }}>{p.order_id}</div>
          </div>
          <div style={{ fontSize: 11, color: T.faint, textAlign: "center" }}>{fmtTime(p.created_at)}</div>
          <div style={{ textAlign: "center" }}>
            <Badge label={PLAN_LABELS[p.plan] || p.plan || "—"} color={T.accent} bg={T.accentBg} />
          </div>
          <div style={{ textAlign: "right", fontWeight: 700, color: T.green, fontSize: 14 }}>
            {p.price ? `${p.price} ₽` : "—"}
          </div>
        </div>
      ))}
    </div>
  </div>
}

// ── Main Admin ───────────────────────────────────────────────────
const TABS = [
  { id: "dashboard", label: "Дашборд", ico: "📊" },
  { id: "users", label: "Пользователи", ico: "👥" },
  { id: "payments", label: "Оплаты", ico: "💰" },
  { id: "subscriptions", label: "Подписки", ico: "💳" },
  { id: "promo", label: "Промокоды", ico: "🎟️" },
  { id: "referrals", label: "Рефералы", ico: "🔗" },
  { id: "support", label: "Поддержка", ico: "💬" },
]

export default function Admin() {
  const [secret, setSecret] = useState(() => localStorage.getItem(SECRET_KEY) || "")
  const [input, setInput] = useState("")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState("dashboard")

  async function load(s, silent = false) {
    if (silent) setRefreshing(true); else { setLoading(true); setErr(null) }
    const res = await api("/api/admin", {}, s)
    if (res.error === "Unauthorized") { setErr("Неверный пароль"); setLoading(false); setRefreshing(false); return }
    if (res.error) { setErr(res.error); setLoading(false); setRefreshing(false); return }

    // Load subscriptions separately
    const allSubs = await fetch("/api/admin/subs-list", { headers: { "X-Admin-Secret": s } }).then(r => r.json()).catch(() => [])

    setData({ ...res, subscriptions: Array.isArray(allSubs) ? allSubs : [] })
    setSecret(s)
    localStorage.setItem(SECRET_KEY, s)
    if (silent) setRefreshing(false); else setLoading(false)
  }

  useEffect(() => { if (secret) load(secret) }, [])

  if (!secret || err === "Неверный пароль") return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Manrope" }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 20, padding: 36, width: "100%", maxWidth: 360 }}>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 32, fontWeight: 300, marginBottom: 24 }}>Albi<span style={{ color: T.accent }}>·</span> Admin</div>
        <input type="password" placeholder="Пароль" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && load(input)}
          style={{ width: "100%", background: T.bg, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", fontSize: 14, color: T.text, fontFamily: "Manrope", marginBottom: 12, outline: "none", boxSizing: "border-box" }} />
        {err && <div style={{ color: T.red, fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <button onClick={() => load(input)} disabled={!input || loading}
          style={{ width: "100%", background: T.accent, color: "#fff", border: "none", padding: "13px", borderRadius: 50, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "Manrope" }}>
          {loading ? "Загрузка…" : "Войти"}
        </button>
      </div>
    </div>
  )

  if (loading || !data) return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Manrope", color: T.faint }}>Загрузка…</div>
  )

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "Manrope" }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Manrope',sans-serif}input,button,textarea{font-family:'Manrope',sans-serif}input:focus{outline:none}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {/* Header */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 300 }}>Albi<span style={{ color: T.accent }}>·</span> Admin</div>
          <div style={{ display: "flex", gap: 4 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: "6px 14px", borderRadius: 50, border: "none", background: tab === t.id ? T.accentBg : "transparent", color: tab === t.id ? T.accent : T.muted, cursor: "pointer", fontSize: 12, fontWeight: tab === t.id ? 600 : 400 }}>
                {t.ico} {t.label}
              </button>
            ))}
            <button onClick={() => load(secret, true)} disabled={refreshing}
              style={{ padding: "6px 14px", borderRadius: 50, border: `1.5px solid ${T.border}`, background: "transparent", color: refreshing ? T.faint : T.accent, cursor: "pointer", fontSize: 12, marginLeft: 8, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ display: "inline-block", animation: refreshing ? "spin .8s linear infinite" : "none" }}>↻</span>
              {refreshing ? "Обновляю…" : "Обновить"}
            </button>
            <button onClick={() => { localStorage.removeItem(SECRET_KEY); setSecret(""); setData(null); setInput("") }}
              style={{ padding: "6px 14px", borderRadius: 50, border: `1.5px solid ${T.border}`, background: "transparent", color: T.muted, cursor: "pointer", fontSize: 12, marginLeft: 4 }}>
              Выйти
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px" }}>
        {tab === "dashboard" && <DashboardTab data={data} />}
        {tab === "users" && <UsersTab data={data} secret={secret} onRefresh={() => load(secret, true)} />}
        {tab === "payments" && <PaymentsTab secret={secret} />}
        {tab === "subscriptions" && <SubscriptionsTab data={data} />}
        {tab === "promo" && <PromoTab secret={secret} />}
        {tab === "referrals" && <ReferralsTab secret={secret} />}
        {tab === "support" && <SupportTab secret={secret} adminData={data} />}
      </div>
    </div>
  )
}
