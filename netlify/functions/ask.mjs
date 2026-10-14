// Netlify Function: AI Market Analyst — thin, safe proxy to Google Gemini.
// The API key lives only here (Netlify environment variable GEMINI_API_KEY).
// The browser sends the conversation; this function adds the analyst's
// instructions and tool list, calls Gemini, and returns its reply.
// The tools themselves run in the browser on the report data.

const PRIMARY = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash-lite,gemini-3.6-flash')
  .split(',').map(s => s.trim()).filter(Boolean);
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';

const SYSTEM = `You are "বাজার বিশ্লেষক" (Market Analyst), the in-house market analyst for Dhakathai Alcomaxx PLC (brand short name DTL), a Bangladesh aluminium profile maker that sells only through dealers to fabricators. "We", "us", "our", "amra", "amader", "আমরা", "আমাদের" always mean DTL.

YOUR DATA (reach it only through the tools):
- Thana market sheet (564 thanas, 2025 field survey): fabricator shops, dealers, DTL dealers, area development, competitor condition, leading brand(s), DTL condition (Good / Average / Below Average / Bad). Leader "SCOPE" means no brand leads yet (open market).
- Market Development DNA survey (≈479 upazilas in 60 districts): market value, buyer sensitivity (price / quality / both), preferred thickness, distribution level, brands present, sales driver (dealer or brand), surveyed fabricators with yearly sale.
- Fabricator lists (≈13,000 merged, duplicates removed by phone), some with brand and yearly sale (in lac taka).
- Reported monthly sales by district (crore taka per month; not every district reported).
- National share model: 15 companies; market size and price per kg come from the website's Market Tree settings.

HOW TO WORK:
1. Understand what the user really wants, even if the question is vague, misspelled, Banglish, or has several parts. If a place or company is ambiguous, pick the most likely meaning, say which one you used, and continue.
2. Always call tools for every number. Never invent or estimate a figure the tools did not give you. If data is missing, say so plainly.
3. Reason like a sales strategist: compare, find causes, connect signals (e.g. many shops + no DTL dealer + Kai leading + price-sensitive buyers ⇒ appoint a dealer and run a price-led scheme). Explain WHY, not only WHAT.
4. Use calculate for any arithmetic you show (shares, gaps, tonnes↔taka, growth targets).
5. When the user asks for a report, list or file, call the matching create_* tool; the page shows a download button. Never paste huge lists — summarise and offer the file.
6. Answer in the user's language: if they write Bangla or Banglish, answer in Bangla script (keep brand names and thana names in English). If they write English, answer in English.
7. Format: short paragraphs, **bold** key numbers, bullet points, and small markdown tables (max ~10 rows). Start with the direct answer, then the reasoning, then 2–4 concrete action points. Keep it tight; no filler.
8. Stay on the Bangladesh aluminium market and this business. Politely decline unrelated requests. Recommendations are data-based; remind the user to verify in the field only when stakes are high.`;

const S = (type, description, extra = {}) => ({ type, description, ...extra });
const placeP = S('string', 'Division, district or thana in English or Bangla, e.g. "Rangpur", "Gaibandha district", "Savar", "রংপুর". Omit for all Bangladesh.');
const coP = S('string', 'Company/brand: DTL, Kai, Altech, Chunghua, Nikki, BTA, Star, PHP, Avesta, Aramit, Neo, Hengfeng, RFL-Falcon, Shanghai.');
const TOOLS = [{ functionDeclarations: [
  { name: 'get_market_overview', description: 'National market size (tonnes/month), price per kg, Kai+Altech rule, and every company share with estimated tonnes and crore taka per month.', parameters: { type: 'object', properties: {} } },
  { name: 'get_place_profile', description: 'Full profile of a division, district or thana: thanas, shops, dealers, DTL dealers, reported sales, DTL condition counts, leading-brand counts, DNA buyer behaviour, open-market thanas, thanas with many shops but no DTL dealer, top opportunity thanas and biggest fabricators.', parameters: { type: 'object', properties: { place: placeP }, required: ['place'] } },
  { name: 'get_company_profile', description: 'A company\'s national share, estimated tonnes and crore taka per month, rank, thanas it leads (by division and top districts), DNA presence and fabricator count. Optionally restricted to a place.', parameters: { type: 'object', properties: { company: coP, place: placeP }, required: ['company'] } },
  { name: 'list_thanas', description: 'List thanas with their numbers. filter: weak (DTL bad/below average), strong (DTL good), opportunity (ranked by opportunity score), no_dtl_dealer (shops but no DTL dealer), open_market (no brand leads), led_by (a company leads; give company), all.', parameters: { type: 'object', properties: { place: placeP, filter: S('string', 'weak | strong | opportunity | no_dtl_dealer | open_market | led_by | all', { enum: ['weak', 'strong', 'opportunity', 'no_dtl_dealer', 'open_market', 'led_by', 'all'] }), company: coP, sort_by: S('string', 'shops | score | dealers', { enum: ['shops', 'score', 'dealers'] }), limit: S('integer', 'Max rows, default 15, max 60') }, required: ['filter'] } },
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

async function callGemini(model, key, body) {
  const r = await fetch(API + encodeURIComponent(model) + ':generateContent', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export default async (req, context) => {
  const key = process.env.GEMINI_API_KEY;
  if (req.method === 'GET') return json({ ok: true, configured: !!key, model: PRIMARY });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!key) return json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set in Netlify.' }, 503);
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'x';
  if (limited(ip)) return json({ error: 'rate_limited', message: 'Too many questions in a minute.' }, 429);
  const raw = await req.text();
  if (raw.length > 400_000) return json({ error: 'too_large' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
  const contents = cleanContents(body.contents);
  if (!contents) return json({ error: 'bad_contents' }, 400);

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM + (body.today ? `\nToday is ${String(body.today).slice(0, 40)}.` : '') }] },
    contents, tools: TOOLS,
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
  };
  let last = null;
  for (const model of [PRIMARY, ...FALLBACKS]) {
    try {
      const r = await callGemini(model, key, payload);
      if (r.ok) {
        const cand = (r.data.candidates || [])[0];
        if (!cand || !cand.content) return json({ error: 'empty', finishReason: cand && cand.finishReason, model }, 502);
        return json({ model, content: cand.content, finishReason: cand.finishReason, usage: r.data.usageMetadata });
      }
      last = r;
      if (![404, 429, 500, 503].includes(r.status)) break; // only fall back on availability / quota errors
    } catch (e) { last = { status: 502, data: { error: { message: String(e) } } }; }
  }
  const msg = last && last.data && last.data.error ? last.data.error.message : 'Gemini request failed';
  return json({ error: last && last.status === 429 ? 'quota' : 'upstream', status: last && last.status, message: msg }, last && last.status === 429 ? 429 : 502);
};

export const config = { path: '/api/ask' };
