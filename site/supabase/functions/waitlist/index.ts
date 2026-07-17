import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const attempts = new Map<string, number[]>();

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  try {
    const { hostname, protocol } = new URL(origin);
    const local = protocol === 'http:' && (hostname === '127.0.0.1' || hostname === 'localhost');
    const production = protocol === 'https:' && (hostname === 'bimax.app' || hostname === 'www.bimax.app');
    const vercel = protocol === 'https:' && hostname.endsWith('.vercel.app');
    return local || production || vercel ? origin : false;
  } catch {
    return false;
  }
}

function responseHeaders(request: Request) {
  const origin = allowedOrigin(request);
  return {
    'Access-Control-Allow-Origin': typeof origin === 'string' ? origin : 'https://bimax.app',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  };
}

function json(request: Request, status: number, body: { message: string }) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : null;
}

function isRateLimited(request: Request) {
  const now = Date.now();
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const recent = (attempts.get(client) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  recent.push(now);
  attempts.set(client, recent);

  if (attempts.size > 2_000) {
    for (const [key, timestamps] of attempts) {
      if (!timestamps.some((timestamp) => now - timestamp < WINDOW_MS)) attempts.delete(key);
    }
  }

  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

Deno.serve(async (request: Request) => {
  const origin = allowedOrigin(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: origin === false ? 403 : 204, headers: responseHeaders(request) });
  }

  if (request.method !== 'POST') return json(request, 405, { message: 'Use the waitlist form to join.' });
  if (origin === false) return json(request, 403, { message: 'This signup request is not allowed.' });
  if (isRateLimited(request)) {
    return json(request, 429, { message: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(request, 400, { message: 'That request could not be read. Please try again.' });
  }

  // Quietly accept honeypot submissions so simple bots do not learn how they were detected.
  if (cleanText(body.website, 200)) {
    return json(request, 200, { message: "You're on the list. We'll email you when early access opens." });
  }

  const email = cleanText(body.email, 254)?.toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return json(request, 400, { message: 'Enter a valid email address.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Supabase runtime credentials are unavailable.');
    return json(request, 503, { message: 'The waitlist is being connected. Please try again shortly.' });
  }

  const insert = await fetch(`${supabaseUrl}/rest/v1/waitlist?on_conflict=email`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({
      email,
      source: body.source === 'final' ? 'final' : 'hero',
      referrer: cleanText(body.referrer, 500),
      user_agent: cleanText(request.headers.get('user-agent'), 500),
    }),
  });

  if (!insert.ok) {
    console.error('Waitlist insert failed.', insert.status, (await insert.text()).slice(0, 500));
    return json(request, 502, { message: 'We could not save your email. Please try again.' });
  }

  return json(request, 200, { message: "You're on the list. We'll email you when early access opens." });
});
