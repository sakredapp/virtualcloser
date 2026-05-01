-- AI Dialer liability agreement.
--
-- Anyone with the AI dialer feature must sign a liability agreement before
-- their FIRST visit to /dashboard/dialer/*. The agreement covers:
--   - Compliance use (announce AI in all states, announce recording)
--   - Misuse liability (client owns it, platform excluded from lawsuits)
--   - Scope of service (we provide the dialer, client controls the calls)
--
-- Each signature is per-member (not per-tenant) so every rep on an
-- enterprise account signs their own copy. Re-signing is required when the
-- agreement_version is bumped server-side.
--
-- A snapshot PDF is rendered at sign time and uploaded to the
-- liability-agreements storage bucket so we always have the exact text the
-- member agreed to, even if the live copy is later edited.

create table if not exists liability_agreements (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  member_id           uuid not null references members(id) on delete cascade,
  agreement_version   text not null,
  -- Full name they typed as their signature.
  signature_name      text not null,
  -- Snapshot of the agreement text at sign time. Useful as a fallback if
  -- the PDF generator fails or the bucket is unreachable.
  agreement_text      text not null,
  -- Signed PDF stored in the 'liability-agreements' Supabase Storage bucket.
  -- Path format: {rep_id}/{member_id}/{id}.pdf
  pdf_storage_path    text,
  signed_at           timestamptz not null default now(),
  signed_ip           inet,
  signed_user_agent   text,
  created_at          timestamptz default now(),
  -- One signed copy per (member, version). Re-signing the same version is
  -- a no-op — bump the version constant in lib/liabilityAgreement.ts to
  -- force re-signing for material changes.
  unique (member_id, agreement_version)
);

create index if not exists liability_agreements_rep_idx
  on liability_agreements(rep_id);
create index if not exists liability_agreements_member_idx
  on liability_agreements(member_id);

-- Storage bucket — created via Supabase Studio (CREATE BUCKET in SQL is not
-- supported across all instances). After running this migration:
--
--   1. Studio → Storage → New bucket → name: liability-agreements
--      visibility: private (signed URLs only)
--   2. Confirm the bucket exists before letting members try to sign.
--
-- The signing server action enforces auth before generating signed URLs,
-- so private is the right setting.
