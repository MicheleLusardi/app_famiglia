// =====================================================================
// App famiglia: lista spesa + spese mensili (Supabase)
// =====================================================================
const cfg = window.APP_CONFIG;
const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

const $ = id => document.getElementById(id);
const eur = n => Number(n).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const dataIT = iso => iso.split("-").reverse().join("/");               // YYYY-MM-DD -> DD/MM/YYYY
const oggi = () => new Date().toLocaleDateString("sv-SE");              // YYYY-MM-DD (ora locale)
const meseCorrente = () => oggi().slice(0, 7);                          // YYYY-MM
const meseSucc = ym => { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

const DURATA_PRESSIONE_MS = 3000;     // tempo di pressione per spuntare/ripristinare una voce
const TOLLERANZA_MOVIMENTO_PX = 10;   // oltre questo spostamento la pressione si annulla (es. scroll)

let lista = [];
let pressione = null;                 // pressione in corso: { li, id, x, y, timer }
let ridisegnoInSospeso = false;       // aggiornamento lista arrivato durante una pressione
let lookups = { negozi: [], tipologie: [], imputazioni: [] };
let channel = null;
let avviata = false;

// ---------------------------------------------------------------- viste
function mostra(id) {
  for (const v of ["view-login", "view-noaccess", "view-app"]) $(v).classList.toggle("hidden", v !== id);
}

function errore(e, el) {
  console.error(e);
  const msg = e?.message || String(e);
  if (el) { el.textContent = msg; el.className = "msg err"; } else alert(msg);
}

// ---------------------------------------------------------------- auth
async function avvio() {
  const { data } = await sb.auth.getSession();
  if (data.session) await entra(data.session.user); else mostra("view-login");
}

sb.auth.onAuthStateChange((evento, session) => {
  if (evento === "SIGNED_OUT") { avviata = false; if (channel) sb.removeChannel(channel); mostra("view-login"); }
});

$("form-login").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("login-msg"); msg.textContent = "Accesso in corso..."; msg.className = "msg";
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("login-email").value.trim(), password: $("login-password").value
  });
  if (error) return errore({ message: "Email o password non corretti" }, msg);
  msg.textContent = "";
  await entra(data.user);
});

document.querySelectorAll("[data-action=logout]").forEach(b => b.addEventListener("click", () => sb.auth.signOut()));

$("btn-pwd").addEventListener("click", async () => {
  const p = prompt("Nuova password (minimo 6 caratteri):");
  if (!p) return;
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) errore(error); else alert("Password aggiornata");
});

async function entra(user) {
  if (avviata) return;
  const { data, error } = await sb.from("membri").select("nome").eq("user_id", user.id).maybeSingle();
  if (error) return errore(error);
  if (!data) return mostra("view-noaccess");
  avviata = true;
  $("hello").textContent = "Ciao " + data.nome;
  mostra("view-app");
  $("sp-data").value = oggi();
  $("sp-mese").value = meseCorrente();
  $("rp-mese").value = meseCorrente();
  await Promise.all([caricaLista(), caricaLookups()]);
  ascoltaLista();
}

// ---------------------------------------------------------------- tab
document.querySelectorAll(".tabbar button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".tabbar button").forEach(x => x.classList.toggle("active", x === b));
  for (const t of ["lista", "spese", "report"]) $("tab-" + t).classList.toggle("hidden", t !== b.dataset.tab);
  if (b.dataset.tab === "lista") caricaLista();
  if (b.dataset.tab === "spese") caricaSpese();
  if (b.dataset.tab === "report") caricaReport();
}));

// ================================================================ LISTA SPESA
function ordina(arr) {
  // da comprare (per inserimento) sopra, comprati (per ora di acquisto) in fondo
  return arr.sort((a, b) =>
    (a.comprato - b.comprato) ||
    String(a.comprato_il || "").localeCompare(String(b.comprato_il || "")) ||
    String(a.created_at).localeCompare(String(b.created_at)));
}

async function caricaLista() {
  const { data, error } = await sb.from("lista_spesa_ordinata").select("*");
  if (error) return errore(error);
  lista = data;
  disegnaLista();
}

function disegnaLista() {
  // non ridisegnare mentre un dito è premuto su una voce: si farà al rilascio
  if (pressione) { ridisegnoInSospeso = true; return; }
  const ul = $("lista"); ul.innerHTML = "";
  for (const it of lista) {
    const li = document.createElement("li");
    if (it.comprato) li.classList.add("done");
    const txt = document.createElement("span"); txt.className = "txt"; txt.textContent = it.articolo;
    const q = document.createElement("span"); q.className = "q"; q.textContent = it.quantita || "";
    const del = document.createElement("button"); del.className = "del"; del.textContent = "×"; del.title = "Elimina";
    del.addEventListener("click", ev => { ev.stopPropagation(); eliminaVoce(it); });
    li.append(txt, q, del);
    attivaPressioneLunga(li, it.id);
    ul.append(li);
  }
  $("lista-vuota").classList.toggle("hidden", lista.length > 0);
  $("lista-hint").classList.toggle("hidden", lista.length === 0);
  $("btn-svuota").classList.toggle("hidden", lista.length === 0);
}

// Spunta/ripristino solo dopo una pressione continua di DURATA_PRESSIONE_MS,
// per evitare tocchi accidentali (es. telefono in tasca o scroll della lista).
function attivaPressioneLunga(li, id) {
  li.addEventListener("pointerdown", ev => {
    if (ev.button !== 0 || ev.target.closest(".del")) return;
    annullaPressione();
    li.classList.add("holding");
    pressione = {
      li, id, x: ev.clientX, y: ev.clientY,
      timer: setTimeout(completaPressione, DURATA_PRESSIONE_MS)
    };
  });
  li.addEventListener("pointermove", ev => {
    if (!pressione || pressione.li !== li) return;
    const spostamento = Math.hypot(ev.clientX - pressione.x, ev.clientY - pressione.y);
    if (spostamento > TOLLERANZA_MOVIMENTO_PX) annullaPressione();
  });
  for (const tipo of ["pointerup", "pointerleave", "pointercancel"]) li.addEventListener(tipo, annullaPressione);
  li.addEventListener("contextmenu", ev => ev.preventDefault());   // niente menu del long-press
}

function completaPressione() {
  const id = pressione.id;
  annullaPressione();
  if (navigator.vibrate) navigator.vibrate(50);                    // conferma tattile (solo Android)
  const voce = lista.find(x => x.id === id);                       // voce aggiornata, anche dopo un realtime
  if (voce) barra(voce);
}

function annullaPressione() {
  if (!pressione) return;
  clearTimeout(pressione.timer);
  pressione.li.classList.remove("holding");
  pressione = null;
  if (ridisegnoInSospeso) { ridisegnoInSospeso = false; disegnaLista(); }
}

async function barra(it) {
  // aggiornamento immediato a video, poi salvataggio
  it.comprato = !it.comprato;
  it.comprato_il = it.comprato ? new Date().toISOString() : null;
  ordina(lista); disegnaLista();
  const { error } = await sb.from("lista_spesa").update({ comprato: it.comprato }).eq("id", it.id);
  if (error) { errore(error); caricaLista(); }
}

async function eliminaVoce(it) {
  if (!confirm(`Eliminare "${it.articolo}" dalla lista?`)) return;
  const { error } = await sb.from("lista_spesa").delete().eq("id", it.id);
  if (error) return errore(error);
  caricaLista();
}

$("form-lista").addEventListener("submit", async e => {
  e.preventDefault();
  const articolo = $("lista-articolo").value.trim();
  if (!articolo) return;
  const { error } = await sb.from("lista_spesa").insert({ articolo, quantita: $("lista-qta").value.trim() || null });
  if (error) return errore(error);
  $("lista-articolo").value = ""; $("lista-qta").value = "";
  $("lista-articolo").focus();
  caricaLista();
});

$("btn-svuota").addEventListener("click", async () => {
  const nonComprati = lista.filter(i => !i.comprato).length;
  if (nonComprati > 0 &&
      !confirm("Sei sicuro che vuoi svuotare la lista? Non hai acquistato tutti gli articoli")) return;
  const { error } = await sb.rpc("svuota_lista");
  if (error) return errore(error);
  caricaLista();
});

function ascoltaLista() {
  // aggiornamento in tempo reale quando un altro familiare modifica la lista
  channel = sb.channel("lista-spesa")
    .on("postgres_changes", { event: "*", schema: "public", table: "lista_spesa" }, () => caricaLista())
    .subscribe();
}

// ================================================================ SPESE
const NUOVO = "__nuovo__";
const etichettaNuovo = { negozi: "+ Nuovo negozio...", tipologie: "+ Nuova tipologia...", imputazioni: "+ Nuova imputazione..." };

async function caricaLookups() {
  for (const t of Object.keys(lookups)) {
    const { data, error } = await sb.from(t).select("id,nome").eq("attivo", true).order("nome");
    if (error) return errore(error);
    lookups[t] = data;
  }
  document.querySelectorAll("select[data-lookup]").forEach(riempiSelect);
}

function riempiSelect(sel, selezionaId) {
  const t = sel.dataset.lookup;
  const prima = selezionaId ?? sel.value;
  sel.innerHTML = "";
  sel.append(new Option("-- scegli --", ""));
  for (const r of lookups[t]) sel.append(new Option(r.nome, r.id));
  sel.append(new Option(etichettaNuovo[t], NUOVO));
  if (prima && prima !== NUOVO) sel.value = String(prima);
}

document.querySelectorAll("select[data-lookup]").forEach(sel => sel.addEventListener("change", async () => {
  if (sel.value !== NUOVO) return;
  const t = sel.dataset.lookup;
  const nome = (prompt(etichettaNuovo[t].replace("+ ", "").replace("...", "") + ":") || "").trim();
  if (!nome) { sel.value = ""; return; }
  const { data, error } = await sb.from(t).insert({ nome }).select("id").single();
  if (error) { sel.value = ""; return errore(error.code === "23505" ? { message: `"${nome}" esiste già` } : error); }
  await caricaLookups();
  riempiSelect(sel, data.id);
}));

$("form-spesa").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("spesa-msg");
  const rec = {
    data: $("sp-data").value,
    importo: Number($("sp-importo").value),
    negozio_id: Number($("sp-negozio").value),
    tipologia_id: Number($("sp-tipologia").value),
    imputazione_id: Number($("sp-imputazione").value),
    note: $("sp-note").value.trim() || null
  };
  const { error } = await sb.from("spese").insert(rec);
  if (error) return errore(error, msg);
  msg.textContent = `Salvata: ${eur(rec.importo)} del ${dataIT(rec.data)}`; msg.className = "msg";
  $("sp-importo").value = ""; $("sp-note").value = "";
  $("sp-mese").value = rec.data.slice(0, 7);
  caricaSpese();
});

$("sp-mese").addEventListener("change", caricaSpese);

async function caricaSpese() {
  const ym = $("sp-mese").value || meseCorrente();
  const { data, error } = await sb.from("spese")
    .select("id,data,importo,note,negozi(nome),tipologie(nome),imputazioni(nome)")
    .gte("data", ym + "-01").lt("data", meseSucc(ym) + "-01")
    .order("data", { ascending: false }).order("id", { ascending: false });
  if (error) return errore(error);
  const ul = $("elenco-spese"); ul.innerHTML = "";
  let tot = 0;
  for (const s of data) {
    tot += Number(s.importo);
    const li = document.createElement("li");
    const info = document.createElement("div"); info.className = "info";
    const b = document.createElement("b"); b.textContent = `${dataIT(s.data)} · ${s.negozi?.nome ?? ""}`;
    info.append(b, document.createElement("br"),
      `${s.tipologie?.nome ?? ""} → ${s.imputazioni?.nome ?? ""}${s.note ? " · " + s.note : ""}`);
    const imp = document.createElement("span"); imp.className = "imp"; imp.textContent = eur(s.importo);
    const del = document.createElement("button"); del.className = "del"; del.textContent = "×"; del.title = "Elimina";
    del.addEventListener("click", async () => {
      if (!confirm(`Eliminare la spesa di ${eur(s.importo)} del ${dataIT(s.data)}?`)) return;
      const { error } = await sb.from("spese").delete().eq("id", s.id);
      if (error) return errore(error);
      caricaSpese();
    });
    li.append(info, imp, del);
    ul.append(li);
  }
  const li = document.createElement("li");
  li.innerHTML = `<div class="info"><b>Totale mese</b></div>`;
  const imp = document.createElement("span"); imp.className = "imp"; imp.textContent = eur(tot);
  li.append(imp);
  ul.append(li);
}

// ================================================================ REPORT
$("rp-mese").addEventListener("change", caricaReport);

async function caricaReport() {
  const ym = $("rp-mese").value || meseCorrente();
  const { data, error } = await sb.from("spese_mensili").select("*").eq("mese", ym + "-01");
  if (error) return errore(error);
  const box = $("report"); box.innerHTML = "";
  if (!data.length) { box.innerHTML = '<p class="msg">Nessuna spesa nel mese</p>'; return; }
  box.append(tabella("Per tipologia", raggruppa(data, "tipologia")),
             tabella("Per imputazione", raggruppa(data, "imputazione")));
}

function raggruppa(righe, campo) {
  const m = new Map();
  for (const r of righe) m.set(r[campo], (m.get(r[campo]) || 0) + Number(r.totale));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function tabella(titolo, righe) {
  const t = document.createElement("table");
  const tot = righe.reduce((s, r) => s + r[1], 0);
  const tr = (cells, cls) => {
    const r = t.insertRow(); if (cls) r.className = cls;
    cells.forEach(([v, n]) => { const c = r.insertCell(); c.textContent = v; if (n) c.className = "n"; });
  };
  const h = t.createTHead().insertRow();
  for (const [v, n] of [[titolo], ["€", true], ["%", true]]) { const th = document.createElement("th"); th.textContent = v; if (n) th.className = "n"; h.append(th); }
  for (const [k, v] of righe) tr([[k], [eur(v), true], [(v / tot * 100).toFixed(0) + "%", true]]);
  tr([["Totale"], [eur(tot), true], ["100%", true]], "tot");
  return t;
}

// ---------------------------------------------------------------- start
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
avvio();
