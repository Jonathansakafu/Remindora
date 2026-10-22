import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy for /auth/* on the hosted web build (NEXT_PUBLIC_AUTH_SAME_ORIGIN=1).
 * The refresh cookie is SameSite=Lax, so when the web and API live on different sites it
 * only works if the browser sees it as first-party. Only built when not exporting for desktop
 * (the .web.ts extension is enabled in next.config.ts).
 */
export const dynamic = 'force-dynamic';

const FORWARD_REQUEST = ['content-type', 'authorization', 'origin', 'cookie', 'user-agent', 'x-remindora-csrf'];

/** The edge proxy appends the real client address last; anything before it is client-supplied. */
function clientIp(req: NextRequest) {
  const xff = req.headers.get('x-forwarded-for');
  return xff?.split(',').pop()?.trim() || null;
}

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const upstream = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!upstream) return Response.json({ error: { code: 'not_configured', message: 'API is not configured' } }, { status: 501 });
  const { path } = await params;

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = clientIp(req);
  if (ip) headers.set('x-forwarded-for', ip);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const res = await fetch(`${upstream.replace(/\/$/, '')}/auth/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  const out = new Headers();
  for (const h of ['content-type', 'location', 'retry-after', 'cache-control']) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
