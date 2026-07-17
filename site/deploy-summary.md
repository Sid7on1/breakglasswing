# Bimax launch summary

Launched on July 13, 2026.

## Production

- Live URL: https://bimax-liard.vercel.app
- Vercel project: `bimax`
- Vercel project ID: `prj_lAXqY5UrjZw80jorxZKTk224grlm`
- Vercel team: `Sid Vish's projects` (`team_T2mZ4xDg8LNKvmhvU35X98tm`)
- Deployment ID: `dpl_9bk7WmNeMPTy9YnpEAAqbtZcUhs6`
- Deployment inspector: https://vercel.com/sid-vishs-projects/bimax/9bk7WmNeMPTy9YnpEAAqbtZcUhs6
- Deployment state: `READY`
- Source revision: `878748285c3c435f0302ebcd20748c3fe274ad39` with the current local site changes included by the Vercel CLI

## Waitlist backend

- Supabase project: `Bimax`
- Project ref: `ougqqtvmmwqxlrnxncvf`
- Region: `ap-south-1`
- Edge Function: `waitlist` version 1 (`ACTIVE`)
- Endpoint: https://ougqqtvmmwqxlrnxncvf.supabase.co/functions/v1/waitlist
- Database table: `public.waitlist` with row-level security enabled

## Verification

- Vercel production build completed successfully with Vite 5.4.21.
- Production page returned HTTP 200 with the expected security headers and assets.
- Vercel reported no runtime error clusters after launch.
- A real signup request using the production Vercel origin returned HTTP 200.
- The signup was confirmed in `public.waitlist`; the synthetic test record was deleted afterward.
- Local production build and visual QA passed without broken images, horizontal overflow, or browser console errors.

## Remaining optional step

The custom domain `bimax.app` is referenced in site metadata but has not been connected to this Vercel project. The current production address is the Vercel URL above.
