-- ============================================================================
-- 063. ONBOARDING & EMPLOYMENT CONTRACTS  (O1 — data model)
-- ----------------------------------------------------------------------------
-- Admin creates the account with the employment terms; the employee completes
-- their own details and signs their contract on first login (hard gate for
-- team_member/staff, soft gate for manager+, clock in/out never gated).
--
-- Sensitive money/tax data (TFN, bank, super) deliberately does NOT live on
-- profiles: migration 042's "profiles_select_roster_manager" policy lets every
-- roster manager read every profile row, so a TFN there would be readable by
-- every store manager. It goes in employee_sensitive, RLS'd to self+superadmin.
--
-- Tables:  employee_onboarding, employee_sensitive, employee_documents,
--          contract_templates, contract_template_versions, employee_contracts,
--          onboarding_checklist_items, employee_checklist,
--          profile_change_requests
-- Buckets: employee-docs (private), contracts (private)
-- RPCs:    onboarding_recalc, onboarding_touch_step, sign_contract,
--          request_profile_change, review_profile_change
-- ============================================================================

-- ── Profile: the non-sensitive detail fields the wizard collects ─────────────
alter table public.profiles
  add column if not exists legal_first_name       text,
  add column if not exists legal_middle_name      text,
  add column if not exists legal_last_name        text,
  add column if not exists preferred_name         text,
  add column if not exists address_line1          text,
  add column if not exists address_line2          text,
  add column if not exists suburb                 text,
  add column if not exists address_state          text,
  add column if not exists postcode               text,
  add column if not exists emergency_name         text,
  add column if not exists emergency_relationship text,
  add column if not exists emergency_phone        text,
  add column if not exists emergency_phone_alt    text,
  add column if not exists medical_notes          text,
  add column if not exists work_eligibility       text,
  add column if not exists visa_subclass          text,
  add column if not exists visa_expiry            date,
  add column if not exists position_title         text,
  add column if not exists start_date             date,
  add column if not exists probation_weeks        integer,
  add column if not exists requires_onboarding    boolean;

do $$ begin
  alter table public.profiles
    add constraint profiles_work_eligibility_check
    check (work_eligibility is null or work_eligibility in ('citizen','permanent_resident','visa'));
exception when duplicate_object then null; end $$;

-- ============================================================================
-- EMPLOYEE ONBOARDING  (one row per employee — source of truth for the gate)
-- ============================================================================
create table if not exists public.employee_onboarding (
  employee_id        uuid        primary key references public.profiles(id) on delete cascade,
  status             text        not null default 'pending'
                                 check (status in ('legacy','pending','in_progress','complete','exempt')),
  collect_details    boolean     not null default true,   -- personal/emergency/eligibility/tax/bank
  issue_contract     boolean     not null default true,   -- must sign a contract to finish
  details_complete   boolean     not null default false,
  sensitive_complete boolean     not null default false,
  contract_signed    boolean     not null default false,
  current_step       smallint    not null default 1,
  skip_allowed       boolean     not null default false,  -- superadmin escape hatch (shows as a red flag)
  requested_by       uuid        references public.profiles(id) on delete set null,
  requested_at       timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_employee_onboarding_status on public.employee_onboarding(status);

alter table public.employee_onboarding enable row level security;

-- Own row, or any row if you can manage a roster (managers need to see who is outstanding).
create policy "employee_onboarding_select" on public.employee_onboarding
  for select using (employee_id = auth.uid() or public.is_roster_manager());
create policy "employee_onboarding_insert" on public.employee_onboarding
  for insert with check (public.is_superadmin());
create policy "employee_onboarding_update" on public.employee_onboarding
  for update using (public.is_superadmin());
create policy "employee_onboarding_delete" on public.employee_onboarding
  for delete using (public.is_superadmin());

create trigger employee_onboarding_updated_at
  before update on public.employee_onboarding
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- EMPLOYEE SENSITIVE  (tax / super / bank — self + superadmin ONLY)
-- ============================================================================
create table if not exists public.employee_sensitive (
  employee_id         uuid        primary key references public.profiles(id) on delete cascade,
  tfn                 text,
  tfn_exemption       text        check (tfn_exemption is null or tfn_exemption in ('none','applied','under_18','pensioner','not_provided')),
  tax_free_threshold  boolean     not null default true,
  help_debt           boolean     not null default false,
  tax_residency       text        check (tax_residency is null or tax_residency in ('resident','foreign','working_holiday')),
  super_choice        text        check (super_choice is null or super_choice in ('employer_default','own_fund')),
  super_fund_name     text,
  super_usi           text,
  super_member_number text,
  bank_account_name   text,
  bank_bsb            text,
  bank_account_number text,
  updated_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.employee_sensitive enable row level security;

-- NOTE: deliberately NOT visible to managers or area managers.
create policy "employee_sensitive_select" on public.employee_sensitive
  for select using (employee_id = auth.uid() or public.is_superadmin());
create policy "employee_sensitive_insert" on public.employee_sensitive
  for insert with check (employee_id = auth.uid() or public.is_superadmin());
create policy "employee_sensitive_update" on public.employee_sensitive
  for update using (employee_id = auth.uid() or public.is_superadmin());
create policy "employee_sensitive_delete" on public.employee_sensitive
  for delete using (public.is_superadmin());

create trigger employee_sensitive_updated_at
  before update on public.employee_sensitive
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- EMPLOYEE DOCUMENTS  (RSA / food handler / visa / other)
-- Rows are visible to roster managers (they need to know an RSA has expired);
-- the FILES in storage are readable only by the owner and superadmin.
-- ============================================================================
create table if not exists public.employee_documents (
  id           uuid        primary key default uuid_generate_v4(),
  employee_id  uuid        not null references public.profiles(id) on delete cascade,
  kind         text        not null default 'other'
                           check (kind in ('rsa','food_handler','visa','id','qualification','other')),
  label        text,
  file_path    text,
  issued_on    date,
  expires_on   date,
  uploaded_by  uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_employee_documents_employee on public.employee_documents(employee_id);
create index if not exists idx_employee_documents_expiry   on public.employee_documents(expires_on);

alter table public.employee_documents enable row level security;

create policy "employee_documents_select" on public.employee_documents
  for select using (employee_id = auth.uid() or public.is_roster_manager());
create policy "employee_documents_insert" on public.employee_documents
  for insert with check (employee_id = auth.uid() or public.is_superadmin());
create policy "employee_documents_update" on public.employee_documents
  for update using (employee_id = auth.uid() or public.is_superadmin());
create policy "employee_documents_delete" on public.employee_documents
  for delete using (employee_id = auth.uid() or public.is_superadmin());

-- ============================================================================
-- CONTRACT TEMPLATES  (superadmin only — these set pay terms)
-- Matching: employment_type + restaurant_id, most specific wins, null = any.
-- ============================================================================
create table if not exists public.contract_templates (
  id              uuid        primary key default uuid_generate_v4(),
  name            text        not null,
  kind            text        not null default 'contract' check (kind in ('contract','variation')),
  employment_type text        check (employment_type is null or employment_type in ('casual','part_time','full_time')),
  restaurant_id   uuid        references public.restaurants(id) on delete cascade,
  body_html       text        not null default '',
  version         integer     not null default 1,
  active          boolean     not null default true,
  is_seed_draft   boolean     not null default false,  -- shipped placeholder, not legally reviewed
  notes           text,
  updated_by      uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.contract_templates enable row level security;

create policy "contract_templates_select" on public.contract_templates
  for select using (public.is_superadmin());
create policy "contract_templates_insert" on public.contract_templates
  for insert with check (public.is_superadmin());
create policy "contract_templates_update" on public.contract_templates
  for update using (public.is_superadmin());
create policy "contract_templates_delete" on public.contract_templates
  for delete using (public.is_superadmin());

create trigger contract_templates_updated_at
  before update on public.contract_templates
  for each row execute function public.handle_updated_at();

-- Every save snapshots the previous body so an old signed contract can always
-- be traced back to the exact template revision it came from.
create table if not exists public.contract_template_versions (
  id          uuid        primary key default uuid_generate_v4(),
  template_id uuid        not null references public.contract_templates(id) on delete cascade,
  version     integer     not null,
  name        text,
  body_html   text        not null,
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (template_id, version)
);

alter table public.contract_template_versions enable row level security;

create policy "contract_template_versions_select" on public.contract_template_versions
  for select using (public.is_superadmin());
create policy "contract_template_versions_insert" on public.contract_template_versions
  for insert with check (public.is_superadmin());
create policy "contract_template_versions_delete" on public.contract_template_versions
  for delete using (public.is_superadmin());

-- ============================================================================
-- EMPLOYEE CONTRACTS  (the instrument — body_html is the immutable record)
-- ============================================================================
create table if not exists public.employee_contracts (
  id                       uuid        primary key default uuid_generate_v4(),
  employee_id              uuid        not null references public.profiles(id) on delete cascade,
  template_id              uuid        references public.contract_templates(id) on delete set null,
  template_version         integer,
  template_name            text,
  kind                     text        not null default 'contract' check (kind in ('contract','variation')),
  status                   text        not null default 'draft'
                                       check (status in ('draft','issued','viewed','signed','declined','superseded')),
  body_html                text        not null default '',   -- fully rendered snapshot
  tokens                   jsonb       not null default '{}'::jsonb,
  content_hash             text,
  issued_by                uuid        references public.profiles(id) on delete set null,
  issued_at                timestamptz,
  viewed_at                timestamptz,
  signed_at                timestamptz,
  signature_name           text,
  signature_image          text,                              -- data URL of the drawn signature
  signature_ip             text,
  signature_user_agent     text,
  employer_signatory_name  text,
  employer_signatory_title text,
  employer_signed_at       timestamptz,
  decline_reason           text,
  storage_path             text,
  superseded_by            uuid        references public.employee_contracts(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_employee_contracts_employee on public.employee_contracts(employee_id);
create index if not exists idx_employee_contracts_status   on public.employee_contracts(status);

alter table public.employee_contracts enable row level security;

-- The employee can read their own contracts; only superadmin sees everyone's.
-- Signing goes through sign_contract() so the employee can never edit the body.
create policy "employee_contracts_select" on public.employee_contracts
  for select using (employee_id = auth.uid() or public.is_superadmin());
create policy "employee_contracts_insert" on public.employee_contracts
  for insert with check (public.is_superadmin());
create policy "employee_contracts_update" on public.employee_contracts
  for update using (public.is_superadmin());
create policy "employee_contracts_delete" on public.employee_contracts
  for delete using (public.is_superadmin());

create trigger employee_contracts_updated_at
  before update on public.employee_contracts
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- INDUCTION CHECKLIST  (admin-side tick list per new hire)
-- ============================================================================
create table if not exists public.onboarding_checklist_items (
  id          uuid        primary key default uuid_generate_v4(),
  label       text        not null,
  description text,
  sort_order  integer     not null default 0,
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

alter table public.onboarding_checklist_items enable row level security;

create policy "onboarding_checklist_items_select" on public.onboarding_checklist_items
  for select using (auth.uid() is not null);
create policy "onboarding_checklist_items_insert" on public.onboarding_checklist_items
  for insert with check (public.is_superadmin());
create policy "onboarding_checklist_items_update" on public.onboarding_checklist_items
  for update using (public.is_superadmin());
create policy "onboarding_checklist_items_delete" on public.onboarding_checklist_items
  for delete using (public.is_superadmin());

create table if not exists public.employee_checklist (
  id          uuid        primary key default uuid_generate_v4(),
  employee_id uuid        not null references public.profiles(id) on delete cascade,
  item_id     uuid        not null references public.onboarding_checklist_items(id) on delete cascade,
  done        boolean     not null default false,
  done_by     uuid        references public.profiles(id) on delete set null,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (employee_id, item_id)
);

alter table public.employee_checklist enable row level security;

create policy "employee_checklist_select" on public.employee_checklist
  for select using (employee_id = auth.uid() or public.is_roster_manager());
create policy "employee_checklist_insert" on public.employee_checklist
  for insert with check (public.is_superadmin());
create policy "employee_checklist_update" on public.employee_checklist
  for update using (public.is_superadmin());
create policy "employee_checklist_delete" on public.employee_checklist
  for delete using (public.is_superadmin());

-- ============================================================================
-- PROFILE CHANGE REQUESTS  (tier-2 fields: bank, super, legal name, DOB)
-- ============================================================================
create table if not exists public.profile_change_requests (
  id           uuid        primary key default uuid_generate_v4(),
  employee_id  uuid        not null references public.profiles(id) on delete cascade,
  scope        text        not null default 'profile' check (scope in ('profile','sensitive')),
  payload      jsonb       not null default '{}'::jsonb,
  status       text        not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by  uuid        references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text
);

create index if not exists idx_profile_change_requests_status on public.profile_change_requests(status);

alter table public.profile_change_requests enable row level security;

create policy "profile_change_requests_select" on public.profile_change_requests
  for select using (employee_id = auth.uid() or public.is_superadmin());
create policy "profile_change_requests_insert" on public.profile_change_requests
  for insert with check (employee_id = auth.uid());
create policy "profile_change_requests_update" on public.profile_change_requests
  for update using (public.is_superadmin());
create policy "profile_change_requests_delete" on public.profile_change_requests
  for delete using (public.is_superadmin());

-- ============================================================================
-- COMPLETION ENGINE
-- The employee can never mark themselves complete: flags are recomputed
-- server-side from the actual data by onboarding_recalc(), fired by triggers.
-- ============================================================================
create or replace function public.onboarding_recalc(target uuid)
returns void language plpgsql security definer as $$
declare
  p            public.profiles%rowtype;
  s            public.employee_sensitive%rowtype;
  ob           public.employee_onboarding%rowtype;
  v_details    boolean := false;
  v_sensitive  boolean := false;
  v_contract   boolean := false;
  v_status     text;
begin
  select * into ob from public.employee_onboarding where employee_id = target;
  if not found then return; end if;
  if ob.status in ('legacy','exempt') then return; end if;

  select * into p from public.profiles where id = target;
  select * into s from public.employee_sensitive where employee_id = target;

  -- Personal + emergency + work eligibility
  v_details :=
    coalesce(p.legal_first_name, '') <> '' and
    coalesce(p.legal_last_name, '')  <> '' and
    p.date_of_birth is not null       and
    coalesce(p.phone, '')            <> '' and
    coalesce(p.address_line1, '')    <> '' and
    coalesce(p.suburb, '')           <> '' and
    coalesce(p.address_state, '')    <> '' and
    coalesce(p.postcode, '')         <> '' and
    coalesce(p.emergency_name, '')   <> '' and
    coalesce(p.emergency_phone, '')  <> '' and
    p.work_eligibility is not null    and
    (p.work_eligibility <> 'visa' or (coalesce(p.visa_subclass,'') <> '' and p.visa_expiry is not null));

  -- Tax + super + bank
  v_sensitive := s.employee_id is not null
    and (coalesce(s.tfn, '') <> '' or s.tfn_exemption is not null)
    and s.tax_residency is not null
    and s.super_choice is not null
    and (s.super_choice = 'employer_default'
         or (coalesce(s.super_fund_name,'') <> '' and coalesce(s.super_member_number,'') <> ''))
    and coalesce(s.bank_account_name,'')   <> ''
    and coalesce(s.bank_bsb,'')            <> ''
    and coalesce(s.bank_account_number,'') <> '';

  select exists (
    select 1 from public.employee_contracts c
    where c.employee_id = target and c.kind = 'contract' and c.status = 'signed'
  ) into v_contract;

  if (not ob.collect_details or (v_details and v_sensitive))
     and (not ob.issue_contract or v_contract) then
    v_status := 'complete';
  elsif v_details or v_sensitive or v_contract or ob.started_at is not null then
    v_status := 'in_progress';
  else
    v_status := 'pending';
  end if;

  update public.employee_onboarding
     set details_complete   = v_details,
         sensitive_complete = v_sensitive,
         contract_signed    = v_contract,
         status             = v_status,
         completed_at       = case when v_status = 'complete' then coalesce(completed_at, now()) else null end
   where employee_id = target;
end;
$$;

create or replace function public.onboarding_recalc_from_profile()
returns trigger language plpgsql security definer as $$
begin
  perform public.onboarding_recalc(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_onboarding_recalc on public.profiles;
create trigger profiles_onboarding_recalc
  after update on public.profiles
  for each row execute function public.onboarding_recalc_from_profile();

create or replace function public.onboarding_recalc_from_employee()
returns trigger language plpgsql security definer as $$
begin
  perform public.onboarding_recalc(new.employee_id);
  return new;
end;
$$;

drop trigger if exists employee_sensitive_onboarding_recalc on public.employee_sensitive;
create trigger employee_sensitive_onboarding_recalc
  after insert or update on public.employee_sensitive
  for each row execute function public.onboarding_recalc_from_employee();

drop trigger if exists employee_contracts_onboarding_recalc on public.employee_contracts;
create trigger employee_contracts_onboarding_recalc
  after insert or update on public.employee_contracts
  for each row execute function public.onboarding_recalc_from_employee();

-- Employee-side step tracking (they own their position in the wizard, nothing else).
create or replace function public.onboarding_touch_step(p_step smallint)
returns void language plpgsql security definer as $$
begin
  update public.employee_onboarding
     set current_step = greatest(current_step, p_step),
         started_at   = coalesce(started_at, now()),
         status       = case when status = 'pending' then 'in_progress' else status end
   where employee_id = auth.uid();
end;
$$;

-- ============================================================================
-- SIGNING
-- SECURITY DEFINER so the employee can sign without any UPDATE grant on the
-- contract body. Captures the audit trail: name, time, IP, user agent, hash.
-- ============================================================================
create or replace function public.sign_contract(
  p_contract_id uuid,
  p_name        text,
  p_signature   text default null
) returns public.employee_contracts language plpgsql security definer as $$
declare
  c   public.employee_contracts%rowtype;
  ip  text;
  ua  text;
  hdr json;
begin
  select * into c from public.employee_contracts where id = p_contract_id;
  if not found then raise exception 'Contract not found'; end if;
  if c.employee_id <> auth.uid() then raise exception 'Not your contract'; end if;
  if c.status = 'signed' then raise exception 'Already signed'; end if;
  if c.status not in ('issued','viewed') then raise exception 'Contract is not open for signature'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A signature name is required'; end if;

  begin
    hdr := current_setting('request.headers', true)::json;
    ip  := split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1);
    ua  := hdr->>'user-agent';
  exception when others then
    ip := null; ua := null;
  end;

  update public.employee_contracts
     set status               = 'signed',
         signed_at            = now(),
         signature_name       = trim(p_name),
         signature_image      = p_signature,
         signature_ip         = nullif(ip, ''),
         signature_user_agent = ua,
         content_hash         = encode(digest(body_html, 'sha256'), 'hex')
   where id = p_contract_id
   returning * into c;

  insert into public.notifications (user_id, type, title, body, data)
  select pr.id, 'contract_signed', 'Contract signed',
         coalesce(c.signature_name, 'A team member') || ' signed their employment contract.',
         jsonb_build_object('path', '/admin/team')
  from public.profiles pr where pr.role = 'superadmin';

  return c;
end;
$$;

-- Mark "viewed" the first time the employee opens it (evidence they read it).
create or replace function public.mark_contract_viewed(p_contract_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.employee_contracts
     set status    = case when status = 'issued' then 'viewed' else status end,
         viewed_at = coalesce(viewed_at, now())
   where id = p_contract_id and employee_id = auth.uid();
end;
$$;

-- ============================================================================
-- PROFILE CHANGE REQUESTS  (tier-2 approvals)
-- ============================================================================
create or replace function public.review_profile_change(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
) returns void language plpgsql security definer as $$
declare
  r public.profile_change_requests%rowtype;
  k text;
begin
  if not public.is_superadmin() then raise exception 'Not allowed'; end if;
  select * into r from public.profile_change_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'Already reviewed'; end if;

  if p_approve then
    if r.scope = 'profile' then
      for k in select jsonb_object_keys(r.payload) loop
        if k not in ('legal_first_name','legal_middle_name','legal_last_name','date_of_birth') then
          raise exception 'Field % is not allowed in a profile change request', k;
        end if;
      end loop;
      update public.profiles p
         set legal_first_name  = coalesce(r.payload->>'legal_first_name',  p.legal_first_name),
             legal_middle_name = coalesce(r.payload->>'legal_middle_name', p.legal_middle_name),
             legal_last_name   = coalesce(r.payload->>'legal_last_name',   p.legal_last_name),
             date_of_birth     = coalesce((r.payload->>'date_of_birth')::date, p.date_of_birth)
       where p.id = r.employee_id;
    else
      update public.employee_sensitive s
         set super_choice        = coalesce(r.payload->>'super_choice',        s.super_choice),
             super_fund_name     = coalesce(r.payload->>'super_fund_name',     s.super_fund_name),
             super_usi           = coalesce(r.payload->>'super_usi',           s.super_usi),
             super_member_number = coalesce(r.payload->>'super_member_number', s.super_member_number),
             bank_account_name   = coalesce(r.payload->>'bank_account_name',   s.bank_account_name),
             bank_bsb            = coalesce(r.payload->>'bank_bsb',            s.bank_bsb),
             bank_account_number = coalesce(r.payload->>'bank_account_number', s.bank_account_number)
       where s.employee_id = r.employee_id;
    end if;
  end if;

  update public.profile_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (r.employee_id, 'profile_change',
          case when p_approve then 'Details updated' else 'Change request declined' end,
          case when p_approve then 'Your requested detail change was approved.'
               else 'Your requested detail change was declined.' end,
          jsonb_build_object('path', '/my-profile'));
end;
$$;

-- A pending request, or a direct bank change by an admin, always tells the employee.
create or replace function public.notify_change_requested()
returns trigger language plpgsql security definer as $$
begin
  insert into public.notifications (user_id, type, title, body, data)
  select pr.id, 'profile_change', 'Detail change awaiting approval',
         coalesce((select full_name from public.profiles where id = new.employee_id), 'A team member')
           || ' requested a change to their ' ||
           case when new.scope = 'sensitive' then 'bank or super details' else 'legal name or date of birth' end || '.',
         jsonb_build_object('path', '/admin/team')
  from public.profiles pr where pr.role = 'superadmin';

  insert into public.notifications (user_id, type, title, body, data)
  values (new.employee_id, 'profile_change', 'Change request submitted',
          'We have received your change request. It will apply once approved.',
          jsonb_build_object('path', '/my-profile'));
  return new;
end;
$$;

drop trigger if exists profile_change_requests_notify on public.profile_change_requests;
create trigger profile_change_requests_notify
  after insert on public.profile_change_requests
  for each row execute function public.notify_change_requested();

-- ============================================================================
-- STORAGE
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('employee-docs', 'employee-docs', false, 10485760,
   array['image/jpeg','image/png','image/webp','image/heic','application/pdf']),
  ('contracts', 'contracts', false, 10485760,
   array['text/html','application/pdf'])
on conflict (id) do nothing;

-- Files are pathed as <employee_id>/<filename>, so the first path segment is
-- the owner — that is what the policies check.
create policy "employee_docs_select" on storage.objects
  for select using (
    bucket_id = 'employee-docs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );
create policy "employee_docs_insert" on storage.objects
  for insert with check (
    bucket_id = 'employee-docs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );
create policy "employee_docs_delete" on storage.objects
  for delete using (bucket_id = 'employee-docs' and public.is_superadmin());

create policy "contracts_select" on storage.objects
  for select using (
    bucket_id = 'contracts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );
create policy "contracts_insert" on storage.objects
  for insert with check (bucket_id = 'contracts' and public.is_superadmin());
create policy "contracts_delete" on storage.objects
  for delete using (bucket_id = 'contracts' and public.is_superadmin());

-- ============================================================================
-- SEED
-- ============================================================================
insert into public.onboarding_checklist_items (label, description, sort_order) values
  ('Uniform issued',              'Shirt, apron, cap handed over',                 10),
  ('Clock-in PIN set',            'Kiosk PIN created and tested',                  20),
  ('Food safety induction',       'Walked through food handling and allergens',    30),
  ('WHS induction',               'Exits, first aid, chemicals, incident process', 40),
  ('Added to team group chat',    '',                                              50),
  ('Availability submitted',      'Team member has set their availability',        60),
  ('Details sent to accountant',  'TFN, super and bank forwarded for payroll',     70)
on conflict do nothing;

-- Company details used by contract tokens.
insert into public.app_settings (key, value)
values ('company', jsonb_build_object(
  'legal_name', '', 'trading_name', '', 'abn', '', 'address', '',
  'signatory_name', '', 'signatory_title', '', 'signature_image', ''
))
on conflict (key) do nothing;

-- ── Backfill: gate everyone who is rostered ─────────────────────────────────
-- Norm's call: existing team are gated at go-live too (softened by the
-- clock-in carve-out and the soft gate for manager+).
-- To stage it instead, run this migration then immediately:
--   update public.employee_onboarding set status = 'legacy';
-- ...and flip people to 'pending' store by store from the Onboarding tab.
insert into public.employee_onboarding (employee_id, status, requested_at)
select p.id, 'pending', now()
from public.profiles p
where coalesce(p.is_rosterable, p.role = 'team_member') = true
on conflict (employee_id) do nothing;

select public.onboarding_recalc(employee_id) from public.employee_onboarding;

-- ============================================================================
-- GUARD UPGRADE
-- "profiles_update_own" (migration 001) lets anyone update their own row, and
-- the 042 guard only protected role + restaurant_access. With employees now
-- editing their own profile, that would let someone set their own pay rate.
-- This extends the guard to the employment/pay fields, and makes legal name +
-- DOB write-once for the employee (changing them later needs an approved
-- profile_change_request, applied by review_profile_change() as superadmin).
-- ============================================================================
create or replace function public.guard_profile_privilege_change()
returns trigger as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_superadmin() then
    if (new.role is distinct from old.role)
       or (new.restaurant_access is distinct from old.restaurant_access) then
      raise exception 'Only a superadmin can change role or restaurant access';
    end if;

    -- Employment terms are a variation of contract, not a profile edit.
    if (new.base_pay_rate    is distinct from old.base_pay_rate)
       or (new.award_level      is distinct from old.award_level)
       or (new.pay_type         is distinct from old.pay_type)
       or (new.employment_type  is distinct from old.employment_type)
       or (new.salary_annual    is distinct from old.salary_annual)
       or (new.contracted_hours is distinct from old.contracted_hours)
       or (new.home_restaurant_id is distinct from old.home_restaurant_id)
       or (new.is_rosterable    is distinct from old.is_rosterable)
       or (new.position_title   is distinct from old.position_title)
       or (new.start_date       is distinct from old.start_date)
       or (new.probation_weeks  is distinct from old.probation_weeks) then
      raise exception 'Only a superadmin can change employment terms';
    end if;

    -- Write-once for the employee: they set these during onboarding, then any
    -- later change goes through an approval.
    if (old.legal_first_name is not null and new.legal_first_name is distinct from old.legal_first_name)
       or (old.legal_last_name is not null and new.legal_last_name is distinct from old.legal_last_name)
       or (old.date_of_birth  is not null and new.date_of_birth  is distinct from old.date_of_birth) then
      raise exception 'Legal name and date of birth changes need approval';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- AUTO-ENROL NEW HIRES
-- New accounts are created by the admin-users edge function, which knows
-- nothing about onboarding. A trigger keeps enrolment automatic so nobody is
-- created without paperwork by accident. `requires_onboarding` on the profile
-- is the per-person override (null = follow is_rosterable).
-- ============================================================================
create or replace function public.enrol_new_employee()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(new.requires_onboarding, new.is_rosterable, false) then
    insert into public.employee_onboarding (employee_id, status, requested_at)
    values (new.id, 'pending', now())
    on conflict (employee_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enrol_onboarding on public.profiles;
create trigger profiles_enrol_onboarding
  after insert on public.profiles
  for each row execute function public.enrol_new_employee();

-- Someone flipped to rosterable later (e.g. an office login who starts working
-- shifts) also gets enrolled.
create or replace function public.enrol_on_rosterable()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(new.requires_onboarding, new.is_rosterable, false)
     and not coalesce(old.requires_onboarding, old.is_rosterable, false) then
    insert into public.employee_onboarding (employee_id, status, requested_at)
    values (new.id, 'pending', now())
    on conflict (employee_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enrol_onboarding_update on public.profiles;
create trigger profiles_enrol_onboarding_update
  after update of is_rosterable, requires_onboarding on public.profiles
  for each row execute function public.enrol_on_rosterable();
