// Radar Fútbol — función de Netlify que lee los datos públicos de Football-Data.co.uk
// (archivos que la página ofrece para uso libre) y calcula todo en el servidor.
//   /api/fd?part=leagues      lista de ligas
//   /api/fd?league=E0         tabla general/casa/fuera, porcentajes, corners, rachas y partidos
//   /api/fd?debug=1&league=E0 diagnóstico
// Fechas y horas: Football-Data usa la hora del Reino Unido; aquí se pasan a hora de Ecuador.

const FD = "https://www.football-data.co.uk/";
// [código, nombre en el menú, país (ligas extra)]
const MAIN = [
  ["E0", "INGLATERRA PREMIER LEAGUE"], ["E1", "INGLATERRA CHAMPIONSHIP"], ["E2", "INGLATERRA LEAGUE ONE"],
  ["E3", "INGLATERRA LEAGUE TWO"], ["EC", "INGLATERRA NATIONAL LEAGUE"],
  ["SC0", "ESCOCIA PREMIERSHIP"], ["SC1", "ESCOCIA CHAMPIONSHIP"], ["SC2", "ESCOCIA LEAGUE ONE"], ["SC3", "ESCOCIA LEAGUE TWO"],
  ["D1", "ALEMANIA BUNDESLIGA"], ["D2", "ALEMANIA BUNDESLIGA 2"], ["I1", "ITALIA SERIE A"], ["I2", "ITALIA SERIE B"],
  ["SP1", "ESPAÑA LA LIGA"], ["SP2", "ESPAÑA LA LIGA 2"], ["F1", "FRANCIA LIGUE 1"], ["F2", "FRANCIA LIGUE 2"],
  ["N1", "HOLANDA EREDIVISIE"], ["B1", "BELGICA PRO LEAGUE"], ["P1", "PORTUGAL PRIMEIRA LIGA"],
  ["T1", "TURQUIA SUPER LIG"], ["G1", "GRECIA SUPER LEAGUE"],
];
const EXTRA_LEAGUES = [
  ["ARG", "ARGENTINA LIGA PROFESIONAL", "Argentina"], ["AUT", "AUSTRIA BUNDESLIGA", "Austria"],
  ["BRA", "BRASIL SERIE A", "Brazil"], ["CHN", "CHINA SUPER LEAGUE", "China"], ["DNK", "DINAMARCA SUPERLIGA", "Denmark"],
  ["FIN", "FINLANDIA VEIKKAUSLIIGA", "Finland"], ["IRL", "IRLANDA PREMIER DIVISION", "Ireland"],
  ["JPN", "JAPON J1 LEAGUE", "Japan"], ["MEX", "MEXICO LIGA MX", "Mexico"], ["NOR", "NORUEGA ELITESERIEN", "Norway"],
  ["POL", "POLONIA EKSTRAKLASA", "Poland"], ["ROU", "RUMANIA LIGA 1", "Romania"], ["RUS", "RUSIA PREMIER LEAGUE", "Russia"],
  ["SWE", "SUECIA ALLSVENSKAN", "Sweden"], ["SWZ", "SUIZA SUPER LEAGUE", "Switzerland"], ["USA", "EEUU MLS", "USA"],
];
const ALL_LEAGUES = [...MAIN, ...EXTRA_LEAGUES].map(([id, name]) => [id, name]).sort((a, b) => a[1].localeCompare(b[1], "es"));

const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0 Safari/537.36", Accept: "text/csv,text/plain,*/*" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...extra } });
const tkey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

async function getText(url, timeoutMs = 7000, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { last = e.name === "AbortError" ? new Error("tiempo de espera agotado") : e; if (/HTTP 404/.test(last.message)) break; await sleep(300); }
    finally { clearTimeout(t); }
  }
  throw last;
}

// CSV sencillo (Football-Data no usa comillas con comas dentro)
function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const h = lines[0].split(",").map((x) => x.trim());
  return lines.slice(1).map((l) => { const c = l.split(","); const o = {}; h.forEach((k, i) => { o[k] = (c[i] ?? "").trim(); }); return o; });
}
const pick = (o, ...ks) => { for (const k of ks) if (o[k] != null && o[k] !== "") return o[k]; return ""; };
const n = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);

// ---------- hora Reino Unido → Ecuador ----------
const lastSunday = (y, m) => { const d = new Date(Date.UTC(y, m, 0)); return d.getUTCDate() - d.getUTCDay(); };
const ukOffset = (y, mo, d) => {
  const t = Date.UTC(y, mo - 1, d, 12);
  return t >= Date.UTC(y, 2, lastSunday(y, 3), 1) && t < Date.UTC(y, 9, lastSunday(y, 10), 1) ? 1 : 0;
};
function when(dateStr, timeStr) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(dateStr || "");
  if (!m) return null;
  let [d, mo, y] = [+m[1], +m[2], +m[3]];
  if (y < 100) y += 2000;
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr || "");
  if (!tm) return { date: iso(y, mo, d), time: "", uk: "", ts: Date.UTC(y, mo - 1, d) };
  const utc = Date.UTC(y, mo - 1, d, +tm[1] - ukOffset(y, mo, d), +tm[2]);
  const ec = new Date(utc - 5 * 3600000);
  return { date: iso(ec.getUTCFullYear(), ec.getUTCMonth() + 1, ec.getUTCDate()),
    time: `${String(ec.getUTCHours()).padStart(2, "0")}:${String(ec.getUTCMinutes()).padStart(2, "0")}`, uk: timeStr, ts: utc };
}

// ---------- cálculos por equipo ----------
// Tablas general / casa / fuera + % de goles + corners + rachas, todo desde los resultados
function build(results) {
  const mk = () => ({ gp: 0, w: 0, d: 0, l: 0, gfT: 0, gaT: 0, over: [0, 0, 0, 0, 0], bts: 0, cs: 0, fts: 0, totT: 0,
    cG: 0, cF: 0, cA: 0, c85: 0, c95: 0, c105: 0, seq: [] });
  const T = { all: {}, home: {}, away: {} }, names = {};
  const add = (side, k, gf, ga, cf, ca) => {
    const x = (T[side][k] ||= mk());
    x.gp++; x.gfT += gf; x.gaT += ga;
    const res = gf > ga ? "w" : gf === ga ? "d" : "l";
    x[res]++;
    const tot = gf + ga;
    x.totT += tot;
    [0.5, 1.5, 2.5, 3.5, 4.5].forEach((l, i) => { if (tot > l) x.over[i]++; });
    if (gf > 0 && ga > 0) x.bts++;
    if (ga === 0) x.cs++;
    if (gf === 0) x.fts++;
    if (cf != null && ca != null) { x.cG++; x.cF += cf; x.cA += ca; const ct = cf + ca; if (ct > 8.5) x.c85++; if (ct > 9.5) x.c95++; if (ct > 10.5) x.c105++; }
    x.seq.push({ res, gf, ga });
  };
  const sorted = [...results].sort((a, b) => a.ts - b.ts);
  for (const g of sorted) {
    names[g.hk] ||= g.home; names[g.ak] ||= g.away;
    for (const side of ["all", "home"]) add(side, g.hk, g.hg, g.ag, g.hc, g.ac);
    for (const side of ["all", "away"]) add(side, g.ak, g.ag, g.hg, g.ac, g.hc);
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const streak = (seq) => {
    const run = (f) => { let c = 0; for (let i = seq.length - 1; i >= 0 && f(seq[i]); i--) c++; return c; };
    return { w: run((s) => s.res === "w"), d: run((s) => s.res === "d"), l: run((s) => s.res === "l"),
      "no w": run((s) => s.res !== "w"), "no d": run((s) => s.res !== "d"), "no l": run((s) => s.res !== "l"),
      "no gf": run((s) => s.gf === 0), "no ga": run((s) => s.ga > 0) };
  };
  const out = { standings: {}, goals: {}, corners: {}, streaks: {} };
  for (const side of ["all", "home", "away"]) {
    const st = {}, gl = {}, cr = {}, sk = {};
    const rows = Object.entries(T[side]);
    for (const [k, x] of rows) {
      const team = names[k];
      st[k] = { team, gp: x.gp, w: x.w, d: x.d, l: x.l, pts: x.w * 3 + x.d, gf: x.gp ? x.gfT / x.gp : null, ga: x.gp ? x.gaT / x.gp : null, gd: x.gfT - x.gaT, gfT: x.gfT };
      gl[k] = { team, gp: x.gp, avg: x.gp ? x.totT / x.gp : null, "0.5+": pct(x.over[0], x.gp), "1.5+": pct(x.over[1], x.gp), "2.5+": pct(x.over[2], x.gp),
        "3.5+": pct(x.over[3], x.gp), "4.5+": pct(x.over[4], x.gp), bts: pct(x.bts, x.gp), cs: pct(x.cs, x.gp), fts: pct(x.fts, x.gp) };
      if (x.cG) cr[k] = { team, gp: x.cG, for: x.cF / x.cG, against: x.cA / x.cG, total: (x.cF + x.cA) / x.cG, "8.5+": pct(x.c85, x.cG), "9.5+": pct(x.c95, x.cG), "10.5+": pct(x.c105, x.cG) };
      sk[k] = { team, ...streak(x.seq) };
    }
    // posiciones: puntos, diferencia de goles, goles a favor
    Object.values(st).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gfT - a.gfT || a.team.localeCompare(b.team)).forEach((x, i) => { x.pos = i + 1; });
    out.standings[side] = st; out.goals[side] = gl; out.corners[side] = Object.keys(cr).length ? cr : null; out.streaks[side] = sk;
  }
  if (!out.corners.all) out.corners = null;
  return out;
}

function seasonCode(offset = 0) {
  const now = new Date();
  const y = (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1) - offset;
  return `${String(y % 100).padStart(2, "0")}${String((y + 1) % 100).padStart(2, "0")}`;
}

async function leagueData(league) {
  const main = MAIN.find((x) => x[0] === league);
  const extra = EXTRA_LEAGUES.find((x) => x[0] === league);
  if (!main && !extra) throw new Error(`liga desconocida: ${league}`);
  const warnings = [];
  let rows = [], fixtures = [], season = "";
  if (main) {
    const [cur, fx] = await Promise.allSettled([getText(`${FD}mmz4281/${seasonCode()}/${league}.csv`), getText(`${FD}fixtures.csv`)]);
    if (cur.status === "fulfilled") { rows = parseCsv(cur.value); season = seasonCode(); }
    else {
      // temporada todavía no publicada: la anterior
      rows = parseCsv(await getText(`${FD}mmz4281/${seasonCode(1)}/${league}.csv`)); season = seasonCode(1);
      warnings.push(`La temporada actual aún no está publicada: se usa la ${season.slice(0, 2)}/${season.slice(2)}.`);
    }
    if (fx.status === "fulfilled") fixtures = parseCsv(fx.value).filter((r) => r.Div === league);
    else warnings.push(`No se pudieron leer los próximos partidos (${fx.reason?.message}).`);
  } else {
    const [all, fx] = await Promise.allSettled([getText(`${FD}new/${league}.csv`, 8000), getText(`${FD}new_league_fixtures.csv`)]);
    if (all.status !== "fulfilled") throw all.reason;
    const every = parseCsv(all.value);
    const seasons = [...new Set(every.map((r) => r.Season).filter(Boolean))];
    season = seasons.sort((a, b) => String(a).localeCompare(String(b))).pop() || "";
    rows = every.filter((r) => r.Season === season);
    if (fx.status === "fulfilled") fixtures = parseCsv(fx.value).filter((r) => tkey(r.Country) === tkey(extra[2]));
    else warnings.push(`No se pudieron leer los próximos partidos (${fx.reason?.message}).`);
  }
  // resultados
  const results = [];
  for (const r of rows) {
    const home = pick(r, "HomeTeam", "Home"), away = pick(r, "AwayTeam", "Away");
    const hg = n(pick(r, "FTHG", "HG")), ag = n(pick(r, "FTAG", "AG"));
    const w = when(r.Date, r.Time);
    if (!home || !away || hg == null || ag == null || !w) continue;
    const odds = [n(pick(r, "AvgH", "B365H", "PSCH", "AvgCH")), n(pick(r, "AvgD", "B365D", "PSCD", "AvgCD")), n(pick(r, "AvgA", "B365A", "PSCA", "AvgCA"))];
    results.push({ home, away, hk: tkey(home), ak: tkey(away), hg, ag, hc: n(r.HC), ac: n(r.AC), ...w, odds: odds.every((x) => x) ? odds : null,
      ht: n(r.HTHG) != null && n(r.HTAG) != null ? [n(r.HTHG), n(r.HTAG)] : null });
  }
  if (!results.length) throw new Error("no hay resultados en el archivo de esta liga");
  const calc = build(results);
  const games = results.map((g) => ({ date: g.date, time: g.time, ukTime: g.uk, home: g.home, away: g.away, homeKey: g.hk, awayKey: g.ak,
    score: [g.hg, g.ag], ht: g.ht, odds: g.odds, hc: null }));
  const seen = new Set(games.map((g) => `${g.homeKey}|${g.awayKey}|${g.date}`));
  for (const r of fixtures) {
    const home = pick(r, "HomeTeam", "Home"), away = pick(r, "AwayTeam", "Away");
    const w = when(r.Date, r.Time);
    if (!home || !away || !w) continue;
    const g = { date: w.date, time: w.time, ukTime: w.uk, home, away, homeKey: tkey(home), awayKey: tkey(away), score: null,
      odds: (() => { const o = [n(pick(r, "AvgH", "B365H", "PSH", "PSCH", "AvgCH")), n(pick(r, "AvgD", "B365D", "PSD", "PSCD", "AvgCD")), n(pick(r, "AvgA", "B365A", "PSA", "PSCA", "AvgCA"))]; return o.every((x) => x) ? o : null; })(), hc: null };
    if (!calc.standings.all[g.homeKey] || !calc.standings.all[g.awayKey]) continue;
    const id = `${g.homeKey}|${g.awayKey}|${g.date}`;
    if (!seen.has(id)) { seen.add(id); games.push(g); }
  }
  if (!fixtures.length) warnings.push("Football-Data todavía no publicó próximos partidos de esta liga (los sube los martes y viernes).");
  if (!calc.corners) warnings.push("Esta liga no trae corners en Football-Data.");
  const name = (main || extra)[1];
  return { league, title: name, season, standings: calc.standings,
    extra: { goals: calc.goals, corners: calc.corners, streaks: calc.streaks }, games, warnings };
}

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("part") === "leagues")
    return json({ ok: true, leagues: ALL_LEAGUES, source: "lista" }, 200, { "Cache-Control": "public, max-age=3600" });
  const league = (url.searchParams.get("league") || "E0").toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(league)) return json({ ok: false, error: "Liga no válida" }, 400, { "Cache-Control": "no-store" });
  try {
    const d = await leagueData(league);
    if (url.searchParams.get("debug")) return json({ league, season: d.season, equipos: Object.keys(d.standings.all).length, partidos: d.games.length,
      proximos: d.games.filter((g) => !g.score).slice(0, 10), avisos: d.warnings }, 200, { "Cache-Control": "no-store" });
    return json({ ok: true, source: "football-data", updated: new Date().toISOString(), ...d }, 200, {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=1800, stale-while-revalidate=3600",
      "Netlify-Vary": "query=league|part|debug",
    });
  } catch (e) {
    return json({ ok: false, league, error: `No se pudieron leer los datos de Football-Data (${e.message}). Pulsa Actualizar para reintentar.` }, 502, { "Cache-Control": "no-store" });
  }
};

export const config = { path: "/api/fd" };
