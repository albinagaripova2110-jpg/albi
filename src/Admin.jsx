import { useState, useEffect } from "react"

const T = {
  bg:       "#f9f8f6",
  surface:  "#ffffff",
  border:   "#ececea",
  text:     "#1a1916",
  muted:    "#9a9690",
  faint:    "#c8c4be",
  accent:   "#c96a3a",
  accentBg: "#fdf2ec",
  green:    "#5a8a6a",
  greenBg:  "#eef5f1",
  blue:     "#4a7aaa",
  blueBg:   "#eef3f9",
  red:      "#c04040",
  redBg:    "#fdf2f2",
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:16,padding:"18px 20px",flex:1,minWidth:140}}>
      <div style={{fontSize:11,fontWeight:600,letterSpacing:".12em",color:T.muted,marginBottom:8,textTransform:"uppercase"}}>{label}</div>
      <div style={{fontSize:36,fontWeight:300,fontFamily:"'Cormorant Garamond',serif",color:color||T.text,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:T.faint,marginTop:6}}>{sub}</div>}
    </div>
  )
}

function fmtDate(iso) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("ru", {day:"numeric",month:"short",year:"numeric"})
}

function fmtTime(iso) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("ru", {day:"numeric",month:"short"}) + " " +
    d.toLocaleTimeString("ru", {hour:"2-digit",minute:"2-digit"})
}

export default function Admin() {
  const [secret, setSecret] = useState(() => localStorage.getItem("admin_secret") || "")
  const [input, setInput] = useState("")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [search, setSearch] = useState("")

  async function load(s) {
    setLoading(true); setErr(null)
    try {
      const res = await fetch("/api/admin", {
        headers: { "X-Admin-Secret": s }
      })
      if (res.status === 401) { setErr("Неверный пароль"); setLoading(false); return }
      if (!res.ok) { setErr("Ошибка сервера"); setLoading(false); return }
      const json = await res.json()
      setData(json)
      setSecret(s)
      localStorage.setItem("admin_secret", s)
    } catch(e) {
      setErr(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { if (secret) load(secret) }, [])

  if (!secret || err === "Неверный пароль") {
    return (
      <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Manrope',sans-serif"}}>
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:20,padding:36,width:"100%",maxWidth:360}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,marginBottom:6}}>
            Albi<span style={{color:T.accent}}>·</span>
          </div>
          <div style={{fontSize:13,color:T.muted,marginBottom:28}}>Панель администратора</div>
          <input
            type="password"
            placeholder="Секретный пароль"
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&load(input)}
            style={{width:"100%",background:T.bg,border:`1.5px solid ${T.border}`,borderRadius:10,padding:"12px 14px",fontSize:14,color:T.text,fontFamily:"Manrope",boxSizing:"border-box",marginBottom:12,outline:"none"}}
          />
          {err&&<div style={{color:T.red,fontSize:12,marginBottom:10}}>{err}</div>}
          <button
            onClick={()=>load(input)}
            disabled={!input||loading}
            style={{width:"100%",background:T.accent,color:"#fff",border:"none",padding:"13px",borderRadius:50,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Manrope"}}
          >
            {loading?"Загрузка…":"Войти"}
          </button>
        </div>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Manrope",color:T.faint,fontSize:14}}>
        Загрузка…
      </div>
    )
  }

  const { stats, users } = data
  const filtered = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return (u.name||"").toLowerCase().includes(q) ||
           (u.username||"").toLowerCase().includes(q) ||
           String(u.telegram_id).includes(q)
  })

  return (
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Manrope',sans-serif",padding:"32px 20px 60px"}}>
      <div style={{maxWidth:900,margin:"0 auto"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:32}}>
          <div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:36,fontWeight:300,lineHeight:1}}>
              Albi<span style={{color:T.accent}}>·</span> Admin
            </div>
            <div style={{fontSize:12,color:T.muted,marginTop:6}}>
              {new Date().toLocaleDateString("ru",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
            </div>
          </div>
          <button
            onClick={()=>{localStorage.removeItem("admin_secret");setSecret("");setData(null);setInput("")}}
            style={{background:"none",border:`1.5px solid ${T.border}`,borderRadius:50,padding:"8px 18px",fontSize:12,color:T.muted,cursor:"pointer",fontFamily:"Manrope"}}
          >
            Выйти
          </button>
        </div>

        {/* Stats */}
        <div style={{display:"flex",gap:12,marginBottom:28,flexWrap:"wrap"}}>
          <StatCard label="Всего пользователей" value={stats.totalUsers} sub="за всё время" color={T.text}/>
          <StatCard label="Новых за неделю" value={stats.newUsersThisWeek} sub="последние 7 дней" color={T.blue}/>
          <StatCard label="Сканирований" value={stats.scansThisMonth} sub="в этом месяце" color={T.accent}/>
          <StatCard label="Pro подписок" value={stats.proUsers} sub="активных" color={T.green}/>
        </div>

        {/* Users table */}
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,overflow:"hidden"}}>
          <div style={{padding:"18px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div style={{fontSize:11,fontWeight:600,letterSpacing:".12em",color:T.muted,textTransform:"uppercase"}}>
              Пользователи · {filtered.length}
            </div>
            <input
              placeholder="Поиск по имени или @username"
              value={search}
              onChange={e=>setSearch(e.target.value)}
              style={{background:T.bg,border:`1.5px solid ${T.border}`,borderRadius:50,padding:"8px 16px",fontSize:13,color:T.text,fontFamily:"Manrope",outline:"none",width:240}}
            />
          </div>

          {filtered.length === 0 && (
            <div style={{padding:40,textAlign:"center",color:T.faint,fontSize:13}}>
              {search ? "Никого не найдено" : "Пользователей пока нет"}
            </div>
          )}

          {filtered.map((u, i) => (
            <div key={u.telegram_id} style={{
              display:"grid",
              gridTemplateColumns:"1fr 120px 80px 100px 120px",
              gap:12,
              padding:"14px 20px",
              borderBottom: i < filtered.length-1 ? `1px solid ${T.border}` : "none",
              alignItems:"center",
              fontSize:13,
            }}>
              {/* Name */}
              <div>
                <div style={{fontWeight:500,color:T.text}}>{u.name || "—"}</div>
                <div style={{fontSize:11,color:T.muted,marginTop:2}}>
                  {u.username ? `@${u.username}` : ""} · {u.telegram_id}
                </div>
              </div>

              {/* Registered */}
              <div style={{color:T.muted,fontSize:12}}>{fmtDate(u.created_at)}</div>

              {/* Scans */}
              <div style={{textAlign:"center"}}>
                <span style={{fontWeight:600,color:T.accent}}>{u.total_scans}</span>
                <span style={{fontSize:11,color:T.faint}}> ск.</span>
              </div>

              {/* Plan */}
              <div>
                {u.plan === "pro" ? (
                  <span style={{background:T.greenBg,color:T.green,fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:50}}>Pro</span>
                ) : (
                  <span style={{background:T.bg,color:T.muted,fontSize:11,padding:"3px 10px",borderRadius:50}}>Free</span>
                )}
              </div>

              {/* Last seen */}
              <div style={{color:T.faint,fontSize:11}}>{fmtTime(u.last_seen_at)}</div>
            </div>
          ))}
        </div>

        {/* Column headers hint */}
        {filtered.length > 0 && (
          <div style={{
            display:"grid",
            gridTemplateColumns:"1fr 120px 80px 100px 120px",
            gap:12,
            padding:"8px 20px 0",
            fontSize:10,
            color:T.faint,
            letterSpacing:".08em",
            textTransform:"uppercase"
          }}>
            <div>Пользователь</div>
            <div>Регистрация</div>
            <div style={{textAlign:"center"}}>Сканы</div>
            <div>Тариф</div>
            <div>Был в сети</div>
          </div>
        )}

        <div style={{marginTop:16,textAlign:"center"}}>
          <button onClick={()=>load(secret)} style={{background:"none",border:`1.5px solid ${T.border}`,borderRadius:50,padding:"8px 20px",fontSize:12,color:T.muted,cursor:"pointer",fontFamily:"Manrope"}}>
            Обновить данные
          </button>
        </div>
      </div>
    </div>
  )
}
