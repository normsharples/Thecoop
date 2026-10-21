-- ============================================================================
-- 094. ONBOARDING  (new-hire intake by invite link — no email, no account)
-- ----------------------------------------------------------------------------
-- HOW THIS RELATES TO MIGRATION 063
-- ORBIT already has an onboarding system (063–066): it gates an *existing
-- login* on first use, collects tax/super/bank into employee_sensitive, and
-- issues an employment contract to sign. That system assumes the person
-- already has an account.
--
-- This module sits in front of it. A manager adds a hire who has no account
-- and no email address; the hire fills everything in from a link on their
-- phone; a profile is created only at the end. The two are complementary and
-- this migration does not alter a single table from 063.
--
-- WHAT IS DELIBERATELY NOT STORED HERE
-- No tax file number and no bank details. The payroll step links out to the
-- brand's own payroll onboarding URL and records only "I've done it". That is
-- the whole point of the step — ORBIT is not the system of record for payroll
-- identity data. (063's employee_sensitive still holds those for the accounts
-- that went through the older flow; nothing here adds to it.)
--
-- THE TOKEN MODEL
-- The hire is unauthenticated, so the invite token *is* their credential.
-- new_hires has no anon-readable policy at all. Everything the hire does goes
-- through a SECURITY DEFINER function that takes the token as its first
-- argument, resolves exactly one row from it, and refuses once the hire is
-- past 'in_progress' or the invite has expired. The token is 64 hex characters
-- (two uuid v4s) so it is not guessable, and it is never put in a page title,
-- a query string we log, or an audit detail blob.
--
-- Safe to re-run.
-- ============================================================================

-- ── Brand setting: where payroll onboarding actually happens ────────────────
alter table public.brands
  add column if not exists payroll_onboarding_url text;

-- ============================================================================
-- BRAND TEMPLATES  (Settings → Brands → Team)
-- ============================================================================

-- Policy documents the hire ticks and types their name against.
create table if not exists public.brand_policy_documents (
  id         uuid        primary key default uuid_generate_v4(),
  brand_id   uuid        not null references public.brands(id) on delete cascade,
  title      text        not null,
  -- Either paste the policy text, or point at a hosted copy. Both is fine.
  body       text,
  url        text,
  version    integer     not null default 1,
  required   boolean     not null default true,
  sort_order integer     not null default 0,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Manager-side induction checklist.
create table if not exists public.brand_onboarding_checklist_items (
  id          uuid        primary key default uuid_generate_v4(),
  brand_id    uuid        not null references public.brands(id) on delete cascade,
  label       text        not null,
  description text,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- Which certificates this brand asks for, and which it insists on.
create table if not exists public.brand_certificate_requirements (
  id         uuid        primary key default uuid_generate_v4(),
  brand_id   uuid        not null references public.brands(id) on delete cascade,
  kind       text        not null,          -- 'rsa' | 'food_handler' | free text
  label      text        not null,
  required   boolean     not null default false,
  needs_expiry boolean   not null default true,
  sort_order integer     not null default 0,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  unique (brand_id, kind)
);

-- PLACEHOLDER TRAINING LIST. ORBIT has no training/academy module: the only
-- training data that exists today is station_training (migration 058), which
-- is a proficiency matrix a manager fills in, not a set of modules you can
-- assign to someone. So this is a brand-configurable list of named modules
-- with an optional link, and assignment records a status and nothing more.
-- Swap it for the real integration when there is one.
create table if not exists public.brand_training_modules (
  id          uuid        primary key default uuid_generate_v4(),
  brand_id    uuid        not null references public.brands(id) on delete cascade,
  name        text        not null,
  description text,
  url         text,
  required    boolean     not null default true,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- ── RLS for the four template tables: read in-brand, write brand admin ──────
do $$
declare t text;
begin
  foreach t in array array[
    'brand_policy_documents',
    'brand_onboarding_checklist_items',
    'brand_certificate_requirements',
    'brand_training_modules'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (brand_id in (select b from public.my_brand_ids() b))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.has_brand_admin(brand_id))',
      t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update using (public.has_brand_admin(brand_id))',
      t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete using (public.has_brand_admin(brand_id))',
      t || '_delete', t);
  end loop;
end $$;

drop trigger if exists brand_policy_documents_updated_at on public.brand_policy_documents;
create trigger brand_policy_documents_updated_at
  before update on public.brand_policy_documents
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- NEW HIRES
-- ============================================================================
create or replace function public.new_hire_token()
returns text language sql volatile as $$
  select replace(uuid_generate_v4()::text, '-', '')
      || replace(uuid_generate_v4()::text, '-', '');
$$;

create table if not exists public.new_hires (
  id                 uuid        primary key default uuid_generate_v4(),
  brand_id           uuid        not null references public.brands(id)      on delete cascade,
  restaurant_id      uuid        not null references public.restaurants(id) on delete cascade,

  -- What the manager enters
  full_name          text        not null,
  mobile             text        not null,
  role               text        not null default 'team_member'
                                 check (role in ('team_member', 'staff', 'shift_supervisor', 'manager')),
  position_title     text,
  start_date         date,

  status             text        not null default 'invited'
                                 check (status in ('invited', 'in_progress', 'ready', 'active')),

  -- The hire's credential. Never shown to anyone but the manager who invited
  -- them (so they can hand over the link or QR code).
  invite_token       text        not null unique default public.new_hire_token(),
  invite_expires_at  timestamptz not null default now() + interval '30 days',
  invite_opened_at   timestamptz,

  -- Step 1 — personal details + emergency contact
  preferred_name     text,
  legal_first_name   text,
  legal_last_name    text,
  date_of_birth      date,
  email              text,
  address_line1      text,
  address_line2      text,
  suburb             text,
  address_state      text,
  postcode           text,
  emergency_name     text,
  emergency_relationship text,
  emergency_phone    text,

  -- Step flags — all recomputed server-side by new_hire_recalc()
  details_complete      boolean  not null default false,
  certificates_complete boolean  not null default false,
  policies_complete     boolean  not null default false,
  payroll_confirmed     boolean  not null default false,
  payroll_confirmed_at  timestamptz,
  checklist_complete    boolean  not null default false,

  current_step       smallint    not null default 1,
  submitted_at       timestamptz,
  ready_at           timestamptz,

  -- Linked once a login exists for them.
  profile_id         uuid        references public.profiles(id) on delete set null,
  first_worked_date  date,
  activated_at       timestamptz,

  notes              text,
  created_by         uuid        references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_new_hires_venue   on public.new_hires(restaurant_id, status);
create index if not exists idx_new_hires_brand   on public.new_hires(brand_id, status);
create index if not exists idx_new_hires_profile on public.new_hires(profile_id);

alter table public.new_hires enable row level security;

-- Venue managers see their venues' hires; brand admins see the brand's; the
-- person themselves sees their own row once they have a login. There is no
-- policy that an unauthenticated caller can satisfy — the invite flow goes
-- through the token functions instead.
drop policy if exists "new_hires_select" on public.new_hires;
create policy "new_hires_select" on public.new_hires
  for select using (
    public.has_roster_manage(restaurant_id)
    or public.has_brand_admin(brand_id)
    or profile_id = auth.uid()
  );
drop policy if exists "new_hires_insert" on public.new_hires;
create policy "new_hires_insert" on public.new_hires
  for insert with check (public.has_roster_manage(restaurant_id));
drop policy if exists "new_hires_update" on public.new_hires;
create policy "new_hires_update" on public.new_hires
  for update using (public.has_roster_manage(restaurant_id));
drop policy if exists "new_hires_delete" on public.new_hires;
create policy "new_hires_delete" on public.new_hires
  for delete using (public.has_brand_admin(brand_id));

drop trigger if exists new_hires_updated_at on public.new_hires;
create trigger new_hires_updated_at
  before update on public.new_hires
  for each row execute function public.handle_updated_at();

-- ── Certificates ────────────────────────────────────────────────────────────
create table if not exists public.new_hire_certificates (
  id          uuid        primary key default uuid_generate_v4(),
  new_hire_id uuid        not null references public.new_hires(id) on delete cascade,
  kind        text        not null,
  label       text,
  file_path   text,                       -- bucket: new-hire-docs, private
  issued_on   date,
  expires_on  date,
  created_at  timestamptz not null default now()
);

create index if not exists idx_new_hire_certs_hire   on public.new_hire_certificates(new_hire_id);
create index if not exists idx_new_hire_certs_expiry on public.new_hire_certificates(expires_on);

-- ── Policy sign-offs ────────────────────────────────────────────────────────
-- Title and version are copied onto the row: a sign-off has to say what was
-- actually agreed to, even after the document is edited or deleted.
create table if not exists public.new_hire_policy_signoffs (
  id               uuid        primary key default uuid_generate_v4(),
  new_hire_id      uuid        not null references public.new_hires(id) on delete cascade,
  document_id      uuid        references public.brand_policy_documents(id) on delete set null,
  document_title   text        not null,
  document_version integer     not null default 1,
  typed_name       text        not null,
  agreed           boolean     not null default true,
  signed_at        timestamptz not null default now(),
  unique (new_hire_id, document_id)
);

-- ── Manager checklist ───────────────────────────────────────────────────────
create table if not exists public.new_hire_checklist (
  id          uuid        primary key default uuid_generate_v4(),
  new_hire_id uuid        not null references public.new_hires(id) on delete cascade,
  item_id     uuid        references public.brand_onboarding_checklist_items(id) on delete set null,
  label       text        not null,
  sort_order  integer     not null default 0,
  done        boolean     not null default false,
  done_by     uuid        references public.profiles(id) on delete set null,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (new_hire_id, item_id)
);

-- ── Training assignments (placeholder — see brand_training_modules) ─────────
create table if not exists public.new_hire_training (
  id           uuid        primary key default uuid_generate_v4(),
  new_hire_id  uuid        not null references public.new_hires(id) on delete cascade,
  module_id    uuid        references public.brand_training_modules(id) on delete set null,
  module_name  text        not null,
  url          text,
  required     boolean     not null default true,
  status       text        not null default 'assigned' check (status in ('assigned', 'complete')),
  assigned_at  timestamptz not null default now(),
  completed_at timestamptz,
  unique (new_hire_id, module_id)
);

-- ── RLS for the hire's child tables: follow the parent row ──────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'new_hire_certificates',
    'new_hire_policy_signoffs',
    'new_hire_checklist',
    'new_hire_training'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I for select using (
        exists (select 1 from public.new_hires h
                where h.id = new_hire_id
                  and (public.has_roster_manage(h.restaurant_id)
                       or public.has_brand_admin(h.brand_id)
                       or h.profile_id = auth.uid()))
      )$f$, t || '_select', t);

    -- Manager-side writes only. Everything the hire writes goes through the
    -- token functions, which are SECURITY DEFINER and bypass these.
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($f$
      create policy %I on public.%I for insert with check (
        exists (select 1 from public.new_hires h
                where h.id = new_hire_id and public.has_roster_manage(h.restaurant_id))
      )$f$, t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($f$
      create policy %I on public.%I for update using (
        exists (select 1 from public.new_hires h
                where h.id = new_hire_id and public.has_roster_manage(h.restaurant_id))
      )$f$, t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($f$
      create policy %I on public.%I for delete using (
        exists (select 1 from public.new_hires h
                where h.id = new_hire_id and public.has_roster_manage(h.restaurant_id))
      )$f$, t || '_delete', t);
  end loop;
end $$;

-- ============================================================================
-- STORAGE  (certificate scans — private, never public)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('new-hire-docs', 'new-hire-docs', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

-- Does this token belong to an invite that is still open? Used by the storage
-- policy, which cannot read new_hires under RLS on its own.
create or replace function public.new_hire_token_open(p_token text)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.new_hires
    where invite_token = p_token
      and status in ('invited', 'in_progress')
      and invite_expires_at > now()
  );
$$;

grant execute on function public.new_hire_token_open(text) to anon, authenticated;

-- Files are pathed <invite_token>/<filename>. The hire may write into their
-- own folder while the invite is open; only roster managers can read.
drop policy if exists "new_hire_docs_insert" on storage.objects;
create policy "new_hire_docs_insert" on storage.objects
  for insert with check (
    bucket_id = 'new-hire-docs'
    and (
      public.is_roster_manager()
      or public.new_hire_token_open((storage.foldername(name))[1])
    )
  );

drop policy if exists "new_hire_docs_select" on storage.objects;
create policy "new_hire_docs_select" on storage.objects
  for select using (bucket_id = 'new-hire-docs' and public.is_roster_manager());

drop policy if exists "new_hire_docs_delete" on storage.objects;
create policy "new_hire_docs_delete" on storage.objects
  for delete using (bucket_id = 'new-hire-docs' and public.is_roster_manager());

-- ============================================================================
-- COMPLETION ENGINE
-- The hire never sets their own status: every flag is recomputed from the
-- actual rows, and 'ready' is a conclusion, not a claim.
-- ============================================================================
create or replace function public.new_hire_recalc(p_id uuid)
returns void language plpgsql security definer as $$
declare
  h          public.new_hires%rowtype;
  v_details  boolean;
  v_certs    boolean;
  v_policies boolean;
  v_check    boolean;
  v_status   text;
  v_ready    boolean;
begin
  select * into h from public.new_hires where id = p_id;
  if not found then return; end if;

  v_details :=
    coalesce(h.legal_first_name, '') <> '' and
    coalesce(h.legal_last_name, '')  <> '' and
    h.date_of_birth is not null       and
    coalesce(h.mobile, '')           <> '' and
    coalesce(h.address_line1, '')    <> '' and
    coalesce(h.suburb, '')           <> '' and
    coalesce(h.address_state, '')    <> '' and
    coalesce(h.postcode, '')         <> '' and
    coalesce(h.emergency_name, '')   <> '' and
    coalesce(h.emergency_phone, '')  <> '';

  -- Every certificate this brand insists on has a row (and an expiry, if the
  -- requirement asks for one). A brand that requires none clears this step.
  select not exists (
    select 1
    from public.brand_certificate_requirements req
    where req.brand_id = h.brand_id
      and req.is_active
      and req.required
      and not exists (
        select 1 from public.new_hire_certificates c
        where c.new_hire_id = h.id
          and c.kind = req.kind
          and (not req.needs_expiry or c.expires_on is not null)
      )
  ) into v_certs;

  select not exists (
    select 1
    from public.brand_policy_documents d
    where d.brand_id = h.brand_id
      and d.is_active
      and d.required
      and not exists (
        select 1 from public.new_hire_policy_signoffs s
        where s.new_hire_id = h.id
          and s.document_id = d.id
          and s.agreed
      )
  ) into v_policies;

  select not exists (
    select 1 from public.new_hire_checklist c
    where c.new_hire_id = h.id and not c.done
  ) into v_check;

  v_ready := h.submitted_at is not null
         and v_details and v_certs and v_policies and h.payroll_confirmed and v_check;

  if h.status = 'active' then
    v_status := 'active';                                     -- never walks back
  elsif v_ready then
    v_status := 'ready';
  elsif h.invite_opened_at is not null
     or h.submitted_at is not null
     or h.payroll_confirmed
     or v_details
     or exists (select 1 from public.new_hire_policy_signoffs s where s.new_hire_id = h.id)
     or exists (select 1 from public.new_hire_certificates c where c.new_hire_id = h.id)
  then
    v_status := 'in_progress';
  else
    v_status := 'invited';
  end if;

  update public.new_hires
     set details_complete      = v_details,
         certificates_complete = v_certs,
         policies_complete     = v_policies,
         checklist_complete    = v_check,
         status                = v_status,
         ready_at              = case when v_status = 'ready' then coalesce(ready_at, now())
                                      when v_status = 'active' then ready_at
                                      else null end
   where id = p_id;
end;
$$;

-- Recalc whenever anything the engine reads changes.
create or replace function public.new_hire_recalc_child()
returns trigger language plpgsql security definer as $$
begin
  perform public.new_hire_recalc(coalesce(new.new_hire_id, old.new_hire_id));
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'new_hire_certificates', 'new_hire_policy_signoffs', 'new_hire_checklist'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_recalc', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.new_hire_recalc_child()',
      t || '_recalc', t);
  end loop;
end $$;

-- ============================================================================
-- SET-UP ON INVITE
-- A new hire gets their manager checklist immediately, so the manager can
-- start ticking "uniform issued" before the hire has opened the link.
-- ============================================================================
create or replace function public.new_hire_after_insert()
returns trigger language plpgsql security definer as $$
begin
  insert into public.new_hire_checklist (new_hire_id, item_id, label, sort_order)
  select new.id, i.id, i.label, i.sort_order
  from public.brand_onboarding_checklist_items i
  where i.brand_id = new.brand_id and i.is_active
  on conflict (new_hire_id, item_id) do nothing;

  perform public.team_audit(
    'onboarding', 'invite_sent', 'new_hire', new.id, new.full_name,
    new.brand_id, new.restaurant_id, null, 'invited',
    jsonb_build_object('role', new.role, 'start_date', new.start_date)
  );

  perform public.new_hire_recalc(new.id);
  return new;
end;
$$;

drop trigger if exists new_hires_after_insert on public.new_hires;
create trigger new_hires_after_insert
  after insert on public.new_hires
  for each row execute function public.new_hire_after_insert();

create or replace function public.new_hire_audit_status()
returns trigger language plpgsql security definer as $$
begin
  if new.status is distinct from old.status then
    perform public.team_audit(
      'onboarding', 'status_changed', 'new_hire', new.id, new.full_name,
      new.brand_id, new.restaurant_id, old.status, new.status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists new_hires_audit_status on public.new_hires;
create trigger new_hires_audit_status
  after update of status on public.new_hires
  for each row execute function public.new_hire_audit_status();

-- ============================================================================
-- THE HIRE'S SIDE  (token-authenticated, no login)
-- ============================================================================

-- Resolve a token to exactly one row. Reading is allowed after submission (so
-- a reload still shows the "all done" screen); writing is not.
create or replace function public.new_hire_by_token_read(p_token text)
returns public.new_hires language plpgsql security definer stable as $$
declare h public.new_hires%rowtype;
begin
  if coalesce(p_token, '') = '' then
    raise exception 'This link is not valid';
  end if;
  select * into h from public.new_hires where invite_token = p_token;
  if not found then
    raise exception 'This link is not valid';
  end if;
  if h.invite_expires_at <= now() and h.submitted_at is null then
    raise exception 'This link has expired. Ask your manager for a new one.';
  end if;
  return h;
end;
$$;

-- Resolve a token to exactly one invite that may still be written to, or raise.
create or replace function public.new_hire_by_token(p_token text)
returns public.new_hires language plpgsql security definer stable as $$
declare h public.new_hires%rowtype;
begin
  h := public.new_hire_by_token_read(p_token);
  if h.invite_expires_at <= now() then
    raise exception 'This link has expired. Ask your manager for a new one.';
  end if;
  -- Submitted is submitted: the link stops accepting edits even if the manager
  -- still has checklist items outstanding (which keeps the status at
  -- 'in_progress' for a while longer).
  if h.submitted_at is not null or h.status not in ('invited', 'in_progress') then
    raise exception 'This form has already been submitted';
  end if;
  return h;
end;
$$;

-- Everything the intake screens need, in one round trip. Returns only the
-- hire's own data plus their brand's configuration — never another hire's.
create or replace function public.new_hire_fetch(p_token text)
returns jsonb language plpgsql security definer as $$
declare
  h public.new_hires%rowtype;
  v jsonb;
begin
  h := public.new_hire_by_token_read(p_token);

  -- First open starts the clock, and moves them off 'invited'.
  if h.invite_opened_at is null then
    update public.new_hires set invite_opened_at = now() where id = h.id;
    perform public.new_hire_recalc(h.id);
    select * into h from public.new_hires where id = h.id;
  end if;

  select jsonb_build_object(
    'hire', jsonb_build_object(
      'id', h.id,
      'full_name', h.full_name,
      'mobile', h.mobile,
      'role', h.role,
      'position_title', h.position_title,
      'start_date', h.start_date,
      'status', h.status,
      'current_step', h.current_step,
      'preferred_name', h.preferred_name,
      'legal_first_name', h.legal_first_name,
      'legal_last_name', h.legal_last_name,
      'date_of_birth', h.date_of_birth,
      'email', h.email,
      'address_line1', h.address_line1,
      'address_line2', h.address_line2,
      'suburb', h.suburb,
      'address_state', h.address_state,
      'postcode', h.postcode,
      'emergency_name', h.emergency_name,
      'emergency_relationship', h.emergency_relationship,
      'emergency_phone', h.emergency_phone,
      'details_complete', h.details_complete,
      'certificates_complete', h.certificates_complete,
      'policies_complete', h.policies_complete,
      'payroll_confirmed', h.payroll_confirmed,
      'submitted_at', h.submitted_at
    ),
    'brand', (
      select jsonb_build_object('name', b.name, 'color', b.color, 'icon', b.icon,
                                'payroll_onboarding_url', b.payroll_onboarding_url)
      from public.brands b where b.id = h.brand_id
    ),
    'venue', (select r.name from public.restaurants r where r.id = h.restaurant_id),
    'certificate_requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', req.kind, 'label', req.label,
               'required', req.required, 'needs_expiry', req.needs_expiry)
             order by req.sort_order, req.label)
      from public.brand_certificate_requirements req
      where req.brand_id = h.brand_id and req.is_active
    ), '[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'kind', c.kind, 'label', c.label,
               'file_path', c.file_path, 'issued_on', c.issued_on, 'expires_on', c.expires_on)
             order by c.created_at)
      from public.new_hire_certificates c where c.new_hire_id = h.id
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'body', d.body, 'url', d.url,
               'version', d.version, 'required', d.required,
               'signed_at', s.signed_at, 'typed_name', s.typed_name)
             order by d.sort_order, d.title)
      from public.brand_policy_documents d
      left join public.new_hire_policy_signoffs s
             on s.new_hire_id = h.id and s.document_id = d.id and s.agreed
      where d.brand_id = h.brand_id and d.is_active
    ), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

grant execute on function public.new_hire_fetch(text) to anon, authenticated;
grant execute on function public.new_hire_by_token_read(text) to anon, authenticated;

-- Step 1. Progress saves between sessions because every call is an upsert of
-- whatever the hire has filled in so far — there is no "finish or lose it".
create or replace function public.new_hire_save_details(
  p_token text,
  p_patch jsonb,
  p_step  smallint default null
)
returns void language plpgsql security definer as $$
declare h public.new_hires%rowtype;
begin
  h := public.new_hire_by_token(p_token);

  update public.new_hires set
    preferred_name         = coalesce(nullif(btrim(p_patch->>'preferred_name'), ''), preferred_name),
    legal_first_name       = coalesce(nullif(btrim(p_patch->>'legal_first_name'), ''), legal_first_name),
    legal_last_name        = coalesce(nullif(btrim(p_patch->>'legal_last_name'), ''), legal_last_name),
    date_of_birth          = coalesce(nullif(p_patch->>'date_of_birth', '')::date, date_of_birth),
    email                  = coalesce(nullif(btrim(p_patch->>'email'), ''), email),
    mobile                 = coalesce(nullif(btrim(p_patch->>'mobile'), ''), mobile),
    address_line1          = coalesce(nullif(btrim(p_patch->>'address_line1'), ''), address_line1),
    address_line2          = nullif(btrim(coalesce(p_patch->>'address_line2', coalesce(address_line2, ''))), ''),
    suburb                 = coalesce(nullif(btrim(p_patch->>'suburb'), ''), suburb),
    address_state          = coalesce(nullif(btrim(p_patch->>'address_state'), ''), address_state),
    postcode               = coalesce(nullif(btrim(p_patch->>'postcode'), ''), postcode),
    emergency_name         = coalesce(nullif(btrim(p_patch->>'emergency_name'), ''), emergency_name),
    emergency_relationship = coalesce(nullif(btrim(p_patch->>'emergency_relationship'), ''), emergency_relationship),
    emergency_phone        = coalesce(nullif(btrim(p_patch->>'emergency_phone'), ''), emergency_phone),
    current_step           = greatest(current_step, coalesce(p_step, current_step))
  where id = h.id;

  perform public.new_hire_recalc(h.id);
end;
$$;

grant execute on function public.new_hire_save_details(text, jsonb, smallint) to anon, authenticated;

-- Step 2. The file itself is uploaded straight to storage under the token
-- folder; this records what it is and when it expires.
create or replace function public.new_hire_add_certificate(
  p_token      text,
  p_kind       text,
  p_label      text default null,
  p_file_path  text default null,
  p_issued_on  date default null,
  p_expires_on date default null
)
returns uuid language plpgsql security definer as $$
declare
  h    public.new_hires%rowtype;
  v_id uuid;
begin
  h := public.new_hire_by_token(p_token);

  if coalesce(p_kind, '') = '' then
    raise exception 'Pick what kind of certificate this is';
  end if;

  -- The upload has to live in this hire's own folder.
  if p_file_path is not null and split_part(p_file_path, '/', 1) <> p_token then
    raise exception 'That file does not belong to this form';
  end if;

  insert into public.new_hire_certificates
    (new_hire_id, kind, label, file_path, issued_on, expires_on)
  values (h.id, p_kind, nullif(btrim(coalesce(p_label, '')), ''), p_file_path, p_issued_on, p_expires_on)
  returning id into v_id;

  update public.new_hires set current_step = greatest(current_step, 2) where id = h.id;
  return v_id;
end;
$$;

grant execute on function public.new_hire_add_certificate(text, text, text, text, date, date)
  to anon, authenticated;

create or replace function public.new_hire_remove_certificate(p_token text, p_cert_id uuid)
returns void language plpgsql security definer as $$
declare h public.new_hires%rowtype;
begin
  h := public.new_hire_by_token(p_token);
  delete from public.new_hire_certificates where id = p_cert_id and new_hire_id = h.id;
end;
$$;

grant execute on function public.new_hire_remove_certificate(text, uuid) to anon, authenticated;

-- Step 3. A tick plus a typed name, timestamped, against the exact version of
-- the document that was on screen.
create or replace function public.new_hire_sign_policy(
  p_token       text,
  p_document_id uuid,
  p_typed_name  text
)
returns void language plpgsql security definer as $$
declare
  h    public.new_hires%rowtype;
  d    public.brand_policy_documents%rowtype;
  v_nm text := btrim(coalesce(p_typed_name, ''));
begin
  h := public.new_hire_by_token(p_token);

  select * into d from public.brand_policy_documents
   where id = p_document_id and brand_id = h.brand_id and is_active;
  if not found then
    raise exception 'That document is not part of your onboarding';
  end if;

  if length(v_nm) < 3 then
    raise exception 'Type your full name to sign';
  end if;

  insert into public.new_hire_policy_signoffs
    (new_hire_id, document_id, document_title, document_version, typed_name, agreed)
  values (h.id, d.id, d.title, d.version, v_nm, true)
  on conflict (new_hire_id, document_id) do update
    set document_title   = excluded.document_title,
        document_version = excluded.document_version,
        typed_name       = excluded.typed_name,
        agreed           = true,
        signed_at        = now();

  update public.new_hires set current_step = greatest(current_step, 3) where id = h.id;
  perform public.new_hire_recalc(h.id);
end;
$$;

grant execute on function public.new_hire_sign_policy(text, uuid, text) to anon, authenticated;

-- Step 4. Payroll happens in the brand's own payroll system. All we keep is
-- the fact that they say they have done it.
create or replace function public.new_hire_confirm_payroll(p_token text)
returns void language plpgsql security definer as $$
declare h public.new_hires%rowtype;
begin
  h := public.new_hire_by_token(p_token);
  update public.new_hires
     set payroll_confirmed = true,
         payroll_confirmed_at = coalesce(payroll_confirmed_at, now()),
         current_step = greatest(current_step, 4)
   where id = h.id;
  perform public.new_hire_recalc(h.id);
end;
$$;

grant execute on function public.new_hire_confirm_payroll(text) to anon, authenticated;

-- Submit. Assigns the brand's required training, then locks the form: the
-- token stops working for edits the moment the status leaves 'in_progress'.
create or replace function public.new_hire_submit(p_token text)
returns jsonb language plpgsql security definer as $$
declare
  h        public.new_hires%rowtype;
  v_missing text[] := '{}';
begin
  h := public.new_hire_by_token(p_token);
  perform public.new_hire_recalc(h.id);
  select * into h from public.new_hires where id = h.id;

  if not h.details_complete  then v_missing := v_missing || 'your details'; end if;
  if not h.certificates_complete then v_missing := v_missing || 'your certificates'; end if;
  if not h.policies_complete then v_missing := v_missing || 'the policy sign-offs'; end if;
  if not h.payroll_confirmed then v_missing := v_missing || 'the payroll step'; end if;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('ok', false, 'missing', to_jsonb(v_missing));
  end if;

  update public.new_hires
     set submitted_at = coalesce(submitted_at, now()), current_step = 5
   where id = h.id;

  insert into public.new_hire_training (new_hire_id, module_id, module_name, url, required)
  select h.id, m.id, m.name, m.url, m.required
  from public.brand_training_modules m
  where m.brand_id = h.brand_id and m.is_active and m.required
  on conflict (new_hire_id, module_id) do nothing;

  perform public.team_audit(
    'onboarding', 'form_submitted', 'new_hire', h.id, h.full_name,
    h.brand_id, h.restaurant_id, h.status, 'submitted'
  );

  perform public.new_hire_recalc(h.id);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.new_hire_submit(text) to anon, authenticated;

-- ============================================================================
-- MANAGER SIDE
-- ============================================================================

-- Hand out a fresh link (the old one stops working immediately).
create or replace function public.new_hire_reissue_invite(p_id uuid, p_days integer default 30)
returns text language plpgsql security definer as $$
declare
  h       public.new_hires%rowtype;
  v_token text;
begin
  select * into h from public.new_hires where id = p_id;
  if not found then raise exception 'Hire not found'; end if;
  if not public.has_roster_manage(h.restaurant_id) then
    raise exception 'Not allowed';
  end if;

  v_token := public.new_hire_token();
  update public.new_hires
     set invite_token = v_token,
         invite_expires_at = now() + (greatest(coalesce(p_days, 30), 1) * interval '1 day')
   where id = p_id;

  perform public.team_audit(
    'onboarding', 'invite_reissued', 'new_hire', h.id, h.full_name,
    h.brand_id, h.restaurant_id
  );

  return v_token;
end;
$$;

grant execute on function public.new_hire_reissue_invite(uuid, integer) to authenticated;

-- Link the hire to the login that was created for them (via Settings → Team),
-- and copy their details onto the profile. Runs as definer because
-- guard_profile_privilege_change (063) blocks non-superadmins from writing
-- employment fields directly — which is right, and is exactly why this is an
-- RPC with its own permission check rather than a client-side update.
create or replace function public.new_hire_link_profile(p_id uuid, p_profile_id uuid)
returns void language plpgsql security definer as $$
declare h public.new_hires%rowtype;
begin
  select * into h from public.new_hires where id = p_id;
  if not found then raise exception 'Hire not found'; end if;
  if not public.has_roster_manage(h.restaurant_id) then
    raise exception 'Not allowed';
  end if;
  if exists (select 1 from public.new_hires where profile_id = p_profile_id and id <> p_id) then
    raise exception 'That team member is already linked to another hire';
  end if;

  update public.new_hires set profile_id = p_profile_id where id = p_id;

  update public.profiles p set
    legal_first_name       = coalesce(p.legal_first_name, h.legal_first_name),
    legal_last_name        = coalesce(p.legal_last_name, h.legal_last_name),
    preferred_name         = coalesce(p.preferred_name, h.preferred_name),
    date_of_birth          = coalesce(p.date_of_birth, h.date_of_birth),
    phone                  = coalesce(nullif(p.phone, ''), h.mobile),
    contact_email          = coalesce(nullif(p.contact_email, ''), h.email),
    address_line1          = coalesce(p.address_line1, h.address_line1),
    address_line2          = coalesce(p.address_line2, h.address_line2),
    suburb                 = coalesce(p.suburb, h.suburb),
    address_state          = coalesce(p.address_state, h.address_state),
    postcode               = coalesce(p.postcode, h.postcode),
    emergency_name         = coalesce(p.emergency_name, h.emergency_name),
    emergency_relationship = coalesce(p.emergency_relationship, h.emergency_relationship),
    emergency_phone        = coalesce(p.emergency_phone, h.emergency_phone),
    position_title         = coalesce(p.position_title, h.position_title),
    start_date             = coalesce(p.start_date, h.start_date),
    home_restaurant_id     = coalesce(p.home_restaurant_id, h.restaurant_id)
  where p.id = p_profile_id;

  -- Certificates the hire uploaded become the employee's documents, so they
  -- show up in compliance and expiry alerts from then on like any other.
  insert into public.employee_documents (employee_id, kind, label, file_path, issued_on, expires_on, uploaded_by)
  select p_profile_id,
         case when c.kind in ('rsa','food_handler','visa','id','qualification') then c.kind else 'other' end,
         coalesce(c.label, c.kind), c.file_path, c.issued_on, c.expires_on, auth.uid()
  from public.new_hire_certificates c
  where c.new_hire_id = p_id
    and not exists (
      select 1 from public.employee_documents d
      where d.employee_id = p_profile_id and d.file_path is not null and d.file_path = c.file_path
    );

  perform public.team_audit(
    'onboarding', 'profile_linked', 'new_hire', h.id, h.full_name,
    h.brand_id, h.restaurant_id, null, null,
    jsonb_build_object('profile_id', p_profile_id)
  );
end;
$$;

grant execute on function public.new_hire_link_profile(uuid, uuid) to authenticated;

-- ============================================================================
-- ROSTER BLOCKING
-- Nobody gets rostered mid-onboarding. The reasons are spelled out so the
-- roster builder can say what is actually missing instead of "not allowed".
-- Only people with an in-flight new_hires row are affected — existing team
-- are untouched.
-- ============================================================================
create or replace function public.roster_block_reasons(p_employee uuid)
returns text[] language plpgsql security definer stable as $$
declare
  h       public.new_hires%rowtype;
  v_out   text[] := '{}';
begin
  if p_employee is null then return v_out; end if;

  select * into h from public.new_hires
   where profile_id = p_employee and status in ('invited', 'in_progress')
   order by created_at desc limit 1;
  if not found then return v_out; end if;

  if h.submitted_at is null       then v_out := v_out || 'Onboarding form not submitted'; end if;
  if not h.details_complete       then v_out := v_out || 'Personal details incomplete'; end if;
  if not h.certificates_complete  then v_out := v_out || 'Required certificates missing'; end if;
  if not h.policies_complete      then v_out := v_out || 'Policy sign-offs outstanding'; end if;
  if not h.payroll_confirmed      then v_out := v_out || 'Payroll step not confirmed'; end if;
  if not h.checklist_complete     then v_out := v_out || 'Manager checklist incomplete'; end if;

  if array_length(v_out, 1) is null then
    v_out := v_out || 'Onboarding not finished';
  end if;
  return v_out;
end;
$$;

grant execute on function public.roster_block_reasons(uuid) to authenticated;

-- Everyone at a venue who cannot be rostered yet, in one query for the builder.
create or replace function public.roster_blocked_at(p_restaurant uuid)
returns table (employee_id uuid, full_name text, reasons text[])
language sql security definer stable as $$
  select h.profile_id,
         coalesce(p.full_name, h.full_name),
         public.roster_block_reasons(h.profile_id)
  from public.new_hires h
  left join public.profiles p on p.id = h.profile_id
  where h.restaurant_id = p_restaurant
    and h.profile_id is not null
    and h.status in ('invited', 'in_progress')
    and public.has_roster_view(p_restaurant);
$$;

grant execute on function public.roster_blocked_at(uuid) to authenticated;

-- Belt and braces: the database refuses the assignment too, so a stale tab or
-- a direct API call cannot get round the UI.
create or replace function public.guard_shift_onboarding()
returns trigger language plpgsql security definer as $$
begin
  if new.employee_id is not null
     and exists (
       select 1 from public.new_hires h
       where h.profile_id = new.employee_id
         and h.status in ('invited', 'in_progress')
     ) then
    raise exception
      'This person cannot be rostered yet — their onboarding is not finished.';
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_guard_onboarding on public.shifts;
create trigger shifts_guard_onboarding
  before insert or update of employee_id on public.shifts
  for each row execute function public.guard_shift_onboarding();

-- ============================================================================
-- ACTIVATION
-- 'ready' becomes 'active' on the first shift they actually work — a finished
-- punch, not a rostered one.
-- ============================================================================
create or replace function public.new_hire_activate_on_work()
returns trigger language plpgsql security definer as $$
begin
  if new.clock_out is not null then
    update public.new_hires h
       set status            = 'active',
           activated_at      = coalesce(h.activated_at, now()),
           first_worked_date = coalesce(h.first_worked_date, new.work_date)
     where h.profile_id = new.employee_id
       and h.status <> 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_activate_hire on public.time_entries;
create trigger time_entries_activate_hire
  after insert or update of clock_out on public.time_entries
  for each row execute function public.new_hire_activate_on_work();

-- ============================================================================
-- CERTIFICATE COMPLIANCE
-- One list covering both in-flight hires and existing team: warning at 30
-- days, alert once expired. Scoped inside the view because a view runs with
-- its owner's rights and so bypasses the base tables' RLS.
-- ============================================================================
create or replace view public.team_certificate_compliance as
with rows as (
  select 'new_hire'::text          as source,
         h.id                      as subject_id,
         h.profile_id              as profile_id,
         h.full_name               as person_name,
         h.restaurant_id           as restaurant_id,
         h.brand_id                as brand_id,
         c.id                      as certificate_id,
         c.kind                    as kind,
         coalesce(c.label, c.kind) as label,
         c.expires_on              as expires_on
  from public.new_hire_certificates c
  join public.new_hires h on h.id = c.new_hire_id
  where c.expires_on is not null
    and h.status <> 'active'          -- once active, the employee row takes over
  union all
  select 'employee',
         p.id,
         p.id,
         p.full_name,
         p.home_restaurant_id,
         r.brand_id,
         d.id,
         d.kind,
         coalesce(d.label, d.kind),
         d.expires_on
  from public.employee_documents d
  join public.profiles p on p.id = d.employee_id
  left join public.restaurants r on r.id = p.home_restaurant_id
  where d.expires_on is not null
    and p.access_revoked_at is null
)
select source, subject_id, profile_id, person_name, restaurant_id, brand_id,
       certificate_id, kind, label, expires_on,
       (expires_on - current_date) as days_remaining,
       case when expires_on <  current_date      then 'expired'
            when expires_on <= current_date + 30 then 'expiring'
            else 'ok' end as compliance_status
from rows
where public.is_superadmin()
   or (restaurant_id is not null and public.has_roster_view(restaurant_id))
   or (brand_id is not null and public.has_brand_admin(brand_id));

grant select on public.team_certificate_compliance to authenticated;

-- ============================================================================
-- SEED  (per brand, on creation and for brands that already exist)
-- ============================================================================
create or replace function public.team_seed_brand_onboarding(p_brand uuid)
returns void language plpgsql security definer as $$
begin
  -- Manager checklist defaults.
  insert into public.brand_onboarding_checklist_items (brand_id, label, description, sort_order)
  select p_brand, d.label, d.descr, d.ord
  from (values
    ('Uniform issued',       'Shirt, apron and cap handed over',        10),
    ('POS login created',    'Till login made and tested',             20),
    ('Buddy shift rostered', 'First shift paired with someone senior', 30),
    ('Keys / codes issued',  'Door codes, alarm code, keys',           40)
  ) as d(label, descr, ord)
  where not exists (
    select 1 from public.brand_onboarding_checklist_items i
    where i.brand_id = p_brand and i.label = d.label
  );

  -- Certificates we ask for. Nothing is marked required by default: making a
  -- certificate mandatory blocks rostering, which is the brand's call to make.
  insert into public.brand_certificate_requirements (brand_id, kind, label, required, needs_expiry, sort_order)
  select p_brand, d.kind, d.label, false, true, d.ord
  from (values
    ('rsa',          'RSA (Responsible Service of Alcohol)', 10),
    ('food_handler', 'Food Handler certificate',             20)
  ) as d(kind, label, ord)
  on conflict (brand_id, kind) do nothing;

  -- Placeholder training modules — see the note on brand_training_modules.
  insert into public.brand_training_modules (brand_id, name, description, required, sort_order)
  select p_brand, d.name, d.descr, true, d.ord
  from (values
    ('Food safety basics', 'Allergens, temperatures, cross-contamination', 10),
    ('WHS induction',      'Exits, first aid, chemicals, incident process', 20),
    ('Customer service',   'How we greet, serve and handle complaints',     30)
  ) as d(name, descr, ord)
  where not exists (
    select 1 from public.brand_training_modules m
    where m.brand_id = p_brand and m.name = d.name
  );
end;
$$;

create or replace function public.team_seed_on_brand_insert()
returns trigger language plpgsql security definer as $$
begin
  perform public.team_seed_brand_onboarding(new.id);
  return new;
end;
$$;

drop trigger if exists brands_seed_team_onboarding on public.brands;
create trigger brands_seed_team_onboarding
  after insert on public.brands
  for each row execute function public.team_seed_on_brand_insert();

select public.team_seed_brand_onboarding(id) from public.brands;
