-- ============================================================================
-- 076. LABEL PRINTING — printers + a print queue
--
--   The SUNMI 80mm kitchen printer has no macOS driver, so printing to it
--   through CUPS produced a PostScript listing instead of a label. Its cloud
--   API talks MQTT and needs a Sunmi partner account we don't have. What it
--   DOES accept is raw ESC/POS on TCP 9100 over the LAN.
--
--   A browser can't open a TCP socket, so this reuses the pattern already
--   proven by refresh_requests: the app INSERTS a row, and refresh-watcher on
--   the Mac polls it, renders the label and writes the bytes to the printer.
--   The browser only ever talks to Supabase — so this works from the app, the
--   kitchen tablet and a phone, with no CORS, no certificates and no driver.
--
--   Swapping to Sunmi's cloud later means adding a transport to the worker;
--   the queue, the payload and every caller stay exactly as they are.
--
--   Depends on 073–075. Safe to re-run.
-- ============================================================================


-- ── 1. Printers ──────────────────────────────────────────────────────────────
create table if not exists public.printers (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  name          text not null,

  -- 'lan_escpos'  → raw ESC/POS to host:port (what we do today)
  -- 'sunmi_cloud' → reserved for the Sunmi partner API, if credentials appear
  kind          text not null default 'lan_escpos'
                  check (kind in ('lan_escpos', 'sunmi_cloud')),

  host          text,                      -- printer IP; give it a DHCP reservation
  port          integer not null default 9100,
  columns       integer not null default 48 check (columns between 20 and 96),
  sn            text,                      -- for the cloud transport later

  active        boolean not null default true,
  is_default    boolean not null default false,
  last_ok_at    timestamptz,               -- last successful print, for a health dot
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_printers_restaurant on public.printers(restaurant_id);

-- At most one default per venue, so "where does this label go" has one answer.
create unique index if not exists uq_printers_one_default
  on public.printers(restaurant_id) where is_default;

comment on table public.printers is
  'Label printers per venue. lan_escpos writes raw ESC/POS to host:port — refresh-watcher on the Mac does the writing, because a browser cannot open a socket.';

alter table public.printers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='printers' and policyname='printers_select') then
    create policy "printers_select" on public.printers
      for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='printers' and policyname='printers_insert') then
    create policy "printers_insert" on public.printers
      for insert with check (public.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='printers' and policyname='printers_update') then
    create policy "printers_update" on public.printers
      for update using (public.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='printers' and policyname='printers_delete') then
    create policy "printers_delete" on public.printers
      for delete using (public.is_superadmin());
  end if;
end $$;


-- ── 2. The queue ─────────────────────────────────────────────────────────────
-- payload is the LABEL DATA, not bytes: the worker renders it. That way a
-- change to the label format is a watcher restart, not an app redeploy, and
-- there is only ever one renderer.
create table if not exists public.print_jobs (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  printer_id    uuid references public.printers on delete set null,

  job_type      text not null default 'prep_label' check (job_type in ('prep_label', 'test')),
  payload       jsonb not null,

  status        text not null default 'queued'
                  check (status in ('queued', 'printing', 'done', 'error', 'cancelled')),
  attempts      integer not null default 0,
  last_error    text,

  source_type   text,                      -- 'production_run', 'reprint', 'test'
  source_id     uuid,

  created_by    uuid references public.profiles on delete set null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

-- The worker's hot path: oldest queued job first.
create index if not exists idx_print_jobs_queued
  on public.print_jobs(created_at) where status in ('queued', 'printing');
create index if not exists idx_print_jobs_venue
  on public.print_jobs(restaurant_id, created_at desc);

alter table public.print_jobs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='print_jobs' and policyname='print_jobs_select') then
    create policy "print_jobs_select" on public.print_jobs
      for select using (public.has_restaurant_access(restaurant_id));
  end if;
  -- Inserts go through the RPCs below; the worker uses the service role and
  -- bypasses RLS entirely.
end $$;


-- ── 3. Enqueue ───────────────────────────────────────────────────────────────
-- No access check — callers check first, because the tablet authenticates by
-- device token rather than auth.uid(). Revoked from public below.
create or replace function public.print_enqueue_internal(
  p_restaurant_id uuid,
  p_payload       jsonb,
  p_printer_id    uuid default null,
  p_job_type      text default 'prep_label',
  p_source_type   text default null,
  p_source_id     uuid default null,
  p_created_by    uuid default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_printer uuid;
  v_id      uuid;
begin
  v_printer := coalesce(
    p_printer_id,
    (select id from public.printers
      where restaurant_id = p_restaurant_id and active and is_default
      limit 1),
    (select id from public.printers
      where restaurant_id = p_restaurant_id and active
      order by created_at limit 1)
  );

  -- No printer at this venue is not an error — the batch was still logged.
  -- Returning null lets the caller stay quiet rather than fail the whole run.
  if v_printer is null then
    return null;
  end if;

  insert into public.print_jobs
    (restaurant_id, printer_id, job_type, payload, source_type, source_id, created_by)
  values
    (p_restaurant_id, v_printer, p_job_type, p_payload, p_source_type, p_source_id, p_created_by)
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.print_enqueue_internal(uuid, jsonb, uuid, text, text, uuid, uuid) from public;

create or replace function public.enqueue_print_job(
  p_restaurant_id uuid,
  p_payload       jsonb,
  p_printer_id    uuid default null,
  p_job_type      text default 'prep_label',
  p_source_type   text default null,
  p_source_id     uuid default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_restaurant_access(p_restaurant_id) then
    raise exception 'enqueue_print_job: no access to that venue' using errcode = '42501';
  end if;
  return public.print_enqueue_internal(
    p_restaurant_id, p_payload, p_printer_id, p_job_type, p_source_type, p_source_id, auth.uid());
end $$;

grant execute on function public.enqueue_print_job(uuid, jsonb, uuid, text, text, uuid) to authenticated;


-- ── 4. Build the label payload for a production run ──────────────────────────
-- One place that decides what goes on a prep label, so the app, the tablet and
-- a reprint all produce the same thing.
create or replace function public.prep_label_payload(p_run_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'recipeName', r.name,
    'venueName',  rest.name,
    'madeAt',     pr.made_at,
    'useBy',      pr.use_by,
    'quantity',   trim(both ' ' from
                    coalesce(to_char(pr.produced_qty, 'FM999999990.###'), '') || ' ' ||
                    coalesce(pr.produced_unit, '')),
    'madeBy',     coalesce(pr.made_by_name, p.full_name),
    'allergens',  to_jsonb(public.recipe_allergens(r.id))
  )
  from public.production_runs pr
  join public.recipes r        on r.id    = pr.recipe_id
  join public.restaurants rest on rest.id = pr.restaurant_id
  left join public.profiles p  on p.id    = pr.made_by
  where pr.id = p_run_id;
$$;

-- Reprint an existing batch's label.
create or replace function public.reprint_production_run(p_run_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  run record;
begin
  select * into run from public.production_runs where id = p_run_id;
  if run.id is null then
    raise exception 'reprint_production_run: run not found';
  end if;
  if not public.has_restaurant_access(run.restaurant_id) then
    raise exception 'reprint_production_run: no access to that venue' using errcode = '42501';
  end if;

  return public.print_enqueue_internal(
    run.restaurant_id, public.prep_label_payload(p_run_id), null,
    'prep_label', 'reprint', p_run_id, auth.uid());
end $$;

grant execute on function public.reprint_production_run(uuid) to authenticated;

-- A test label, for setting a printer up.
create or replace function public.print_test_label(p_restaurant_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_non_staff_access(p_restaurant_id) then
    raise exception 'print_test_label: insufficient privilege' using errcode = '42501';
  end if;
  return public.print_enqueue_internal(
    p_restaurant_id,
    jsonb_build_object(
      'recipeName', 'Test label',
      'venueName',  (select name from public.restaurants where id = p_restaurant_id),
      'madeAt',     now(),
      'useBy',      now() + interval '24 hours',
      'quantity',   '1 each',
      'madeBy',     'The Coop',
      'allergens',  '[]'::jsonb),
    null, 'test', 'test', null, auth.uid());
end $$;

grant execute on function public.print_test_label(uuid) to authenticated;


-- ── 5. Every logged batch prints itself ──────────────────────────────────────
-- A trigger rather than a change to post_production_run: it catches every path
-- at once — the app, the tablet's kiosk_prep_done, anything added later — and
-- avoids re-stating a long function just to append one call. A venue with no
-- printer enqueues nothing and the run is unaffected.
create or replace function public.production_run_autoprint()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.print_enqueue_internal(
    new.restaurant_id,
    public.prep_label_payload(new.id),
    null,
    'prep_label',
    'production_run',
    new.id,
    new.made_by);
  return null;
exception when others then
  -- A label is never worth losing the batch over. Record it and move on.
  raise warning 'production_run_autoprint: could not queue a label for run % (%)', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_production_run_autoprint on public.production_runs;
create trigger trg_production_run_autoprint
  after insert on public.production_runs
  for each row execute function public.production_run_autoprint();


-- ── 6. Seed a printer ────────────────────────────────────────────────────────
-- Fill in the IP from the printer's self-test print, then set it default:
--
--   insert into public.printers (restaurant_id, name, host, is_default)
--   values ('<venue-uuid>', 'Kitchen SUNMI', '192.168.1.36', true);
--
-- Give the printer a DHCP reservation on the router — if its address moves, the
-- queue fills with connection errors and the Printers page will show them.
