import { useState, useRef, useCallback, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, ReferenceLine } from "recharts";

// ─── Palette & tokens ────────────────────────────────────────────
const T = {
  bg:       "#f9f8f6",
  surface:  "#ffffff",
  border:   "#ececea",
  borderMd: "#dddbd8",
  text:     "#1a1916",
  muted:    "#9a9690",
  faint:    "#c8c4be",
  accent:   "#c96a3a",   // dawn terracotta
  accentBg: "#fdf2ec",
  accentMd: "#e8845a",
  green:    "#5a8a6a",
  greenBg:  "#eef5f1",
  blue:     "#4a7aaa",
  blueBg:   "#eef3f9",
};

const CSS = `
html,body{overflow-x:hidden;width:100%;min-height:100vh}

*{box-sizing:border-box;margin:0;padding:0}
html,body{background:${T.bg};color:${T.text};font-family:'Manrope',sans-serif}
input,select,button,textarea{font-family:'Manrope',sans-serif}
input:focus,select:focus{outline:none;border-color:${T.accent}!important;box-shadow:0 0 0 3px ${T.accentBg}}
::placeholder{color:${T.faint}}
.zone{border:1.5px dashed ${T.borderMd};border-radius:14px;padding:32px 20px;text-align:center;cursor:pointer;background:${T.surface};transition:all .25s}
.zone:hover{border-color:${T.accent};background:${T.accentBg}}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.up{animation:fadeUp .4s cubic-bezier(.16,1,.3,1) forwards}
@keyframes spin{to{transform:rotate(360deg)}}
.spin{animation:spin .9s linear infinite;display:inline-block;margin-right:6px}
.tab{flex:1;background:none;border:none;color:${T.faint};padding:12px 0 10px;cursor:pointer;font-size:10px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;transition:color .2s;display:flex;flex-direction:column;align-items:center;gap:4px;font-family:'Manrope',sans-serif}
.tab.on{color:${T.accent}}
.tab .ico{font-size:18px;line-height:1}
.btn-pill{padding:7px 16px;border-radius:50px;border:1.5px solid ${T.borderMd};background:${T.surface};color:${T.muted};font-size:12px;font-weight:500;cursor:pointer;transition:all .2s;font-family:'Manrope',sans-serif;letter-spacing:.02em}
.btn-pill.on{border-color:${T.accent};background:${T.accentBg};color:${T.accent}}
.row-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid ${T.border};transition:background .15s}
.row-item:last-child{border-bottom:none}
.portion-opt{padding:10px 14px;border-radius:12px;border:1.5px solid ${T.border};background:${T.surface};color:${T.muted};font-size:12px;font-weight:500;cursor:pointer;text-align:left;transition:all .2s;line-height:1.5}
.portion-opt.on{border-color:${T.accent};background:${T.accentBg};color:${T.accent}}
.ghost-btn{background:transparent;color:${T.muted};border:1.5px solid ${T.border};padding:10px 22px;border-radius:50px;font-size:13px;font-weight:500;cursor:pointer;font-family:'Manrope',sans-serif;transition:all .2s}
.ghost-btn:hover{border-color:${T.borderMd};color:${T.text}}
input[type=range]{width:100%;accent-color:${T.accent}}
`;

// ─── TDEE ─────────────────────────────────────────────────────────
function calcTDEE({ gender, age, weight, height, activity, goal }) {
  const bmr = gender === "female"
    ? 10*weight + 6.25*height - 5*age - 161
    : 10*weight + 6.25*height - 5*age + 5;
  const mult = {sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryActive:1.9};
  const tdee = Math.round(bmr*(mult[activity]||1.2));
  const target = goal==="loss"?Math.round(tdee*0.80):goal==="gain"?Math.round(tdee*1.15):tdee;
  return { bmr:Math.round(bmr), tdee, target };
}

// ─── AI ───────────────────────────────────────────────────────────
const JSON_SCHEMA = `{"dishes":[{"name":"...","weight":"...г","calories":0,"protein":0,"fat":0,"carbs":0}],"total":{"calories":0,"protein":0,"fat":0,"carbs":0},"health_score":8,"recommendation":"...","assumptions":"...","comment":"..."}`;
const DIET_PROMPT_SUFFIX = `\nВ поле health_score поставь оценку 1-10 (насколько блюдо полезно для здоровья). В поле recommendation — 1 конкретный совет как улучшить это блюдо или что добавить. В поле assumptions — что ты предположил(а) при расчёте.\nОтветь ТОЛЬКО валидным JSON без markdown:\n${JSON_SCHEMA}`;

async function parseAIResponse(res) {
  const raw = await res.text();
  if(!res.ok) {
    let errData; try{errData=JSON.parse(raw);}catch{}
    if(errData?.error==="limit_reached"||errData?.error==="trial_expired")
      throw new Error(`🔒 ${errData.message||"Пробный период закончился. Оформи подписку."}`);
    if(res.status===429) throw new Error("Слишком много запросов, попробуй через минуту");
    if(res.status>=500) throw new Error("Сервер временно недоступен, попробуй ещё раз");
    throw new Error(errData?.error||errData?.message||`Ошибка ${res.status}`);
  }
  let data; try{data=JSON.parse(raw);}catch{throw new Error("Неверный ответ сервера");}
  const text=(data.content||[]).map(b=>b.type==="text"?b.text:"").join("");
  if(!text) throw new Error("ИИ не вернул результат, попробуй ещё раз");
  const clean=text.replace(/```json\s*/g,"").replace(/```/g,"").trim();
  try{return JSON.parse(clean);}catch{throw new Error("Не удалось разобрать ответ ИИ");}
}

function getTgHeaders() {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const h = {"Content-Type":"application/json"};
  if(tgUser?.id) { h["X-Telegram-User-Id"]=String(tgUser.id); h["X-Telegram-User-Name"]=tgUser.first_name||""; h["X-Telegram-Username"]=tgUser.username||""; }
  return h;
}

async function analyzeFood(base64, mediaType, portionHint, cookMethod, manualCals) {
  const cookNote = cookMethod ? `Способ приготовления: ${cookMethod}. Учти масло/жир если жарка.` : "";
  const manualNote = manualCals ? `Пользователь знает точную калорийность: ${manualCals} ккал — используй именно это число для total.calories, только разбей по БЖУ пропорционально.` : "";
  const res = await fetch("/api/analyze", {
    method:"POST", headers:getTgHeaders(),
    body:JSON.stringify({ model:"gpt-4o-mini", max_tokens:1000,
      messages:[{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:mediaType,data:base64}},
        {type:"text",text:`Ты опытный диетолог-нутрициолог. Оцени еду на фото максимально точно.\nРазмер порции: ${portionHint}.\n${cookNote}\n${manualNote}${DIET_PROMPT_SUFFIX}`}
      ]}]
    })
  });
  return parseAIResponse(res);
}

async function analyzeText(description) {
  const res = await fetch("/api/analyze", {
    method:"POST", headers:getTgHeaders(),
    body:JSON.stringify({ text_only:true, model:"gpt-4o-mini", max_tokens:1000,
      messages:[{role:"user",content:[
        {type:"text",text:`Ты опытный диетолог-нутрициолог. Оцени блюдо по описанию максимально точно.\nОписание: ${description}${DIET_PROMPT_SUFFIX}`}
      ]}]
    })
  });
  return parseAIResponse(res);
}

const todayKey = () => new Date().toISOString().slice(0,10);
const fmtDate = (d) => { const [,m,day]=d.split("-"); return `${day}.${m}`; };

// ─── UI atoms ─────────────────────────────────────────────────────
function Field({ label, ...p }) {
  return <div style={{marginBottom:14}}>
    {label&&<div style={{fontSize:10,fontWeight:600,letterSpacing:".12em",color:T.muted,marginBottom:6,textTransform:"uppercase"}}>{label}</div>}
    <input style={{width:"100%",background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:10,padding:"11px 14px",color:T.text,fontSize:14,transition:"border .2s,box-shadow .2s"}} {...p}/>
  </div>;
}
function Drop({ label, opts, value, onChange }) {
  return <div style={{marginBottom:14}}>
    {label&&<div style={{fontSize:10,fontWeight:600,letterSpacing:".12em",color:T.muted,marginBottom:6,textTransform:"uppercase"}}>{label}</div>}
    <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:10,padding:"11px 14px",color:T.text,fontSize:14,appearance:"none",cursor:"pointer"}}>
      {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </div>;
}

// ─── Progress ring ────────────────────────────────────────────────
function Ring({ eaten, target }) {
  const r=48,cx=60,cy=60,sw=6,circ=2*Math.PI*r;
  const pct=Math.min(eaten/target,1), over=eaten>target;
  const trackColor=over?"#fdecea":"#f5f5f3";
  const fillColor=over?"#e05a4a":T.accent;
  return <svg width={120} height={120} viewBox="0 0 120 120">
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={sw}/>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={fillColor}
      strokeWidth={sw} strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
      strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
      style={{transition:"stroke-dashoffset 1.2s cubic-bezier(.16,1,.3,1)"}}/>
    <text x={cx} y={cy-6} textAnchor="middle" fill={over?"#e05a4a":T.text} fontSize="19" fontWeight="600" fontFamily="Manrope">{eaten}</text>
    <text x={cx} y={cy+10} textAnchor="middle" fill={T.faint} fontSize="10" fontFamily="Manrope">из {target}</text>
    <text x={cx} y={cy+24} textAnchor="middle" fill={T.faint} fontSize="9" fontFamily="Manrope" letterSpacing=".05em">ККАЛ</text>
  </svg>;
}

function Bar2({ label, value, max, color, bg }) {
  return <div style={{marginBottom:8}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
      <span style={{fontSize:11,color:T.muted,fontWeight:500}}>{label}</span>
      <span style={{fontSize:11,color:T.text,fontWeight:600}}>{value}<span style={{color:T.faint,fontWeight:400}}>г</span></span>
    </div>
    <div style={{height:3,background:bg,borderRadius:2,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${Math.min((value/max)*100,100)}%`,background:color,borderRadius:2,transition:"width 1.2s cubic-bezier(.16,1,.3,1)"}}/>
    </div>
  </div>;
}

// ─── MacroRing ────────────────────────────────────────────────────
function MacroRing({ label, value, max, color }) {
  const r=22,cx=28,cy=28,sw=4,circ=2*Math.PI*r;
  const pct=Math.min(value/(max||1),1), over=value>max;
  return <div style={{textAlign:"center",flex:1}}>
    <svg width={56} height={56} viewBox="0 0 56 56">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.bg} strokeWidth={sw}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={over?"#e05a4a":color}
        strokeWidth={sw} strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
        style={{transition:"stroke-dashoffset 1.2s cubic-bezier(.16,1,.3,1)"}}/>
      <text x={cx} y={cy+1} textAnchor="middle" fill={T.text} fontSize="10" fontWeight="700" fontFamily="Manrope">{value}</text>
      <text x={cx} y={cy+12} textAnchor="middle" fill={T.faint} fontSize="8" fontFamily="Manrope">/{max}</text>
    </svg>
    <div style={{fontSize:10,color:T.muted,marginTop:2,fontWeight:500}}>{label}</div>
  </div>;
}

// ─── HealthBar ────────────────────────────────────────────────────
function HealthBar({ score }) {
  const color = score>=7?T.green:score>=4?"#b07800":"#e05a4a";
  const bg = score>=7?T.greenBg:score>=4?"#fff8e6":"#fdecea";
  return <div style={{marginTop:10}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
      <span style={{fontSize:12,color:T.muted,fontWeight:500}}>💚 Полезность</span>
      <span style={{background:bg,color,fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:50}}>{score}/10</span>
    </div>
    <div style={{height:5,background:T.bg,borderRadius:3,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${score*10}%`,borderRadius:3,background:"linear-gradient(to right,#e05a4a,#e8a44a,#5a8a6a)",transition:"width 1s cubic-bezier(.16,1,.3,1)"}}/>
    </div>
  </div>;
}

// ─── WeekStrip ────────────────────────────────────────────────────
const DAY_NAMES=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
function WeekStrip({ selectedDate, onSelect, history }) {
  const today=new Date();
  const dow=today.getDay();
  const mon=new Date(today); mon.setDate(today.getDate()-(dow===0?6:dow-1));
  const days=Array.from({length:7},(_,i)=>{const d=new Date(mon);d.setDate(mon.getDate()+i);return d;});
  return <div style={{display:"flex",gap:4,marginBottom:16}}>
    {days.map((d,i)=>{
      const key=d.toISOString().slice(0,10);
      const sel=key===selectedDate, isToday=key===todayKey();
      const hasData=(history[key]?.meals||[]).length>0;
      return <div key={key} onClick={()=>onSelect(key)}
        style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"8px 2px",borderRadius:12,background:sel?T.accent:isToday?T.accentBg:"transparent",cursor:"pointer",transition:"all .2s"}}>
        <span style={{fontSize:9,fontWeight:500,color:sel?"#fff":T.faint,letterSpacing:".05em"}}>{DAY_NAMES[i]}</span>
        <span style={{fontSize:14,fontWeight:sel?700:400,color:sel?"#fff":isToday?T.accent:T.text}}>{d.getDate()}</span>
        <div style={{width:4,height:4,borderRadius:"50%",background:hasData?(sel?"rgba(255,255,255,.7)":T.accent):"transparent"}}/>
      </div>;
    })}
  </div>;
}

// ─── Card wrapper ─────────────────────────────────────────────────
function Card({ children, style }) {
  return <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:"18px 14px",marginBottom:12,width:"100%",boxSizing:"border-box",...style}}>{children}</div>;
}
function SectionLabel({ children }) {
  return <div style={{fontSize:10,fontWeight:600,letterSpacing:".14em",color:T.muted,textTransform:"uppercase",marginBottom:14}}>{children}</div>;
}

// ─── Onboarding ───────────────────────────────────────────────────
function Onboarding({ onDone }) {
  const [step,setStep]=useState(0);
  const tgName = window.tgUser ? (window.tgUser.first_name || "") : "";
  const [f,setF]=useState({name:tgName,gender:"female",age:"",weight:"",height:"",activity:"moderate",goal:"maintenance"});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const steps=[
    { title:"Давай познакомимся",
      content:<>
        <Field label="Твоё имя" placeholder="Альбина" value={f.name} onChange={e=>s("name",e.target.value)}/>
        <Drop label="Пол" opts={[{v:"female",l:"Женский"},{v:"male",l:"Мужской"}]} value={f.gender} onChange={v=>s("gender",v)}/>
        <Field label="Возраст" type="number" placeholder="25" value={f.age} onChange={e=>s("age",e.target.value)}/>
      </>, ok:f.name&&f.age },
    { title:"Физические данные",
      content:<>
        <Field label="Вес, кг" type="number" placeholder="60" value={f.weight} onChange={e=>s("weight",e.target.value)}/>
        <Field label="Рост, см" type="number" placeholder="165" value={f.height} onChange={e=>s("height",e.target.value)}/>
      </>, ok:f.weight&&f.height },
    { title:"Уровень активности",
      content:<>
        <div style={{fontSize:13,color:T.muted,marginBottom:16,lineHeight:1.6}}>Выбери то, что ближе всего к твоему обычному дню</div>
        {[
          {v:"sedentary", ico:"🪑", l:"Сидячий", d:"Офис, почти нет физической активности"},
          {v:"light",     ico:"🚶", l:"Лёгкая",  d:"Прогулки, 1–2 тренировки в неделю"},
          {v:"moderate",  ico:"🏃", l:"Умеренная",d:"3–5 тренировок в неделю"},
          {v:"active",    ico:"💪", l:"Высокая",  d:"6–7 тренировок в неделю"},
          {v:"veryActive",ico:"🔥", l:"Очень высокая",d:"Физический труд + спорт"},
        ].map(o=>(
          <div key={o.v} onClick={()=>s("activity",o.v)}
            style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:14,border:`1.5px solid ${f.activity===o.v?T.accent:T.border}`,background:f.activity===o.v?T.accentBg:T.surface,cursor:"pointer",marginBottom:8,transition:"all .2s"}}>
            <span style={{fontSize:24,flexShrink:0}}>{o.ico}</span>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:f.activity===o.v?T.accent:T.text}}>{o.l}</div>
              <div style={{fontSize:11,color:T.muted,marginTop:2}}>{o.d}</div>
            </div>
            {f.activity===o.v&&<div style={{marginLeft:"auto",width:18,height:18,borderRadius:"50%",background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:"#fff",fontSize:11,lineHeight:1}}>✓</span></div>}
          </div>
        ))}
      </>, ok:true },
    { title:"Твоя цель",
      content:<>
        <div style={{fontSize:13,color:T.muted,marginBottom:16,lineHeight:1.6}}>Приложение рассчитает калории под твою цель</div>
        {[
          {v:"loss",        ico:"📉", l:"Похудение",     d:`Дефицит 20% — минус ${Math.round((()=>{const bmr=10*+(f.weight||60)+6.25*+(f.height||165)-5*+(f.age||25)-(f.gender==="female"?161:-5);const mult={sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryActive:1.9};const tdee=Math.round(bmr*(mult[f.activity]||1.2));return tdee*0.2;})())} ккал от нормы`},
          {v:"maintenance", ico:"⚖️", l:"Поддержание",   d:"Питаться по норме расхода энергии"},
          {v:"gain",        ico:"📈", l:"Набор массы",   d:"Профицит 15% — питание для роста мышц"},
        ].map(o=>(
          <div key={o.v} onClick={()=>s("goal",o.v)}
            style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:14,border:`1.5px solid ${f.goal===o.v?T.accent:T.border}`,background:f.goal===o.v?T.accentBg:T.surface,cursor:"pointer",marginBottom:8,transition:"all .2s"}}>
            <span style={{fontSize:24,flexShrink:0}}>{o.ico}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:600,color:f.goal===o.v?T.accent:T.text}}>{o.l}</div>
              <div style={{fontSize:11,color:T.muted,marginTop:2}}>{o.d}</div>
            </div>
            {f.goal===o.v&&<div style={{marginLeft:"auto",width:18,height:18,borderRadius:"50%",background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:"#fff",fontSize:11,lineHeight:1}}>✓</span></div>}
          </div>
        ))}
      </>, ok:true }
  ];
  const cur=steps[step];
  return <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column"}}>
    <style>{CSS}</style>
    <div style={{maxWidth:420,margin:"0 auto",padding:"32px 16px 32px",width:"100%",flex:1,display:"flex",flexDirection:"column"}}>
      {/* Logo */}
      <div style={{marginBottom:52}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:36,fontWeight:300,color:T.text,letterSpacing:"-.01em"}}>
          Albi<span style={{color:T.accent}}>·</span>
        </div>
      </div>
      {/* Step dots */}
      <div style={{display:"flex",gap:6,marginBottom:36}}>
        {steps.map((_,i)=><div key={i} style={{height:3,borderRadius:2,background:i<=step?T.accent:T.border,flex:i===step?3:1,transition:"all .4s cubic-bezier(.16,1,.3,1)"}}/>)}
      </div>
      <div style={{flex:1}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:400,color:T.text,marginBottom:6,lineHeight:1.25}}>{cur.title}</div>
        <div style={{fontSize:13,color:T.muted,marginBottom:28}}>Шаг {step+1} из {steps.length}</div>
        <Card>{cur.content}</Card>
      </div>
      <button onClick={()=>{window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");step<steps.length-1?setStep(s=>s+1):onDone({...f,age:+f.age,weight:+f.weight,height:+f.height})}}
        disabled={!cur.ok}
        style={{width:"100%",background:cur.ok?T.accent:"#e8e4e0",color:cur.ok?"#fff":T.faint,border:"none",padding:"15px",borderRadius:50,fontSize:14,fontWeight:600,cursor:cur.ok?"pointer":"not-allowed",letterSpacing:".02em",transition:"all .3s",marginTop:20}}>
        {step<steps.length-1?"Продолжить →":"Начать"}
      </button>
      {step>0&&<button className="ghost-btn" style={{display:"block",margin:"12px auto 0",border:"none",color:T.muted}} onClick={()=>setStep(s=>s-1)}>← Назад</button>}
    </div>
  </div>;
}

// ─── Today ────────────────────────────────────────────────────────
function Today({ profile, norms, day, setDay, selectedDate, onSelectDate, history }) {
  const [img,setImg]=useState(null);
  const [b64,setB64]=useState(null);
  const [mt,setMt]=useState(null);
  const [portion,setPortion]=useState("standard");
  const [cookMethod,setCookMethod]=useState(null);
  const [manualMode,setManualMode]=useState(false);
  const [textMode,setTextMode]=useState(false);
  const [textInput,setTextInput]=useState("");
  const [manualCals,setManualCals]=useState("");
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState(null);
  const [preview,setPreview]=useState(null);
  const [editIdx,setEditIdx]=useState(null);
  const [editMeal,setEditMeal]=useState(null);
  const fileRef=useRef();

  const cookOpts=[
    {k:"boiled",   ico:"💧", l:"Варёное/тушёное", d:"Без масла, калорий меньше"},
    {k:"oven",     ico:"🌡️", l:"Духовка/гриль",   d:"Минимум масла"},
    {k:"pan",      ico:"🍳", l:"Жарка на сковороде", d:"+30–50 ккал от масла"},
    {k:"deepfry",  ico:"🫕", l:"Фритюр",           d:"+100–200 ккал от масла"},
    {k:"raw",      ico:"🥗", l:"Сырое/салат",      d:"Без термообработки"},
    {k:"unknown",  ico:"🤷", l:"Не знаю",          d:"ИИ попробует угадать"},
  ];

  const portionOpts=[
    {k:"small",l:"Маленькая",s:"~150г"},
    {k:"standard",l:"Стандартная",s:"~250г"},
    {k:"large",l:"Большая",s:"~400г"},
    {k:"xl",l:"Большая",s:"~600г+"},
  ];
  const portionHints={small:"небольшая порция ~150г",standard:"стандартная порция ~250г",large:"большая порция ~400г",xl:"очень большая ~600г+"};

  const meals=day.meals||[];
  const water=day.water||0;
  const eaten=meals.reduce((s,m)=>s+m.total.calories,0);
  const eP=meals.reduce((s,m)=>s+(m.total.protein||0),0);
  const eF=meals.reduce((s,m)=>s+(m.total.fat||0),0);
  const eC=meals.reduce((s,m)=>s+(m.total.carbs||0),0);
  const rem=norms.target-eaten;

  const processFile=useCallback((file)=>{
    if(!file||!file.type.startsWith("image/"))return;
    setErr(null);setPreview(null);
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement("canvas");
        const MAX=1200;
        let w=img.width,h=img.height;
        if(w>MAX){h=Math.round(h*MAX/w);w=MAX;}
        if(h>MAX){w=Math.round(w*MAX/h);h=MAX;}
        canvas.width=w;canvas.height=h;
        canvas.getContext("2d").drawImage(img,0,0,w,h);
        const jpeg=canvas.toDataURL("image/jpeg",0.85);
        setImg(jpeg);setB64(jpeg.split(",")[1]);setMt("image/jpeg");
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  },[]);

  const analyze=async()=>{
    setLoading(true);setErr(null);
    try{
      const res=await analyzeFood(b64,mt,portionHints[portion],cookMethod?cookOpts.find(o=>o.k===cookMethod)?.l:null,manualMode&&manualCals?+manualCals:null);
      setPreview({result:res,img});setImg(null);setCookMethod(null);setManualCals('');setManualMode(false);
    }catch(e){
      // Сетевая ошибка (нет интернета, iOS Safari бросает TypeError "Load failed" / "Type error")
      const msg=e.message||"";
      if(e instanceof TypeError||msg==="Type error"||msg.includes("Load failed")||msg.includes("Failed to fetch")||msg.includes("NetworkError")){
        setErr("Нет соединения с сервером. Проверь интернет и попробуй ещё раз.");
      } else {
        setErr(msg||"Произошла ошибка, попробуй ещё раз");
      }
    }finally{setLoading(false);}
  };
  const addMeal=()=>{
    if(!preview)return;
    setDay(d=>({...d,meals:[...(d.meals||[]),{...preview.result,img:preview.img,time:new Date().toLocaleTimeString("ru",{hour:"2-digit",minute:"2-digit"})}]}));
    setPreview(null);
  };
  const removeMeal=(i)=>setDay(d=>({...d,meals:(d.meals||[]).filter((_,j)=>j!==i)}));
  const openEdit=(i)=>{setEditIdx(i);setEditMeal(JSON.parse(JSON.stringify(meals[i])));};
  const saveEdit=()=>{
    const updated=meals.map((m,i)=>i===editIdx?editMeal:m);
    setDay(d=>({...d,meals:updated}));setEditIdx(null);setEditMeal(null);
  };
  const setED=(di,field,val)=>{
    const dishes=editMeal.dishes.map((d,i)=>{
      if(i!==di) return d;
      if(field==="weight"){
        const newW=parseFloat(val)||0;
        const oldW=parseFloat(d.weight)||0;
        if(oldW>0&&newW>0&&newW!==oldW){
          const r=newW/oldW;
          return {...d,weight:val,
            calories:Math.round(d.calories*r),
            protein:Math.round(d.protein*r*10)/10,
            fat:Math.round(d.fat*r*10)/10,
            carbs:Math.max(0,Math.round(d.carbs*r*10)/10)};
        }
        return {...d,weight:val};
      }
      return {...d,[field]:Math.max(0,+val)};
    });
    const total={
      calories:dishes.reduce((s,d)=>s+(d.calories||0),0),
      protein:dishes.reduce((s,d)=>s+(d.protein||0),0),
      fat:dishes.reduce((s,d)=>s+(d.fat||0),0),
      carbs:Math.max(0,dishes.reduce((s,d)=>s+(d.carbs||0),0))
    };
    setEditMeal(m=>({...m,dishes,total}));
  };

  const fit = eaten>0 && eaten<=norms.target;

  return <div>

    {/* Header */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:300,color:T.text,lineHeight:1.1}}>
          {profile.name}<span style={{color:T.accent}}>·</span>
        </div>
        <div style={{fontSize:12,color:T.muted,marginTop:4}}>{new Date().toLocaleDateString("ru",{weekday:"long",day:"numeric",month:"long"})}</div>
      </div>
      <div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
        <div style={{fontSize:11,color:rem>=0?T.green:"#e05a4a",fontWeight:600}}>
          {rem>=0?`↓ ${rem} ккал осталось`:`↑ ${Math.abs(rem)} перебор`}
        </div>
        <div style={{fontSize:10,color:T.faint}}>норма {norms.target} ккал</div>
      </div>
    </div>

    {/* Ring + macro rings */}
    <Card style={{display:"flex",alignItems:"center",gap:12}}>
      <Ring eaten={eaten} target={norms.target}/>
      <div style={{flex:1}}>
        <Bar2 label="Белки" value={eP} max={Math.round(norms.target*.15/4)} color={T.blue} bg={T.blueBg}/>
        <Bar2 label="Жиры" value={eF} max={Math.round(norms.target*.30/9)} color={T.accent} bg={T.accentBg}/>
        <Bar2 label="Углеводы" value={eC} max={Math.round(norms.target*.55/4)} color={T.green} bg={T.greenBg}/>
      </div>
    </Card>

    {/* Water */}
    <Card>
      <SectionLabel>Вода</SectionLabel>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <button onClick={()=>setDay(d=>({...d,water:Math.max((d.water||0)-1,0)}))}
          style={{width:34,height:34,borderRadius:"50%",border:`1.5px solid ${T.border}`,background:T.surface,color:T.muted,fontSize:18,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
        <div style={{flex:1,display:"flex",gap:5,flexWrap:"wrap"}}>
          {Array.from({length:8}).map((_,i)=>(
            <div key={i} onClick={()=>setDay(d=>({...d,water:i+1}))} style={{width:28,height:28,borderRadius:6,background:i<water?T.blueBg:T.bg,border:`1.5px solid ${i<water?T.blue:T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,cursor:"pointer",transition:"all .2s"}}>
              {i<water?"💧":""}
            </div>
          ))}
        </div>
        <button onClick={()=>setDay(d=>({...d,water:Math.min((d.water||0)+1,12)}))}
          style={{width:34,height:34,borderRadius:"50%",border:`1.5px solid ${T.border}`,background:T.accent,color:"#fff",fontSize:18,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:300}}>+</button>
      </div>
      <div style={{fontSize:11,color:T.muted}}>{water} из 8 стаканов · {water*250} мл</div>
    </Card>

    {/* Meals */}
    {meals.length>0&&<Card>
      <SectionLabel>Приёмы пищи</SectionLabel>
      {meals.map((m,i)=>(
        <div key={i} className="row-item">
          <img src={m.img} alt="" style={{width:44,height:44,borderRadius:10,objectFit:"cover",flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:500,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.dishes.map(d=>d.name).join(", ")}</div>
            <div style={{fontSize:11,color:T.muted,marginTop:2}}>{m.time} · Б{m.total.protein} Ж{m.total.fat} У{m.total.carbs}</div>
          </div>
          <span style={{fontSize:14,fontWeight:600,color:T.accent,marginRight:6}}>{m.total.calories}</span>
          <button onClick={()=>openEdit(i)} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:14,padding:"2px 4px"}}>✏️</button>
          <button onClick={()=>removeMeal(i)} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:16,padding:"2px 4px"}}>×</button>
        </div>
      ))}
    </Card>}

    {/* Edit modal */}
    {editMeal&&<div style={{position:"fixed",inset:0,background:"rgba(26,25,22,.4)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(4px)"}}>
      <div style={{background:T.surface,borderRadius:"22px 22px 0 0",width:"100%",maxWidth:460,padding:24,maxHeight:"82vh",overflowY:"auto",border:`1px solid ${T.border}`}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:400,marginBottom:18}}>Редактировать</div>
        {editMeal.dishes.map((d,di)=>(
          <div key={di} style={{background:T.bg,borderRadius:14,padding:"14px 12px",marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:600,color:T.accent,marginBottom:12,letterSpacing:".04em"}}>{d.name.toUpperCase()}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[["Вес","weight",d.weight,"text"],["Калории","calories",d.calories,"number"],["Белки, г","protein",d.protein,"number"],["Жиры, г","fat",d.fat,"number"],].map(([l,k,v,t])=>(
                <Field key={k} label={l} type={t} value={v} onChange={e=>setED(di,k,e.target.value)}/>
              ))}
              <div style={{gridColumn:"span 2"}}><Field label="Углеводы, г" type="number" value={d.carbs} onChange={e=>setED(di,"carbs",e.target.value)}/></div>
            </div>
          </div>
        ))}
        <div style={{padding:"10px 14px",background:T.accentBg,borderRadius:10,fontSize:13,color:T.accent,fontWeight:500,marginBottom:14}}>
          Итого: {editMeal.total.calories} ккал · Б{editMeal.total.protein} Ж{editMeal.total.fat} У{editMeal.total.carbs}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <button onClick={saveEdit} style={{background:T.accent,color:"#fff",border:"none",padding:"13px",borderRadius:50,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Manrope"}}>Сохранить</button>
          <button className="ghost-btn" style={{width:"100%"}} onClick={()=>{setEditIdx(null);setEditMeal(null);}}>Отмена</button>
        </div>
      </div>
    </div>}

    {/* Add food */}
    <Card>
      <SectionLabel>Добавить еду</SectionLabel>
      {!img&&!preview&&!manualMode&&!textMode&&<div>
        <div className="zone" onClick={()=>fileRef.current.click()}>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>processFile(e.target.files[0])}/>
          <div style={{fontSize:32,marginBottom:10}}>📸</div>
          <div style={{fontSize:14,color:T.muted,fontWeight:500}}>Фото или галерея</div>
          <div style={{fontSize:11,color:T.faint,marginTop:4}}>Нажми чтобы выбрать</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
          <button onClick={()=>setTextMode(true)} style={{background:T.bg,border:`1.5px solid ${T.border}`,borderRadius:14,padding:"12px 10px",cursor:"pointer",fontFamily:"Manrope",display:"flex",alignItems:"center",gap:8,transition:"border-color .2s"}}>
            <span style={{fontSize:20}}>💬</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:12,fontWeight:500,color:T.text}}>Описать текстом</div>
              <div style={{fontSize:10,color:T.muted}}>ИИ посчитает сам</div>
            </div>
          </button>
          <button onClick={()=>setManualMode(true)} style={{background:T.bg,border:`1.5px solid ${T.border}`,borderRadius:14,padding:"12px 10px",cursor:"pointer",fontFamily:"Manrope",display:"flex",alignItems:"center",gap:8,transition:"border-color .2s"}}>
            <span style={{fontSize:20}}>✏️</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:12,fontWeight:500,color:T.text}}>Ввести вручную</div>
              <div style={{fontSize:10,color:T.muted}}>Знаешь калории?</div>
            </div>
          </button>
        </div>
      </div>}
      {/* Text mode */}
      {textMode&&!preview&&<div className="up">
        <div style={{background:T.blueBg,border:`1.5px solid ${T.blue}`,borderRadius:14,padding:16}}>
          <div style={{fontSize:13,fontWeight:600,color:T.blue,marginBottom:10}}>💬 Опиши блюдо</div>
          <textarea value={textInput} onChange={e=>setTextInput(e.target.value)}
            placeholder="Например: тарелка борща со сметаной и кусок чёрного хлеба"
            style={{width:"100%",background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:10,padding:"11px 14px",fontSize:13,color:T.text,fontFamily:"Manrope",resize:"none",minHeight:80,boxSizing:"border-box"}}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
            <button onClick={async()=>{if(!textInput.trim())return;setLoading(true);setErr(null);try{const res=await analyzeText(textInput);setPreview({result:res,img:null});setTextInput("");}catch(e){const m=e.message||"";setErr(e instanceof TypeError||m.includes("Load failed")||m.includes("Failed to fetch")?"Нет соединения с сервером. Проверь интернет.":m||"Ошибка, попробуй ещё раз");}finally{setLoading(false);}}}
              disabled={!textInput.trim()||loading}
              style={{background:loading?T.faint:T.blue,color:"#fff",border:"none",padding:"12px",borderRadius:50,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"Manrope"}}>
              {loading?<><span className="spin">○</span>Считаю…</>:"Посчитать →"}
            </button>
            <button className="ghost-btn" style={{width:"100%"}} onClick={()=>{setTextMode(false);setTextInput("");}}>Отмена</button>
          </div>
        </div>
      </div>}
      {!img&&!preview&&manualMode&&<div className="up" style={{marginTop:8}}>
          <div style={{background:T.accentBg,border:`1.5px solid ${T.accent}`,borderRadius:14,padding:16}}>
            <div style={{fontSize:13,fontWeight:600,color:T.accent,marginBottom:12}}>✏️ Ручной ввод</div>
            <Field label="Название блюда" placeholder="Например: Греческий салат" value={editMeal?.name||""} onChange={e=>setEditMeal(m=>({...m,name:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Field label="Калории" type="number" placeholder="450" value={manualCals} onChange={e=>setManualCals(e.target.value)}/>
              <Field label="Белки, г" type="number" placeholder="20" value={editMeal?.protein||""} onChange={e=>setEditMeal(m=>({...m,protein:+e.target.value}))}/>
              <Field label="Жиры, г" type="number" placeholder="15" value={editMeal?.fat||""} onChange={e=>setEditMeal(m=>({...m,fat:+e.target.value}))}/>
              <Field label="Углеводы, г" type="number" placeholder="40" value={editMeal?.carbs||""} onChange={e=>setEditMeal(m=>({...m,carbs:+e.target.value}))}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:4}}>
              <button onClick={()=>{
                if(!manualCals)return;
                const name=editMeal?.name||"Блюдо";
                const cal=+manualCals;
                const p=editMeal?.protein||0, f=editMeal?.fat||0, c=editMeal?.carbs||0;
                setDay(d=>({...d,meals:[...(d.meals||[]),{dishes:[{name,weight:"—",calories:cal,protein:p,fat:f,carbs:c}],total:{calories:cal,protein:p,fat:f,carbs:c},img:null,time:new Date().toLocaleTimeString("ru",{hour:"2-digit",minute:"2-digit"})}]}));
                setManualMode(false);setManualCals("");setEditMeal(null);
              }} style={{background:T.accent,color:"#fff",border:"none",padding:"12px",borderRadius:50,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Manrope"}}>+ В дневник</button>
              <button className="ghost-btn" style={{width:"100%"}} onClick={()=>{setManualMode(false);setManualCals("");setEditMeal(null);}}>Отмена</button>
            </div>
          </div>
        </div>}
      {img&&!preview&&<div className="up">
        <div style={{position:"relative",borderRadius:14,overflow:"hidden",marginBottom:14}}>
          <img src={img} style={{width:"100%",maxHeight:220,objectFit:"cover",display:"block"}}/>
          <button onClick={()=>{setImg(null);setB64(null);}} style={{position:"absolute",top:10,right:10,background:"rgba(255,255,255,.9)",border:"none",borderRadius:20,padding:"5px 12px",cursor:"pointer",fontSize:12,color:T.text,fontWeight:500}}>✕ Убрать</button>
        </div>
        <SectionLabel>Размер порции</SectionLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          {portionOpts.map(o=>(
            <button key={o.k} className={`portion-opt${portion===o.k?" on":""}`} onClick={()=>setPortion(o.k)}>
              <div style={{fontWeight:600}}>{o.l}</div>
              <div style={{fontSize:11,opacity:.7,marginTop:2}}>{o.s}</div>
            </button>
          ))}
        </div>
        <div style={{fontSize:11,color:T.faint,marginBottom:14,lineHeight:1.6,padding:"10px 12px",background:T.bg,borderRadius:10}}>
          💡 Размер помогает ИИ оценить граммовку — по фото масштаб тарелки не виден
        </div>

        <SectionLabel>Способ приготовления</SectionLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          {cookOpts.map(o=>(
            <button key={o.k} className={`portion-opt${cookMethod===o.k?" on":""}`} onClick={()=>setCookMethod(cookMethod===o.k?null:o.k)}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:16}}>{o.ico}</span>
                <span style={{fontWeight:600,fontSize:12}}>{o.l}</span>
              </div>
              <div style={{fontSize:10,opacity:.65,marginTop:3}}>{o.d}</div>
            </button>
          ))}
        </div>

        <div style={{marginBottom:14}}>
          <div onClick={()=>setManualMode(m=>!m)} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"10px 12px",borderRadius:10,background:manualMode?T.accentBg:T.bg,border:`1.5px solid ${manualMode?T.accent:T.border}`,transition:"all .2s"}}>
            <span style={{fontSize:16}}>{manualMode?"✓":"📋"}</span>
            <div>
              <div style={{fontSize:13,fontWeight:500,color:manualMode?T.accent:T.text}}>Я знаю калорийность</div>
              <div style={{fontSize:11,color:T.muted}}>Видишь в меню или на упаковке?</div>
            </div>
          </div>
          {manualMode&&<div style={{marginTop:8,display:"flex",gap:8,alignItems:"center"}}>
            <input style={{flex:1,background:T.surface,border:`1.5px solid ${T.accent}`,borderRadius:10,padding:"10px 14px",color:T.text,fontSize:14}} type="number" placeholder="Ккал (например 450)" value={manualCals} onChange={e=>setManualCals(e.target.value)}/>
            <span style={{fontSize:12,color:T.muted,flexShrink:0}}>ккал</span>
          </div>}
        </div>

        <button onClick={analyze} disabled={loading} style={{width:"100%",background:loading?T.faint:T.accent,color:"#fff",border:"none",padding:"14px",borderRadius:50,fontSize:14,fontWeight:600,cursor:loading?"not-allowed":"pointer",transition:"background .3s",fontFamily:"Manrope"}}>
          {loading?<><span className="spin">○</span>Анализирую…</>:"Посчитать калории"}
        </button>
      </div>}
      {err&&<div style={{marginTop:12,padding:12,background:"#fdf2f2",border:"1px solid #f5d0cc",borderRadius:10,color:"#c04040",fontSize:12,lineHeight:1.6,wordBreak:"break-all"}}>{err}</div>}
      {preview&&<div className="up">
        <div style={{display:"flex",gap:14,marginBottom:14,padding:"14px",background:T.accentBg,borderRadius:14}}>
          <img src={preview.img} style={{width:72,height:72,borderRadius:10,objectFit:"cover",flexShrink:0}}/>
          <div>
            <div style={{fontSize:10,fontWeight:600,letterSpacing:".12em",color:T.muted,marginBottom:4}}>ИТОГО КАЛОРИЙ</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:44,fontWeight:300,color:T.accent,lineHeight:1}}>{preview.result.total.calories}</div>
            <div style={{fontSize:11,color:T.muted,marginTop:4}}>Б{preview.result.total.protein} · Ж{preview.result.total.fat} · У{preview.result.total.carbs}</div>
          </div>
        </div>
        {preview.result.dishes.map((d,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${T.border}`,fontSize:13}}>
            <span style={{color:T.muted}}>{d.name} <span style={{fontSize:11,color:T.faint}}>≈{d.weight}</span></span>
            <span style={{fontWeight:600,color:T.text}}>{d.calories}</span>
          </div>
        ))}
        {preview.result.health_score&&<HealthBar score={preview.result.health_score}/>}
        {preview.result.recommendation&&<div style={{fontSize:12,lineHeight:1.6,margin:"10px 0",padding:"10px 12px",background:T.greenBg,border:`1px solid #b8d4c0`,borderRadius:10}}>
          <span style={{fontWeight:600,color:T.green}}>🤖 Совет ИИ: </span>
          <span style={{color:T.green}}>{preview.result.recommendation}</span>
        </div>}
        {preview.result.assumptions&&<div style={{fontSize:12,lineHeight:1.6,margin:"8px 0",padding:"10px 12px",background:T.blueBg,border:`1px solid #c0d4e8`,borderRadius:10}}>
          <span style={{fontWeight:600,color:T.blue}}>💭 Допущения: </span>
          <span style={{color:T.blue}}>{preview.result.assumptions}</span>
        </div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:14}}>
          <button onClick={addMeal} style={{background:T.accent,color:"#fff",border:"none",padding:"13px",borderRadius:50,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Manrope"}}>+ В дневник</button>
          <button className="ghost-btn" style={{width:"100%"}} onClick={()=>{setPreview(null);setTextMode(false);}}>Отмена</button>
        </div>
      </div>}
    </Card>
  </div>;
}

// ─── History ───────────────────────────────────────────────────────
const MONTHS_RU=["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const WDAYS=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

function MonthCalendar({ history, norms }) {
  const now=new Date();
  const [year,setYear]=useState(now.getFullYear());
  const [month,setMonth]=useState(now.getMonth());
  const [selectedDay,setSelectedDay]=useState(null);

  const firstDay=new Date(year,month,1);
  const lastDay=new Date(year,month+1,0);
  const startDow=(firstDay.getDay()+6)%7; // 0=Mon
  const totalDays=lastDay.getDate();

  const cells=[];
  for(let i=0;i<startDow;i++) cells.push(null);
  for(let d=1;d<=totalDays;d++) cells.push(d);

  const getKey=(d)=>`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const getCal=(d)=>{
    const day=history[getKey(d)];
    return day?(day.meals||[]).reduce((s,m)=>s+m.total.calories,0):0;
  };
  const todayD=now.getDate(), todayM=now.getMonth(), todayY=now.getFullYear();
  const isToday=(d)=>d===todayD&&month===todayM&&year===todayY;

  const selData=selectedDay?history[getKey(selectedDay)]:null;
  const selMeals=selData?.meals||[];
  const selCal=selMeals.reduce((s,m)=>s+m.total.calories,0);

  return <Card>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
      <button onClick={()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);setSelectedDay(null);}}
        style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:T.muted,padding:"4px 8px"}}>‹</button>
      <div style={{fontSize:14,fontWeight:600,color:T.text}}>{MONTHS_RU[month]} {year}</div>
      <button onClick={()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);setSelectedDay(null);}}
        disabled={year===todayY&&month===todayM}
        style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:year===todayY&&month===todayM?T.faint:T.muted,padding:"4px 8px"}}>›</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:8}}>
      {WDAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:9,fontWeight:600,color:T.faint,letterSpacing:".06em",padding:"4px 0"}}>{d}</div>)}
      {cells.map((d,i)=>{
        if(!d) return <div key={`e${i}`}/>;
        const cal=getCal(d);
        const hasMeals=cal>0;
        const over=cal>norms.target;
        const sel=selectedDay===d;
        return <div key={d} onClick={()=>setSelectedDay(sel?null:d)}
          style={{textAlign:"center",padding:"6px 2px",borderRadius:10,cursor:"pointer",background:sel?T.accent:isToday(d)?T.accentBg:"transparent",transition:"all .2s"}}>
          <div style={{fontSize:12,fontWeight:isToday(d)||sel?700:400,color:sel?"#fff":isToday(d)?T.accent:T.text}}>{d}</div>
          <div style={{width:4,height:4,borderRadius:"50%",margin:"2px auto 0",background:hasMeals?(sel?"rgba(255,255,255,.8)":over?"#e05a4a":T.green):"transparent"}}/>
        </div>;
      })}
    </div>
    {selectedDay&&<div style={{borderTop:`1px solid ${T.border}`,paddingTop:12,marginTop:4}}>
      {selMeals.length===0
        ?<div style={{textAlign:"center",padding:"12px 0",color:T.faint,fontSize:12}}>Нет записей за этот день</div>
        :<>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
            <span style={{fontSize:12,fontWeight:600,color:T.text}}>{String(selectedDay).padStart(2,"0")}.{String(month+1).padStart(2,"0")}</span>
            <span style={{fontSize:12,fontWeight:700,color:selCal>norms.target?"#e05a4a":T.accent}}>{selCal} ккал</span>
          </div>
          {selMeals.map((m,mi)=>(
            <div key={mi} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`1px solid ${T.border}`}}>
              {m.img?<img src={m.img} style={{width:36,height:36,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
                :<div style={{width:36,height:36,borderRadius:8,background:T.accentBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🍽</div>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:500,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.dishes.map(d=>d.name).join(", ")}</div>
                <div style={{fontSize:10,color:T.muted,marginTop:2}}>{m.time} · Б{m.total.protein} Ж{m.total.fat} У{m.total.carbs}</div>
              </div>
              <span style={{fontSize:12,fontWeight:600,color:T.accent,flexShrink:0}}>{m.total.calories}</span>
            </div>
          ))}
        </>}
    </div>}
  </Card>;
}

function History({ history, norms }) {
  const [histExpanded,setHistExpanded]=useState({});
  const sorted=Object.entries(history).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,30);
  const chart=sorted.slice(0,14).reverse().map(([date,d])=>({
    date:fmtDate(date),
    ккал:(d.meals||[]).reduce((s,m)=>s+m.total.calories,0),
  }));
  if(!sorted.length) return <div style={{textAlign:"center",padding:"60px 20px"}}>
    <div style={{fontSize:40,marginBottom:16}}>📊</div>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:T.muted,fontWeight:300}}>Данных пока нет</div>
    <div style={{fontSize:13,color:T.faint,marginTop:8}}>Начни отслеживать питание!</div>
  </div>;
  const CustomTooltip=({active,payload,label})=>active&&payload?.length?<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"8px 14px",fontSize:12,color:T.text,fontWeight:600}}>{label}: {payload[0].value} ккал</div>:null;
  return <div>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:300,color:T.text,marginBottom:24}}>История</div>
    <MonthCalendar history={history} norms={norms}/>
    <Card>
      <SectionLabel>Калории за 14 дней</SectionLabel>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chart} margin={{top:4,right:0,left:-24,bottom:0}}>
          <XAxis dataKey="date" tick={{fontSize:10,fill:T.faint}} axisLine={false} tickLine={false}/>
          <YAxis tick={{fontSize:10,fill:T.faint}} axisLine={false} tickLine={false}/>
          <Tooltip content={<CustomTooltip/>}/>
          <ReferenceLine y={norms.target} stroke={T.accent} strokeDasharray="3 3" strokeOpacity={.5}/>
          <Bar dataKey="ккал" fill={T.accent} opacity={.75} radius={[4,4,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
      <div style={{fontSize:10,color:T.faint,marginTop:6}}>— пунктир: норма {norms.target} ккал</div>
    </Card>
    <Card>
      <SectionLabel>По дням</SectionLabel>
      {sorted.map(([date,d])=>{
        const cal=(d.meals||[]).reduce((s,m)=>s+m.total.calories,0);
        const eP=(d.meals||[]).reduce((s,m)=>s+(m.total.protein||0),0);
        const eF=(d.meals||[]).reduce((s,m)=>s+(m.total.fat||0),0);
        const eC=(d.meals||[]).reduce((s,m)=>s+(m.total.carbs||0),0);
        const over=cal>norms.target;
        const isToday=date===todayKey();
        const open=histExpanded[date]||false;
        return <div key={date} style={{padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
          <div onClick={()=>setHistExpanded(h=>({...h,[date]:!open}))} style={{cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:13,fontWeight:isToday?600:400,color:T.text}}>{isToday?"Сегодня":fmtDate(date)}</span>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <span style={{fontSize:11,color:T.faint}}>💧{d.water||0}</span>
                <span style={{fontWeight:700,color:over?"#e05a4a":T.accent,fontSize:14}}>{cal} ккал</span>
                <span style={{fontSize:11,color:T.faint}}>{open?"▲":"▼"}</span>
              </div>
            </div>
            <div style={{display:"flex",gap:12,marginBottom:6}}>
              {[["Б",eP,T.blue],["Ж",eF,T.accent],["У",eC,T.green]].map(([l,v,c])=>(
                <span key={l} style={{fontSize:11,color:T.muted}}>
                  <span style={{color:c,fontWeight:600}}>{l}</span> {v}г
                </span>
              ))}
            </div>
            <div style={{height:2,background:T.bg,borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${Math.min(cal/norms.target*100,100)}%`,background:over?"#e05a4a":T.accent,borderRadius:2}}/>
            </div>
          </div>
          {open&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
            {(d.meals||[]).length===0&&<div style={{fontSize:12,color:T.faint,textAlign:"center",padding:"6px 0"}}>Нет записей</div>}
            {(d.meals||[]).map((m,mi)=>(
              <div key={mi} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0"}}>
                {m.img?<img src={m.img} style={{width:38,height:38,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
                  :<div style={{width:38,height:38,borderRadius:8,background:T.accentBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🍽</div>}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.dishes.map(dish=>dish.name).join(", ")}</div>
                  <div style={{fontSize:10,color:T.muted,marginTop:2}}>{m.time} · Б{m.total.protein} Ж{m.total.fat} У{m.total.carbs}</div>
                </div>
                <span style={{fontSize:13,fontWeight:600,color:T.accent,flexShrink:0}}>{m.total.calories}</span>
              </div>
            ))}
          </div>}
        </div>;
      })}
    </Card>
  </div>;
}

// ─── Weight ────────────────────────────────────────────────────────
function Weight({ weights, setWeights }) {
  const [nw,setNw]=useState("");
  const add=()=>{if(!nw||isNaN(+nw))return;setWeights(w=>[...w.filter(e=>e.date!==todayKey()),{date:todayKey(),weight:+nw}].sort((a,b)=>a.date.localeCompare(b.date)));setNw("");};
  const chart=weights.slice(-30).map(e=>({date:fmtDate(e.date),вес:e.weight}));
  const lat=weights[weights.length-1], prev=weights[weights.length-2];
  const diff=lat&&prev?+(lat.weight-prev.weight).toFixed(1):null;
  const CustomDot=({cx,cy})=><circle cx={cx} cy={cy} r={3} fill={T.accent} stroke={T.surface} strokeWidth={2}/>;
  const CustomTooltip=({active,payload})=>active&&payload?.length?<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:600,color:T.text}}>{payload[0].value} кг</div>:null;
  return <div>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:300,color:T.text,marginBottom:24}}>Вес</div>
    {lat&&<Card style={{textAlign:"center",background:`linear-gradient(135deg,${T.accentBg},${T.surface})`,border:`1px solid ${T.border}`}}>
      <div style={{fontSize:10,fontWeight:600,letterSpacing:".14em",color:T.muted,marginBottom:8}}>ТЕКУЩИЙ ВЕС</div>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:58,fontWeight:300,color:T.accent,lineHeight:1}}>{lat.weight}</div>
      <div style={{fontSize:12,color:T.muted,marginTop:4}}>кг</div>
      {diff!==null&&<div style={{fontSize:13,marginTop:10,color:diff<0?T.green:diff>0?"#e05a4a":T.muted,fontWeight:500}}>
        {diff<0?`▼ ${Math.abs(diff)} кг`:diff>0?`▲ ${diff} кг`:"— без изменений"} с прошлого раза
      </div>}
    </Card>}
    <Card>
      <SectionLabel>Добавить взвешивание</SectionLabel>
      <div style={{display:"flex",gap:10}}>
        <input style={{...{flex:1,background:T.bg,border:`1.5px solid ${T.border}`,borderRadius:10,padding:"11px 14px",color:T.text,fontSize:14},}} type="number" placeholder="Введи вес в кг" value={nw} onChange={e=>setNw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}/>
        <button onClick={add} style={{background:T.accent,color:"#fff",border:"none",padding:"11px 20px",borderRadius:50,fontSize:14,fontWeight:600,cursor:"pointer",flexShrink:0,fontFamily:"Manrope"}}>+</button>
      </div>
    </Card>
    {weights.length>1&&<Card>
      <SectionLabel>Динамика</SectionLabel>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chart} margin={{top:4,right:4,left:-24,bottom:0}}>
          <XAxis dataKey="date" tick={{fontSize:10,fill:T.faint}} axisLine={false} tickLine={false}/>
          <YAxis tick={{fontSize:10,fill:T.faint}} axisLine={false} tickLine={false} domain={["auto","auto"]}/>
          <Tooltip content={<CustomTooltip/>}/>
          <Line type="monotone" dataKey="вес" stroke={T.accent} strokeWidth={2} dot={<CustomDot/>} activeDot={{r:5,fill:T.accent}}/>
        </LineChart>
      </ResponsiveContainer>
    </Card>}
    {weights.length>0&&<Card>
      <SectionLabel>Журнал</SectionLabel>
      {[...weights].reverse().slice(0,20).map(e=>(
        <div key={e.date} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
          <span style={{fontSize:13,color:T.muted}}>{e.date===todayKey()?"Сегодня":fmtDate(e.date)}</span>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontWeight:600,color:T.text}}>{e.weight} кг</span>
            <button onClick={()=>setWeights(w=>w.filter(x=>x.date!==e.date))} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:16}}>×</button>
          </div>
        </div>
      ))}
    </Card>}
  </div>;
}

// ─── Reminders ─────────────────────────────────────────────────────
function Reminders({ reminders, setReminders }) {
  const [perm,setPerm]=useState(Notification.permission);
  const groups=[
    {label:"Утро",times:["07:00","07:30","08:00","09:00"]},
    {label:"День",times:["12:00","12:30","13:00","14:00"]},
    {label:"Вечер",times:["17:00","18:00","19:00","20:00","21:00"]},
  ];
  const mealNames={"07:00":"Завтрак","07:30":"Завтрак","08:00":"Завтрак","09:00":"Поздний завтрак","12:00":"Обед","12:30":"Обед","13:00":"Обед","14:00":"Обед","17:00":"Перекус","18:00":"Перекус","19:00":"Ужин","20:00":"Ужин","21:00":"Поздний ужин"};
  const toggle=(t)=>setReminders(rs=>rs.includes(t)?rs.filter(x=>x!==t):[...rs,t].sort());
  useEffect(()=>{
    if(!reminders.length||Notification.permission!=="granted")return;
    const iv=setInterval(()=>{
      const n=new Date(),hm=`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
      if(reminders.includes(hm)) new Notification("alba·",{body:"Время записать приём пищи 🍽️"});
    },60000);
    return()=>clearInterval(iv);
  },[reminders]);
  return <div>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:300,color:T.text,marginBottom:24}}>Напоминания</div>
    {perm!=="granted"&&<Card style={{background:T.accentBg,border:`1px solid ${T.border}`}}>
      <div style={{fontSize:14,color:T.text,marginBottom:14,lineHeight:1.7}}>Разреши уведомления, чтобы получать напоминания о приёмах пищи.</div>
      <button onClick={async()=>{const r=await Notification.requestPermission();setPerm(r);}} style={{width:"100%",background:T.accent,color:"#fff",border:"none",padding:"13px",borderRadius:50,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Manrope"}}>🔔 Разрешить</button>
    </Card>}
    {perm==="granted"&&<Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:13,color:T.green,fontWeight:500}}>✓ Уведомления включены</span>
        <button className="ghost-btn" style={{padding:"6px 14px",fontSize:12}} onClick={()=>new Notification("alba·",{body:"Тестовое уведомление 🍽️"})}>Тест</button>
      </div>
    </Card>}
    {groups.map(g=>(
      <Card key={g.label}>
        <SectionLabel>{g.label}</SectionLabel>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {g.times.map(t=>(
            <button key={t} className={`btn-pill${reminders.includes(t)?" on":""}`} onClick={()=>toggle(t)}>
              {t} <span style={{fontSize:10,opacity:.6}}>· {mealNames[t]}</span>
            </button>
          ))}
        </div>
      </Card>
    ))}
    {reminders.length>0&&<div style={{padding:"12px 16px",background:T.bg,borderRadius:12,fontSize:12,color:T.muted,lineHeight:1.6}}>
      Выбрано: {reminders.join(", ")}. Страница должна быть открыта.
    </div>}
  </div>;
}

// ─── Profile ────────────────────────────────────────────────────────
function Profile({ profile, norms, onSave, onReset, access, tgId }) {
  const [f,setF]=useState({...profile});
  const [copied,setCopied]=useState(false);
  const [refInfo,setRefInfo]=useState(false);
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const n=calcTDEE({...f,age:+f.age,weight:+f.weight,height:+f.height});

  const refLink = tgId ? `https://t.me/AlbiScan_bot?start=ref_${tgId}` : null;
  const copyRef = () => {
    if(!refLink) return;
    navigator.clipboard.writeText(refLink).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{});
  };
  const [payLoading,setPayLoading]=useState(false);
  const [showPlans,setShowPlans]=useState(false);
  const [selPlan,setSelPlan]=useState("quarterly");
  const profilePlans=[
    {id:"monthly",  label:"1 месяц",  price:"249 ₽", sub:"249 ₽/мес", badge:null},
    {id:"quarterly",label:"3 месяца", price:"599 ₽", sub:"200 ₽/мес", badge:"−20%"},
    {id:"yearly",   label:"1 год",    price:"1990 ₽",sub:"166 ₽/мес", badge:"−33%"},
  ];
  const openPayment = async (plan) => {
    if(!tgId){ window.open("https://t.me/AlbiScan_bot","_blank"); return; }
    setPayLoading(true);
    try{
      const r=await fetch("/api/payment/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegram_id:tgId,plan})});
      const d=await r.json();
      if(d.url){
        if(window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(d.url);
        else window.open(d.url,"_blank");
      }
    }catch{}
    setPayLoading(false);
  };

  const now = new Date();
  const plan = access?.plan;
  const trialDays = access?.trialEndsAt ? Math.max(0, Math.ceil((new Date(access.trialEndsAt)-now)/86400000)) : null;

  return <div>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:300,color:T.text,marginBottom:24}}>Профиль</div>

    {/* Subscription card */}
    <Card style={{marginBottom:0}}>
      <SectionLabel>Подписка</SectionLabel>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          {plan==="trial"&&<>
            <div style={{fontSize:15,fontWeight:700,color:T.accent}}>Пробный период</div>
            <div style={{fontSize:12,color:T.muted,marginTop:2}}>{trialDays!==null?`Осталось ${trialDays} дн.`:"Скоро истекает"}</div>
          </>}
          {plan==="pro"&&<>
            <div style={{fontSize:15,fontWeight:700,color:T.green}}>✓ Pro подписка</div>
            <div style={{fontSize:12,color:T.muted,marginTop:2}}>{access?.subEndsAt?`До ${new Date(access.subEndsAt).toLocaleDateString("ru",{day:"numeric",month:"long"})}`:""}</div>
          </>}
          {(!plan||plan==="expired"||plan==="unknown")&&<>
            <div style={{fontSize:15,fontWeight:700,color:T.red}}>Нет активного доступа</div>
            <div style={{fontSize:12,color:T.muted,marginTop:2}}>Оформи подписку для продолжения</div>
          </>}
        </div>
        <button onClick={()=>setShowPlans(v=>!v)} style={{background:T.accent,color:"#fff",border:"none",padding:"8px 18px",borderRadius:50,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"Manrope",flexShrink:0}}>
          {plan==="pro"?"Продлить":"Оформить"}
        </button>
      </div>

      {/* Plan selector */}
      {showPlans&&<div style={{marginTop:12}}>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
          {profilePlans.map(p=>(
            <div key={p.id} onClick={()=>setSelPlan(p.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",borderRadius:12,border:`2px solid ${selPlan===p.id?T.accent:T.border}`,background:selPlan===p.id?T.accentBg:T.bg,cursor:"pointer",transition:"all .2s"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${selPlan===p.id?T.accent:T.borderMd}`,background:selPlan===p.id?T.accent:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {selPlan===p.id&&<div style={{width:6,height:6,borderRadius:"50%",background:"#fff"}}/>}
                </div>
                <div>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>{p.label}</span>
                  <span style={{fontSize:11,color:T.muted,marginLeft:6}}>{p.sub}</span>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {p.badge&&<span style={{background:T.greenBg,color:T.green,fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:50}}>{p.badge}</span>}
                <span style={{fontSize:14,fontWeight:700,color:selPlan===p.id?T.accent:T.text}}>{p.price}</span>
              </div>
            </div>
          ))}
        </div>
        <button onClick={()=>{openPayment(selPlan);setShowPlans(false);}} disabled={payLoading}
          style={{width:"100%",background:T.accent,color:"#fff",border:"none",padding:"12px",borderRadius:50,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Manrope",opacity:payLoading?.7:1}}>
          {payLoading?"Создаём платёж…":"Перейти к оплате →"}
        </button>
      </div>}

      {/* Referral */}
      {refLink&&<>
        <div style={{height:1,background:T.border,marginBottom:14}}/>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
          <div style={{fontSize:10,fontWeight:600,letterSpacing:".12em",color:T.muted,textTransform:"uppercase"}}>Пригласи друга</div>
          <button onClick={()=>setRefInfo(v=>!v)} style={{width:16,height:16,borderRadius:"50%",border:`1.5px solid ${T.faint}`,background:"transparent",color:T.faint,fontSize:10,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,lineHeight:1,padding:0}}>?</button>
        </div>

        {refInfo&&<div style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 14px",marginBottom:12,fontSize:12,color:T.text,lineHeight:1.7}}>
          <div style={{fontWeight:600,marginBottom:6,color:T.accent}}>Условия реферальной программы</div>
          <div style={{marginBottom:4}}>👤 Друг получает <b>скидку 10%</b> на первую подписку</div>
          <div style={{marginBottom:2,color:T.muted,fontWeight:600,fontSize:11,letterSpacing:".06em",marginTop:8}}>ТЫ ПОЛУЧАЕШЬ:</div>
          <div>• Друг купил 1 месяц → <b>+7 дней</b></div>
          <div>• Друг купил 3 месяца → <b>+14 дней</b></div>
          <div>• Друг купил 1 год → <b>+1 месяц</b></div>
          <div style={{marginTop:8,fontSize:11,color:T.faint}}>Бонус начисляется после оплаты друга</div>
        </div>}

        <div style={{fontSize:12,color:T.muted,marginBottom:10,lineHeight:1.6}}>
          Поделись ссылкой — друг получит скидку, а ты бонусные дни 🎁
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{flex:1,background:T.bg,border:`1.5px solid ${T.border}`,borderRadius:10,padding:"9px 12px",fontSize:11,color:T.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {refLink}
          </div>
          <button onClick={copyRef} style={{background:copied?T.green:T.accent,color:"#fff",border:"none",padding:"9px 16px",borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"Manrope",flexShrink:0,transition:"background .2s"}}>
            {copied?"✓":"Копировать"}
          </button>
        </div>
      </>}
    </Card>

    <Card style={{background:`linear-gradient(135deg,${T.accentBg},${T.surface})`,border:`1px solid ${T.border}`}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:0}}>
        {[["Обмен веществ",n.bmr,"без активности"],["Расход в день",n.tdee,"с учётом активности"],["Твоя цель",n.target,"ккал / день"]].map(([t,v,sub])=>(
          <div key={t} style={{textAlign:"center",padding:"8px 4px",borderRight:t!=="Цель"?`1px solid ${T.border}`:"none"}}>
            <div style={{fontSize:9,fontWeight:600,letterSpacing:".14em",color:T.muted,marginBottom:6}}>{t}</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:400,color:T.accent,lineHeight:1}}>{v}</div>
            <div style={{fontSize:9,color:T.faint,marginTop:4}}>{sub}</div>
          </div>
        ))}
      </div>
    </Card>
    <Card>
      <Field label="Имя" value={f.name} onChange={e=>s("name",e.target.value)}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Вес, кг" type="number" value={f.weight} onChange={e=>s("weight",e.target.value)}/>
        <Field label="Рост, см" type="number" value={f.height} onChange={e=>s("height",e.target.value)}/>
        <Field label="Возраст" type="number" value={f.age} onChange={e=>s("age",e.target.value)}/>
        <Drop label="Пол" opts={[{v:"female",l:"Женский"},{v:"male",l:"Мужской"}]} value={f.gender} onChange={v=>s("gender",v)}/>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".12em",color:T.muted,marginBottom:10,textTransform:"uppercase"}}>Активность</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {[{v:"sedentary",ico:"🪑",l:"Сидячий"},{v:"light",ico:"🚶",l:"Лёгкая"},{v:"moderate",ico:"🏃",l:"Умеренная"},{v:"active",ico:"💪",l:"Высокая"},{v:"veryActive",ico:"🔥",l:"Очень высокая"}].map(o=>(
            <div key={o.v} onClick={()=>s("activity",o.v)} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderRadius:12,border:`1.5px solid ${f.activity===o.v?T.accent:T.border}`,background:f.activity===o.v?T.accentBg:T.bg,cursor:"pointer",transition:"all .2s"}}>
              <span style={{fontSize:18}}>{o.ico}</span>
              <span style={{fontSize:13,fontWeight:f.activity===o.v?600:400,color:f.activity===o.v?T.accent:T.text}}>{o.l}</span>
              {f.activity===o.v&&<div style={{marginLeft:"auto",width:16,height:16,borderRadius:"50%",background:T.accent,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:10}}>✓</span></div>}
            </div>
          ))}
        </div>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:".12em",color:T.muted,marginBottom:10,textTransform:"uppercase"}}>Цель</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {[{v:"loss",ico:"📉",l:"Похудение",d:"−20% от нормы"},{v:"maintenance",ico:"⚖️",l:"Поддержание",d:"по норме"},{v:"gain",ico:"📈",l:"Набор массы",d:"+15% к норме"}].map(o=>(
            <div key={o.v} onClick={()=>s("goal",o.v)} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderRadius:12,border:`1.5px solid ${f.goal===o.v?T.accent:T.border}`,background:f.goal===o.v?T.accentBg:T.bg,cursor:"pointer",transition:"all .2s"}}>
              <span style={{fontSize:18}}>{o.ico}</span>
              <span style={{fontSize:13,fontWeight:f.goal===o.v?600:400,color:f.goal===o.v?T.accent:T.text,flex:1}}>{o.l}</span>
              <span style={{fontSize:11,color:T.muted}}>{o.d}</span>
              {f.goal===o.v&&<div style={{width:16,height:16,borderRadius:"50%",background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:"#fff",fontSize:10}}>✓</span></div>}
            </div>
          ))}
        </div>
      </div>
      <button onClick={()=>onSave({...f,age:+f.age,weight:+f.weight,height:+f.height})} style={{width:"100%",background:T.accent,color:"#fff",border:"none",padding:"14px",borderRadius:50,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Manrope"}}>Сохранить</button>
    </Card>
    <button className="ghost-btn" style={{width:"100%",marginTop:4,color:"#c04040",borderColor:"#f5d0cc"}} onClick={onReset}>Сбросить всё</button>
  </div>;
}

// ─── Sync ──────────────────────────────────────────────────────────
const getTgId=()=>{
  const live=window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if(live){localStorage.setItem("albi_tgid",String(live));return live;}
  const cached=localStorage.getItem("albi_tgid");
  return cached?Number(cached):null;
};

async function syncLoad(tgId){
  try{
    const r=await fetch(`/api/sync?telegram_id=${tgId}`);
    if(r.ok) return await r.json();
  }catch{}
  return null;
}

const getTgUser=()=>window.Telegram?.WebApp?.initDataUnsafe?.user||null;

let syncTimer=null;
function syncSave(tgId,data){
  if(!tgId)return;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(async()=>{
    const tgUser=getTgUser();
    try{await fetch("/api/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      telegram_id:tgId,
      tg_name:tgUser?.first_name||null,
      tg_username:tgUser?.username||null,
      ...data
    })});}
    catch{}
  },2000);
}

// ─── Paywall ───────────────────────────────────────────────────────
function Paywall({ tgId }) {
  const [sel,setSel]=useState("quarterly");
  const [loading,setLoading]=useState(false);
  const [discount,setDiscount]=useState(false);
  const plans=[
    {id:"monthly",  label:"1 месяц",  price:249,  priceStr:"249 ₽", sub:"249 ₽/мес",  badge:null,  },
    {id:"quarterly",label:"3 месяца", price:599,  priceStr:"599 ₽", sub:"200 ₽/мес",  badge:"−20%",},
    {id:"yearly",   label:"1 год",    price:1990, priceStr:"1990 ₽",sub:"166 ₽/мес",  badge:"−33%",},
  ];

  // Проверяем реферальную скидку при открытии экрана
  useEffect(()=>{
    if(!tgId) return;
    fetch(`/api/sync?telegram_id=${tgId}`).then(r=>r.json()).then(d=>{
      // Проверяем есть ли реферал — если да, покажем скидку
      if(d?.access) return; // уже загружено через основной sync
    }).catch(()=>{});
    // Запрашиваем наличие реферала напрямую
    fetch("/api/payment/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegram_id:tgId,plan:"check"})})
      .then(r=>r.json()).then(d=>{ if(d.has_discount) setDiscount(true); }).catch(()=>{});
  },[tgId]);

  const pay=async()=>{
    if(!tgId){
      window.open("https://t.me/AlbiScan_bot","_blank"); return;
    }
    setLoading(true);
    try{
      const r=await fetch("/api/payment/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegram_id:tgId,plan:sel})});
      const d=await r.json();
      if(d.url){
        if(d.has_discount) setDiscount(true);
        if(window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(d.url);
        else window.open(d.url,"_blank");
      }
    }catch(e){}
    setLoading(false);
  };
  return <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Manrope',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",padding:"48px 20px 40px"}}>
    <style>{CSS}</style>
    <div style={{maxWidth:400,width:"100%"}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:300,color:T.text,textAlign:"center",marginBottom:6}}>
        Albi<span style={{color:T.accent}}>·</span>
      </div>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontSize:19,fontWeight:700,color:T.text,marginBottom:8}}>Пробный период закончился</div>
        <div style={{fontSize:13,color:T.muted,lineHeight:1.65}}>Подпишись, чтобы продолжить отслеживать питание и получать ИИ-анализ блюд</div>
      </div>

      <div style={{background:T.surface,borderRadius:16,padding:"14px 18px",marginBottom:22,border:`1px solid ${T.border}`}}>
        {["📸 Анализ фото блюд без ограничений","📊 История питания и динамика веса","🎯 Персональные нормы КБЖУ","🔄 Синхронизация на всех устройствах"].map(b=>(
          <div key={b} style={{padding:"7px 0",fontSize:13,color:T.text,borderBottom:`1px solid ${T.border}`,lastChild:{border:"none"}}}>{b}</div>
        ))}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
        {plans.map(p=>(
          <div key={p.id} onClick={()=>setSel(p.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px",borderRadius:14,border:`2px solid ${sel===p.id?T.accent:T.border}`,background:sel===p.id?T.accentBg:T.surface,cursor:"pointer",transition:"all .2s"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${sel===p.id?T.accent:T.borderMd}`,background:sel===p.id?T.accent:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {sel===p.id&&<div style={{width:7,height:7,borderRadius:"50%",background:"#fff"}}/>}
              </div>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:T.text}}>{p.label}</div>
                <div style={{fontSize:11,color:T.muted}}>{p.sub}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {p.badge&&<span style={{background:T.greenBg,color:T.green,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:50}}>{p.badge}</span>}
              <div style={{textAlign:"right"}}>
                {discount&&sel===p.id&&<div style={{fontSize:10,color:T.faint,textDecoration:"line-through"}}>{p.priceStr}</div>}
                <div style={{fontSize:16,fontWeight:700,color:sel===p.id?T.accent:T.text}}>
                  {discount&&sel===p.id?`${Math.round(p.price*0.9)} ₽`:p.priceStr}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={pay} disabled={loading} style={{width:"100%",background:T.accent,color:"#fff",border:"none",padding:"15px",borderRadius:50,fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"Manrope",marginBottom:10,opacity:loading?.7:1}}>
        {loading?"Создаём платёж…":"Оформить подписку →"}
      </button>
      <div style={{textAlign:"center",fontSize:11,color:T.faint,lineHeight:1.5}}>
        Оплата картой через защищённую форму Продамус 🔒
      </div>
    </div>
  </div>
}

// ─── Root ──────────────────────────────────────────────────────────
const TABS=[{id:"today",ico:"🍽",l:"Сегодня"},{id:"history",ico:"📊",l:"История"},{id:"weight",ico:"⚖",l:"Вес"},{id:"profile",ico:"◎",l:"Профиль"}];

export default function App() {
  const [ready,setReady]=useState(false);
  const [profile,setProfile]=useState(null);
  const [history,setHistory]=useState({});
  const [weights,setWeights]=useState([]);
  const [reminders,setReminders]=useState([]);
  const [tab,setTab]=useState("today");
  const [access,setAccess]=useState(null); // null=загрузка, {allowed,plan}
  const [tgId]=useState(()=>getTgId());

  useEffect(()=>{(async()=>{
    try{
      const load=async(k)=>{try{const r=await window.storage.get(k);return r?JSON.parse(r.value):null;}catch{return null;}};
      const tgId=getTgId();

      // Сначала пробуем загрузить из Supabase
      if(tgId){
        const cloud=await syncLoad(tgId);
        if(cloud){
          if(cloud.profile)setProfile(cloud.profile);
          if(cloud.history)setHistory(cloud.history);
          if(cloud.weights)setWeights(cloud.weights);
          if(cloud.reminders)setReminders(cloud.reminders);
          // Статус доступа из ответа сервера
          if(cloud.access) setAccess(cloud.access);
          else setAccess({allowed:true,plan:"unknown"});
          setReady(true);
          return;
        }
        // Пользователь есть в tg но данных нет — новый, триал будет после первого sync POST
        setAccess({allowed:true,plan:"trial"});
      } else {
        // Нет tgId — не блокируем (десктоп/браузер)
        setAccess({allowed:true,plan:"unknown"});
      }

      // Fallback — локальное хранилище
      const [p,h,w,r]=await Promise.all([load("albi_profile"),load("albi_history"),load("albi_weights"),load("albi_reminders")]);
      if(p)setProfile(p); if(h)setHistory(h); if(w)setWeights(w); if(r)setReminders(r);
    }catch(e){console.log(e);setAccess({allowed:true,plan:"unknown"});}
    setReady(true);
  })();},[]);

  useEffect(()=>{if(ready&&profile)window.storage.set("albi_profile",JSON.stringify(profile)).catch(()=>{});},[profile,ready]);
  useEffect(()=>{if(ready)window.storage.set("albi_history",JSON.stringify(history)).catch(()=>{});},[history,ready]);
  useEffect(()=>{if(ready)window.storage.set("albi_weights",JSON.stringify(weights)).catch(()=>{});},[weights,ready]);
  useEffect(()=>{if(ready)window.storage.set("albi_reminders",JSON.stringify(reminders)).catch(()=>{});},[reminders,ready]);

  // Синхронизация с Supabase при каждом изменении
  useEffect(()=>{
    if(!ready)return;
    const tgId=getTgId();
    syncSave(tgId,{profile,history,weights,reminders});
  },[profile,history,weights,reminders,ready]);

  const [selectedDate,setSelectedDate]=useState(todayKey());
  const today=history[selectedDate]||{meals:[],water:0};
  const setDay=(fn)=>setHistory(h=>({...h,[selectedDate]:typeof fn==="function"?fn(h[selectedDate]||{meals:[],water:0}):fn}));
  const norms=profile?calcTDEE(profile):{target:2000,tdee:2000,bmr:1600};

  if(!ready) return <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <style>{CSS}</style>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:T.faint,letterSpacing:"-.01em"}}>Albi<span style={{color:T.accent}}>·</span></div>
  </div>;

  if(!profile) return <Onboarding onDone={p=>setProfile(p)}/>;

  // Показываем paywall только если точно знаем что доступ закончился
  if(access&&!access.allowed) return <Paywall tgId={tgId}/>;

  return <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Manrope',sans-serif",paddingBottom:90,overflowX:"hidden",width:"100%"}}>
    <style>{CSS}</style>
    <div style={{maxWidth:460,margin:"0 auto",padding:"28px 16px 16px",width:"100%"}}>
      {tab==="today"&&<Today profile={profile} norms={norms} day={today} setDay={setDay} selectedDate={selectedDate} onSelectDate={setSelectedDate} history={history}/>}
      {tab==="history"&&<History history={history} norms={norms}/>}
      {tab==="weight"&&<Weight weights={weights} setWeights={setWeights}/>}
      {tab==="profile"&&<Profile profile={profile} norms={norms} access={access} tgId={tgId}
        onSave={p=>{setProfile(p);setTab("today");}}
        onReset={()=>{setProfile(null);setHistory({});setWeights([]);setReminders([]);}}/>}
    </div>
    {/* Bottom nav */}
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(249,248,246,.97)",backdropFilter:"blur(20px)",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"center",paddingBottom:"env(safe-area-inset-bottom, 8px)"}}>
      <div style={{display:"flex",width:"100%",maxWidth:460}}>
        {TABS.map(t=>(
          <button key={t.id} className={`tab${tab===t.id?" on":""}`} onClick={()=>setTab(t.id)}>
            <span className="ico">{t.ico}</span>{t.l}
          </button>
        ))}
      </div>
    </div>
  </div>;
}
