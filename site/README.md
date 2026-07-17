# Bimax launch site

A Vite + React landing page for the unshipped Bimax desktop app and CLI. The page presents both as
coming soon, shows the real product UI, and collects early-access emails through a Supabase Edge
Function backed by a protected Postgres table.

## Local development

```bash
npm install
npm run dev
npm run build
```

The waitlist form talks to the deployed Supabase Edge Function, so local submissions use the same
guarded endpoint as production.

## Connect Supabase

The production project is `ougqqtvmmwqxlrnxncvf` in Supabase region `ap-south-1`.

1. Apply `supabase/migrations/202607130001_create_waitlist.sql`.
2. Deploy `supabase/functions/waitlist/index.ts` with JWT verification enabled.
3. Submit a test email and confirm the row appears in `public.waitlist`.

The service-role key stays inside Supabase's Edge Function runtime and is never bundled into the
browser or copied into Vercel. The table has row-level security enabled, grants no browser role
access, normalizes emails in the function, ignores duplicate signups, uses a honeypot, checks browser
origins, and applies a lightweight per-instance request limit.

## Vercel

Keep this directory inside the Bimax repository for the first launch. Create the Vercel project with
`site` as its Root Directory. Vercel will use `vercel.json`, run `npm run build`, and publish `dist`.

Before production, confirm the custom domain is `bimax.app`; the canonical URL, Open Graph URL,
robots file, and sitemap currently use that domain.
