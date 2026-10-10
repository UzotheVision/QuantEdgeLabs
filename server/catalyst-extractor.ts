/**
 * CATALYST EXTRACTOR — dated forward commitments, pulled out of filings.
 *
 * stockcatalysts.ai's per-ticker timeline carries the things a price feed cannot
 * know: "FTC appeal reply brief due Sep 29", "Meta Connect 2026", "Q3 print tests
 * $61-64B guide". I previously said that layer needed curation or a news pipeline
 * we did not have. That was wrong on both counts — SEC EDGAR is free and needs no
 * key, 8-Ks and 10-Qs are exactly where companies state dated commitments, and
 * the LLM keys in this project are live.
 *
 * The method is deliberately narrow: an LLM reads filing text and returns ONLY
 * items with an explicit future date attached. It is not asked to summarise, to
 * assess, or to predict — three things it does confidently and badly. Extraction
 * of stated facts is the one task where its failure mode (missing something) is
 * safer than the alternative (inventing something).
 *
 * Everything returned carries the filing it came from, so any claim can be traced
 * back to a primary source rather than trusted because a model said it.
 */
import { logger } from './logger';

export interface ExtractedCatalyst {
  date: string;              // YYYY-MM-DD
  title: string;
  kind: 'legal' | 'regulatory' | 'product' | 'guidance' | 'corporate' | 'other';
  /** Verbatim phrase the date came from — makes the claim auditable. */
  evidence: string;
  sourceForm: string;
  sourceUrl: string;
  filedAt: string;
}

const SEC_UA = 'QuantEdge Research abdulmalikajisegiri@gmail.com';

/** SEC needs the zero-padded CIK, which its own ticker map provides. */
async function cikFor(symbol: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': SEC_UA },
    });
    if (!r.ok) return null;
    const map: any = await r.json();
    const hit = Object.values(map).find((v: any) => String(v.ticker).toUpperCase() === symbol.toUpperCase());
    return hit ? String((hit as any).cik_str).padStart(10, '0') : null;
  } catch {
    return null;
  }
}

interface FilingRef { form: string; date: string; url: string }

async function recentFilings(symbol: string, limit = 4): Promise<FilingRef[]> {
  const cik = await cikFor(symbol);
  if (!cik) return [];
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': SEC_UA },
    });
    if (!r.ok) return [];
    const j: any = await r.json();
    const rec = j?.filings?.recent;
    if (!rec) return [];

    const out: FilingRef[] = [];
    for (let i = 0; i < rec.form.length && out.length < limit; i++) {
      if (!['8-K', '10-Q', '10-K'].includes(rec.form[i])) continue;
      const acc = String(rec.accessionNumber[i]).replace(/-/g, '');
      out.push({
        form: rec.form[i],
        date: rec.filingDate[i],
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${rec.primaryDocument[i]}`,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Filing HTML → plain text, trimmed to what an LLM can usefully read. */
async function filingText(url: string, maxChars = 18_000): Promise<string> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': SEC_UA } });
    if (!r.ok) return '';
    const html = await r.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars);
  } catch {
    return '';
  }
}

const PROMPT = `You are extracting DATED FORWARD COMMITMENTS from an SEC filing.

Return ONLY events that have an explicit future date or a clearly stated future
period. Do not summarise the filing. Do not infer, estimate, or predict. If the
filing states no dated future commitments, return an empty array — that is a
correct and expected answer.

Include: court dates, hearing and brief deadlines, regulatory decision dates,
scheduled product launches or conferences, guidance periods with figures,
shareholder meetings, closing dates for announced transactions.

Exclude: anything already past, anything without a date, routine boilerplate,
and risk-factor language.

Return strict JSON, no prose, no markdown fence:
{"catalysts":[{"date":"YYYY-MM-DD","title":"short specific phrase","kind":"legal|regulatory|product|guidance|corporate|other","evidence":"the verbatim sentence fragment containing the date"}]}

If a date is stated as a period rather than a day (e.g. "second half of 2026"),
use the first day of that period and say so in the title.`;

export async function extractCatalysts(symbol: string, maxFilings = 3): Promise<ExtractedCatalyst[]> {
  const sym = symbol.toUpperCase();
  const filings = await recentFilings(sym, maxFilings);
  if (!filings.length) {
    logger.debug(`[CATALYST-EXTRACT] no filings for ${sym}`);
    return [];
  }

  const { generateAI } = await import('./multi-llm-service');
  const today = new Date().toISOString().slice(0, 10);
  const out: ExtractedCatalyst[] = [];

  for (const f of filings) {
    const text = await filingText(f.url);
    if (text.length < 500) continue;

    try {
      const raw = await generateAI(
        `Today is ${today}. Filing: ${f.form} filed ${f.date}.\n\n---\n${text}`,
        { system: PROMPT, mode: 'fallback', strategy: 'cheap' },
      );

      const body = String(raw ?? '');
      const match = body.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);

      for (const c of parsed?.catalysts ?? []) {
        // Trust nothing structural. A model that returns a past date, or a date
        // it invented, must not reach the board just because it answered.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(c?.date ?? '')) continue;
        if (c.date < today) continue;
        if (!c.title || !c.evidence) continue;
        out.push({
          date: c.date,
          title: String(c.title).slice(0, 160),
          kind: ['legal', 'regulatory', 'product', 'guidance', 'corporate'].includes(c.kind) ? c.kind : 'other',
          evidence: String(c.evidence).slice(0, 300),
          sourceForm: f.form,
          sourceUrl: f.url,
          filedAt: f.date,
        });
      }
    } catch (err: any) {
      logger.warn(`[CATALYST-EXTRACT] ${sym} ${f.form}: ${err?.message ?? err}`);
    }
  }

  // Same date + same title from two filings is one event restated.
  const seen = new Set<string>();
  const deduped = out.filter((c) => {
    const k = `${c.date}|${c.title.slice(0, 40).toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  deduped.sort((a, b) => a.date.localeCompare(b.date));
  logger.info(`[CATALYST-EXTRACT] ${sym}: ${deduped.length} dated commitments from ${filings.length} filing(s)`);
  return deduped;
}
