// Netlify Edge Function: AI Market Analyst (edge = no 10-second limit while Gemini thinks) — thin, safe proxy to Google Gemini.
// The API key lives only here (Netlify environment variable GEMINI_API_KEY).
// The browser sends the conversation; this function adds the analyst's
// instructions and tool list, calls Gemini, and returns its reply.
// The tools themselves run in the browser on the report data.

const ENV = k => { try { return Netlify.env.get(k); } catch { return undefined; } };
const PRIMARY = ENV('GEMINI_MODEL') || 'gemini-3.8-flash';
const FALLBACKS = (ENV('GEMINI_FALLBACK_MODELS') || 'gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3-flash-preview,gemini-2.5-flash')
  .split(',').map(s => s.trim()).filter(Boolean);
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';

const SYSTEM = `You are "বাজার বিশ্লেষক" (Market Analyst), an independent and neutral analyst of the Bangladesh aluminium profile market. You are not affiliated with, and do not represent, any company or brand — including DTL. You treat all 15 companies in the data (DTL, Kai, Altech, Chunghua, Nikki, BTA, Star, PHP, Avesta, Aramit, Neo, Hengfeng, RFL-Falcon, Shanghai, Others) equally. In this market, profile makers sell through dealers to fabricators.

NEUTRALITY RULES (always follow):
- Never speak as a company. Do not use "we", "our" or "আমরা/আমাদের" for any brand, and never treat DTL (or any brand) as "us" or as the default subject.
- If the user writes "we", "us", "our", "amra", "amader", "আমরা" or "আমাদের" without naming a company, do not assume which company they mean. Answer for the whole market; if the question only makes sense for one company, ask briefly which company they mean.
- If asked who you are or who you work for: you are a neutral market analyst for this research report and do not represent any company.
- Present facts for every brand the same way. Comparisons, gaps and potential are described from a neutral standpoint ("Kai leads 6 thanas, DTL 2"), never as "our competitor" or "beat them".
- When the user names a company and asks for options, you may give options for THAT company, labelled as such; otherwise give market-level takeaways only.

YOUR DATA (reach it only through the tools):
- Thana market sheet (564 thanas, 2025 field survey): fabricator shops, dealers, area development, other brands' condition, leading brand(s). Leader "SCOPE" means no brand leads yet (open market). The survey also recorded two fields ONLY for DTL: DTL dealers and DTL condition (Good / Average / Below Average / Bad). Describe these as DTL-specific survey fields; never use them to judge other brands. List filters weak / strong / no_dtl_dealer use these DTL-only fields.
- Market Development DNA survey (≈479 upazilas in 60 districts): market value, buyer sensitivity (price / quality / both), preferred thickness, distribution level, brands present, sales driver (dealer or brand), surveyed fabricators with yearly sale.
- Fabricator lists (≈13,000 merged, duplicates removed by phone), some with brand and yearly sale (in lac taka).
- Reported monthly sales by district (crore taka per month; not every district reported).
- National share model: 15 companies; market size and price per kg come from the website's Market Tree settings.
- potential_score is a brand-neutral market-potential score (shops × area development × open market); when a company is given it also accounts for whether that company already leads.

HOW TO WORK:
1. Understand what the user really wants, even if the question is vague, misspelled, Banglish, or has several parts. If a place or company is ambiguous, pick the most likely meaning, say which one you used, and continue.
2. Always call tools for every number. Never invent or estimate a figure the tools did not give you. If data is missing, say so plainly.
3. Reason like an independent market researcher: compare, find causes, connect signals (e.g. many shops + open market + price-sensitive buyers ⇒ a large, contestable market). Explain WHY, not only WHAT.
4. Use calculate for any arithmetic you show (shares, gaps, tonnes↔taka, growth targets).
5. When the user asks for a report, list or file, call the matching create_* tool; the page shows a download button. Never paste huge lists — summarise and offer the file.
6. Answer in the user's language: if they write Bangla or Banglish, answer in Bangla script (keep brand names and thana names in English). If they write English, answer in English.
7. Format: short paragraphs, **bold** key numbers, bullet points, and small markdown tables (max ~10 rows). Start with the direct answer, then the reasoning, then 2–4 concise takeaways (for the named company if one was named, otherwise market-level). Keep it tight; no filler.
8. Stay on the Bangladesh aluminium market. Politely decline unrelated requests. Findings are data-based; remind the user to verify in the field only when stakes are high.`;

const S = (type, description, extra = {}) => ({ type, description, ...extra });
const placeP = S('string', 'Division, district or thana in English or Bangla, e.g. "Rangpur", "Gaibandha district", "Savar", "রংপুর". Omit for all Bangladesh.');
const coP = S('string', 'Company/brand: DTL, Kai, Altech, Chunghua, Nikki, BTA, Star, PHP, Avesta, Aramit, Neo, Hengfeng, RFL-Falcon, Shanghai.');
const TOOLS = [{ functionDeclarations: [
  { name: 'get_market_overview', description: 'National market size (tonnes/month), price per kg, Kai+Altech rule, and every company share with estimated tonnes and crore taka per month.', parameters: { type: 'object', properties: {} } },
  { name: 'get_place_profile', description: 'Full profile of a division, district or thana: thanas, shops, dealers, reported sales, leading-brand counts, DNA buyer behaviour, open-market thanas, top market-potential thanas and biggest fabricators. Also includes DTL-only survey fields (DTL dealers, DTL condition counts, thanas with many shops but no DTL dealer).', parameters: { type: 'object', properties: { place: placeP }, required: ['place'] } },
  { name: 'get_company_profile', description: 'A company\'s national share, estimated tonnes and crore taka per month, rank, thanas it leads (by division and top districts), DNA presence and fabricator count. Optionally restricted to a place.', parameters: { type: 'object', properties: { company: coP, place: placeP }, required: ['company'] } },
  { name: 'list_thanas', description: 'List thanas with their numbers. filter: opportunity (ranked by market-potential score; brand-neutral, or for the given company), open_market (no brand leads), led_by (a company leads; give company), all. DTL-only survey filters: weak (DTL condition bad/below average), strong (DTL condition good), no_dtl_dealer (shops but no DTL dealer).', parameters: { type: 'object', properties: { place: placeP, filter: S('string', 'weak | strong | opportunity | no_dtl_dealer | open_market | led_by | all', { enum: ['weak', 'strong', 'opportunity', 'no_dtl_dealer', 'open_market', 'led_by', 'all'] }), company: coP, sort_by: S('string', 'shops | score | dealers', { enum: ['shops', 'score', 'dealers'] }), limit: S('integer', 'Max rows, default 15, max 60') }, required: ['filter'] } },
  { name: 'get_sales', description: 'Reported monthly and yearly sales (crore taka) by district, optionally only for one division, sorted high to low.', parameters: { type: 'object', properties: { division: S('string', 'Division name, optional') } } },
  { name: 'search_fabricators', description: 'Find fabricators (shop, owner, phone, thana, district, brand, yearly sale in lac). Returns the count and the top rows by sale.', parameters: { type: 'object', properties: { place: placeP, brand: coP, min_sale_lac: S('number', 'Minimum yearly sale in lac taka'), text: S('string', 'Free text: shop, owner or phone'), limit: S('integer', 'Rows to return, default 10, max 30') } } },
  { name: 'calculate', description: 'Evaluate an arithmetic expression exactly, e.g. "(0.25-0.202)*3500" or "500*1000*725/1e7". Supports + - * / ( ) and decimals.', parameters: { type: 'object', properties: { expression: S('string', 'The expression') }, required: ['expression'] } },
  { name: 'create_report_file', description: 'Prepare a downloadable market report for a place or a company: xlsx (multi-sheet Excel), html (designed report page, printable to PDF) or csv. The user gets a download button.', parameters: { type: 'object', properties: { place: placeP, company: coP, format: S('string', 'xlsx | html | csv', { enum: ['xlsx', 'html', 'csv'] }) } } },
  { name: 'create_fabricator_file', description: 'Prepare a downloadable fabricator list (xlsx or csv) filtered by place, brand and minimum yearly sale.', parameters: { type: 'object', properties: { place: placeP, brand: coP, min_sale_lac: S('number', 'Minimum yearly sale in lac'), format: S('string', 'xlsx | csv', { enum: ['xlsx', 'csv'] }) } } }
] }];

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// very light per-instance rate limit (protects the free quota from abuse)
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 60_000, max = 30;
  const a = (hits.get(ip) || []).filter(t => now - t < win); a.push(now); hits.set(ip, a);
  return a.length > max;
}

function cleanContents(contents) {
  if (!Array.isArray(contents) || !contents.length || contents.length > 60) return null;
  const out = [];
  for (const c of contents) {
    if (!c || (c.role !== 'user' && c.role !== 'model') || !Array.isArray(c.parts)) return null;
    const parts = [];
    for (const p of c.parts) {
      if (typeof p.text === 'string') parts.push(p.thoughtSignature ? { text: p.text.slice(0, 12000), thoughtSignature: p.thoughtSignature } : { text: p.text.slice(0, 12000) });
      else if (p.functionCall) parts.push(p);
      else if (p.functionResponse) parts.push({ functionResponse: { name: String(p.functionResponse.name), ...(p.functionResponse.id ? { id: p.functionResponse.id } : {}), response: p.functionResponse.response } });
    }
    if (parts.length) out.push({ role: c.role, parts });
  }
  return out;
}

async function callGemini(model, key, body, ms = 28000) {
  try {
    const r = await fetch(API + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms)
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    const to = String(e && e.name).includes('Timeout') || String(e).includes('timed out') || String(e).includes('aborted');
    return { ok: false, status: to ? 'timeout' : 'fetch_failed', data: { error: { message: to ? `no reply from ${model} within ${Math.round(ms / 1000)}s` : String(e).slice(0, 200) } } };
  }
}

// keep the connection alive with spaces while Gemini thinks, then send the JSON
// (leading spaces are valid JSON whitespace, so the browser parses it normally)
function streamJSON(work) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode(' '));
      const ka = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch { } }, 4000);
      let out;
      try { out = await work(); } catch (e) { out = { error: 'crash', message: String(e && e.message || e).slice(0, 300) }; }
      clearInterval(ka);
      ctrl.enqueue(enc.encode(JSON.stringify(out)));
      ctrl.close();
    }
  });
  return new Response(stream, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

// faster answers: keep "thinking" short (each tool step is a separate request)
const thinkFor = m => /gemini-2\.5/.test(m) ? { thinkingBudget: 1024 } : /gemini-[3-9]/.test(m) ? { thinkingLevel: 'low' } : null;
async function askModel(model, key, base, ms) {
  const t = thinkFor(model);
  let r = await callGemini(model, key, t ? { ...base, generationConfig: { ...base.generationConfig, thinkingConfig: t } } : base, ms);
  if (!r.ok && r.status === 400 && t && /think/i.test(JSON.stringify(r.data))) r = await callGemini(model, key, base, ms); // model does not take that setting
  return r;
}

export default async (req, context) => {
  const key = ENV('GEMINI_API_KEY');
  if (req.method === 'GET') {
    const u = new URL(req.url);
    if (u.searchParams.get('test')) {
      if (!key) return json({ configured: false });
      return streamJSON(async () => {
        const base = { systemInstruction: { parts: [{ text: SYSTEM }] }, tools: TOOLS, contents: [{ role: 'user', parts: [{ text: 'Reply only with the word OK.' }] }], generationConfig: { maxOutputTokens: 16384 } };
        const tests = await Promise.all([PRIMARY, ...FALLBACKS].map(async model => {
          const t0 = Date.now(); const r = await askModel(model, key, base, 25000);
          const reply = r.ok ? ((r.data.candidates || [])[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || (p.functionCall ? '[tool:' + p.functionCall.name + ']' : '')).join('').slice(0, 60) : '';
          return { model, status: r.status, seconds: +((Date.now() - t0) / 1000).toFixed(1), reply, error: r.ok ? null : String(r.data?.error?.message || '').slice(0, 220) };
        }));
        return { configured: true, key_prefix: key.slice(0, 4) + '…', working: tests.filter(t => t.status === 200).map(t => t.model), tests };
      });
    }
    return json({ ok: true, configured: !!key, model: PRIMARY, runtime: 'edge' });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!key) return json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set in Netlify.' }, 503);
  const ip = (context && context.ip) || 'x';
  if (limited(ip)) return json({ error: 'rate_limited', message: 'Too many questions in a minute.' }, 429);
  const raw = await req.text();
  if (raw.length > 400_000) return json({ error: 'too_large' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
  const contents = cleanContents(body.contents);
  if (!contents) return json({ error: 'bad_contents' }, 400);
  const base = {
    systemInstruction: { parts: [{ text: SYSTEM + (body.today ? `\nToday is ${String(body.today).slice(0, 40)}.` : '') }] },
    contents, tools: TOOLS,
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.4, maxOutputTokens: 16384 }
  };
  return streamJSON(async () => {
    let last = null; const tried = [];
    for (const model of [PRIMARY, ...FALLBACKS]) {
      const r = await askModel(model, key, base, 40000);
      tried.push(model + ':' + r.status);
      if (r.ok) {
        const cand = (r.data.candidates || [])[0];
        if (cand && cand.content && (cand.content.parts || []).length) return { model, content: cand.content, finishReason: cand.finishReason, usage: r.data.usageMetadata };
        last = { status: 'empty', data: { error: { message: 'empty reply (' + (cand && cand.finishReason) + ')' } } };
        continue;
      }
      last = r;
      if (![400, 403, 404, 429, 500, 503, 'timeout', 'fetch_failed'].includes(r.status)) break;
    }
    const msg = last && last.data && last.data.error ? last.data.error.message : 'Gemini request failed';
    return { error: last && last.status === 429 ? 'quota' : 'upstream', status: last && last.status, message: msg, tried };
  });
};

export const config = { path: '/api/ask' };
