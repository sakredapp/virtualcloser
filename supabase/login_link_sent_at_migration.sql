-- Login-link invites (admin "Send login link", one-click onboarding, the
-- /onboard sign + paid paths). Stamped when a "Your login is ready" email is
-- claimed for a member; a second send to the same member inside 2 minutes is
-- refused (double-click guard). Additive and nullable.
alter table public.members add column if not exists login_link_sent_at timestamptz;

-- The /onboard sign step keeps the signer's IP + user agent on the token so
-- the paid path (Stripe webhook, no request context) can record the
-- signature with them too.
alter table public.onboarding_tokens add column if not exists signed_ip text;
alter table public.onboarding_tokens add column if not exists signed_user_agent text;
