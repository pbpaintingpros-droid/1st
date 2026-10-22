-- PB Production Hub — initial schema (Stage 1)
-- Works on Supabase Postgres and on the built-in local database.
-- All money is stored as integer cents. Never floats.


-- ---------------------------------------------------------------------------
-- Subcontractors
-- ---------------------------------------------------------------------------
create table subcontractors (
  id                  uuid primary key default gen_random_uuid(),
  company_name        text not null,
  contact_name        text not null,
  phone               text,
  email               text,
  status              text not null default 'prospect'
                      check (status in ('prospect','onboarding','active','paused','inactive')),
  skills              text[] not null default '{}',     -- service keys, e.g. 'interior','exterior','cabinets'
  service_areas       text[] not null default '{}',     -- city names, lowercase
  crew_size           int,
  max_active_jobs     int not null default 2 check (max_active_jobs >= 0),
  quality_rating      int check (quality_rating between 1 and 5),
  internal_notes      text,                              -- never shown to the sub
  source              text not null default 'manual',     -- manual | import | sample
  external_ref        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Uploaded files (insurance certificates, W-9s, job photos). Stored in the DB so
-- every download goes through the app's permission checks.
create table files (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null,
  content_type  text not null,
  size_bytes    int not null,
  data          bytea not null,
  uploaded_by   uuid,
  created_at    timestamptz not null default now()
);

create table sub_documents (
  id              uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,
  doc_type        text not null
                  check (doc_type in ('general_liability','workers_comp','workers_comp_exemption','w9','sub_agreement','contractor_license','other')),
  file_id         uuid references files(id),
  expires_on      date,
  verified_by     uuid,
  verified_at     timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);
create index on sub_documents (subcontractor_id);

create table onboarding_steps (
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,
  step            text not null,
  completed_at    timestamptz,
  completed_by    uuid,
  primary key (subcontractor_id, step)
);

-- ---------------------------------------------------------------------------
-- Users & sessions
-- ---------------------------------------------------------------------------
create table users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,
  name              text not null,
  role              text not null check (role in ('owner','coordinator','sub')),
  subcontractor_id  uuid references subcontractors(id),
  password_hash     text not null,
  active            boolean not null default true,
  failed_logins     int not null default 0,
  locked_until      timestamptz,
  created_at        timestamptz not null default now(),
  -- a sub login must be tied to exactly one subcontractor; staff logins must not be
  check ((role = 'sub') = (subcontractor_id is not null))
);

create table sessions (
  token_hash  text primary key,              -- sha256 of the cookie token; raw token is never stored
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index on sessions (user_id);

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
create table jobs (
  id                    uuid primary key default gen_random_uuid(),
  job_number            text not null unique,
  customer_name         text not null,
  customer_phone        text,
  address               text not null,
  city                  text not null,
  zip                   text,
  services              text[] not null default '{}',
  title                 text not null,
  work_order            text,                        -- crew-facing scope of work
  internal_notes        text,                        -- never shown to subs
  contract_amount_cents bigint check (contract_amount_cents >= 0),   -- customer price (confidential)
  target_payout_cents   bigint check (target_payout_cents >= 0),     -- PB's payout guideline (confidential)
  proposed_start        date,
  proposed_end          date,
  estimated_days        numeric(5,1),
  deposit_received      boolean not null default false,
  colors_confirmed      boolean not null default false,
  status                text not null default 'draft'
                        check (status in ('draft','ready','offering','assigned','in_progress','complete','cancelled')),
  assigned_sub_id       uuid references subcontractors(id),
  assigned_payout_cents bigint,
  scheduled_start       date,
  scheduled_end         date,
  source                text not null default 'manual',
  external_ref          text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table job_photos (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  file_id         uuid references files(id),
  external_url    text,                       -- e.g. CompanyCam, once verified
  caption         text,
  share_with_crew boolean not null default true,
  created_at      timestamptz not null default now()
);
create index on job_photos (job_id);

-- ---------------------------------------------------------------------------
-- Private offers (one per job per sub) and the sub's responses
-- ---------------------------------------------------------------------------
create table offers (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references jobs(id) on delete cascade,
  subcontractor_id uuid not null references subcontractors(id),
  payout_cents     bigint not null check (payout_cents > 0),
  proposed_start   date,
  proposed_end     date,
  note_to_sub      text,
  status           text not null default 'draft'
                   check (status in ('draft','sent','accepted','declined','countered','walkthrough_requested','awarded','not_selected','withdrawn')),
  created_by       uuid not null references users(id),
  sent_by          uuid references users(id),
  sent_at          timestamptz,
  first_viewed_at  timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (job_id, subcontractor_id)
);
create index on offers (subcontractor_id);

create table offer_responses (
  id                 uuid primary key default gen_random_uuid(),
  offer_id           uuid not null references offers(id) on delete cascade,
  kind               text not null
                     check (kind in ('accept','decline','walkthrough_request','start_date','counteroffer')),
  amount_cents       bigint check (amount_cents > 0),
  suggested_start    date,
  note               text,
  created_by         uuid not null references users(id),
  created_at         timestamptz not null default now(),
  -- internal review (counteroffers need owner approval)
  review_status      text not null default 'none' check (review_status in ('none','pending','approved','rejected')),
  coordinator_note   text,
  reviewed_by        uuid references users(id),
  reviewed_at        timestamptz,
  review_note        text
);
create index on offer_responses (offer_id);

-- ---------------------------------------------------------------------------
-- Audit log (append-only), notifications, settings, outbound message queue
-- ---------------------------------------------------------------------------
create table audit_log (
  id           bigserial primary key,
  actor_id     uuid,
  actor_role   text,
  action       text not null,
  entity_type  text not null,
  entity_id    text not null,
  job_id       uuid,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);
create index on audit_log (entity_type, entity_id);
create index on audit_log (job_id);

create function audit_log_is_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_is_append_only();

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on notifications (user_id, read_at);

create table settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

-- Anything that would leave the building (SMS, email, CRM write-back) is queued here.
-- Nothing is sent until an owner approves AND OUTBOUND_MESSAGING_ENABLED=true.
create table outbox (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null,        -- sms | email | dripjobs | google_sheets ...
  recipient    text,
  payload      jsonb not null,
  status       text not null default 'pending_approval'
               check (status in ('pending_approval','approved','sent','cancelled','failed')),
  created_by   uuid,
  approved_by  uuid,
  created_at   timestamptz not null default now()
);

create table import_batches (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('jobs','subcontractors')),
  file_name   text,
  row_count   int not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
