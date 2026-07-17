create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  email text not null,
  source text not null default 'website',
  referrer text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint waitlist_email_length check (char_length(email) between 3 and 254),
  constraint waitlist_email_normalized check (email = lower(trim(email))),
  constraint waitlist_email_unique unique (email)
);

comment on table public.waitlist is 'Early-access signups collected by the Bimax website.';
comment on column public.waitlist.source is 'Placement that submitted the signup, such as hero or final.';

alter table public.waitlist enable row level security;

revoke all on table public.waitlist from anon, authenticated;
grant insert on table public.waitlist to service_role;
grant usage, select on sequence public.waitlist_id_seq to service_role;

create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);
