-- ============================================================================
-- 064. ONBOARDING REMINDERS + DOCUMENT EXPIRY ALERTS  (O6)
-- ----------------------------------------------------------------------------
-- Two idempotent functions meant to be called once a day. Both de-duplicate off
-- the notifications table itself, so calling them twice in a day is harmless.
--
-- Wire them up either with pg_cron:
--     select cron.schedule('coop-daily-people', '0 20 * * *',
--       $$select public.onboarding_send_reminders(); select public.document_expiry_alerts();$$);
-- ...or by adding two supabase.rpc() calls to the nightly-sync edge function.
-- ============================================================================

-- ── Chase incomplete onboarding at 48 hours and 7 days ──────────────────────
create or replace function public.onboarding_send_reminders()
returns integer language plpgsql security definer as $$
declare
  sent integer := 0;
begin
  with due as (
    select ob.employee_id,
           case
             when now() - ob.requested_at >= interval '7 days'  then 'onboarding_reminder_7d'
             when now() - ob.requested_at >= interval '48 hours' then 'onboarding_reminder_48h'
           end as kind
    from public.employee_onboarding ob
    where ob.status in ('pending', 'in_progress')
      and ob.requested_at is not null
  ),
  fresh as (
    select d.employee_id, d.kind
    from due d
    where d.kind is not null
      and not exists (
        select 1 from public.notifications n
        where n.user_id = d.employee_id
          and n.type = d.kind
      )
  ),
  ins as (
    insert into public.notifications (user_id, type, title, body, data)
    select f.employee_id, f.kind,
           'Finish your onboarding',
           case when f.kind = 'onboarding_reminder_7d'
                then 'Your details and contract are still outstanding. It takes about five minutes.'
                else 'You still have a few details to fill in before your paperwork is done.'
           end,
           jsonb_build_object('path', '/onboarding')
    from fresh f
    returning 1
  )
  select count(*) into sent from ins;

  -- Weekly digest to the owner: who is still outstanding (Mondays only).
  if extract(isodow from now() at time zone 'Australia/Melbourne') = 1 then
    insert into public.notifications (user_id, type, title, body, data)
    select pr.id, 'onboarding_digest',
           'Onboarding outstanding',
           (select count(*)::text from public.employee_onboarding
             where status in ('pending','in_progress'))
             || ' team member(s) have not finished their onboarding.',
           jsonb_build_object('path', '/admin/team')
    from public.profiles pr
    where pr.role = 'superadmin'
      and exists (select 1 from public.employee_onboarding where status in ('pending','in_progress'))
      and not exists (
        select 1 from public.notifications n
        where n.user_id = pr.id and n.type = 'onboarding_digest'
          and n.created_at > now() - interval '6 days'
      );
  end if;

  return sent;
end;
$$;

-- ── Warn 30 days out on certificates and visas ──────────────────────────────
create or replace function public.document_expiry_alerts()
returns integer language plpgsql security definer as $$
declare
  sent integer := 0;
begin
  with expiring as (
    -- Uploaded documents (RSA, food handler, visa scans…)
    select d.employee_id,
           coalesce(d.label, d.kind) as what,
           d.expires_on,
           'doc:' || d.id::text as ref
    from public.employee_documents d
    where d.expires_on is not null
      and d.expires_on between current_date and current_date + 30
    union all
    -- Visa expiry recorded on the profile itself
    select p.id,
           'work visa (subclass ' || coalesce(p.visa_subclass, '?') || ')',
           p.visa_expiry,
           'visa:' || p.id::text
    from public.profiles p
    where p.work_eligibility = 'visa'
      and p.visa_expiry is not null
      and p.visa_expiry between current_date and current_date + 30
  ),
  fresh as (
    select * from expiring e
    where not exists (
      select 1 from public.notifications n
      where n.type = 'document_expiry'
        and n.data->>'ref' = e.ref
        and n.created_at > now() - interval '30 days'
    )
  ),
  ins as (
    -- The employee...
    insert into public.notifications (user_id, type, title, body, data)
    select f.employee_id, 'document_expiry',
           'Your ' || f.what || ' expires soon',
           'It expires on ' || to_char(f.expires_on, 'FMDD Mon YYYY') || '. Please upload a new one from My Profile.',
           jsonb_build_object('path', '/my-profile', 'ref', f.ref)
    from fresh f
    returning 1
  )
  select count(*) into sent from ins;

  -- ...and the owner.
  insert into public.notifications (user_id, type, title, body, data)
  select pr.id, 'document_expiry',
         coalesce(emp.full_name, 'A team member') || ': ' || e.what || ' expires soon',
         'Expires ' || to_char(e.expires_on, 'FMDD Mon YYYY') || '.',
         jsonb_build_object('path', '/admin/team', 'ref', 'admin:' || e.ref)
  from (
    select d.employee_id, coalesce(d.label, d.kind) as what, d.expires_on, 'doc:' || d.id::text as ref
    from public.employee_documents d
    where d.expires_on between current_date and current_date + 30
    union all
    select p.id, 'work visa', p.visa_expiry, 'visa:' || p.id::text
    from public.profiles p
    where p.work_eligibility = 'visa' and p.visa_expiry between current_date and current_date + 30
  ) e
  join public.profiles emp on emp.id = e.employee_id
  cross join public.profiles pr
  where pr.role = 'superadmin'
    and not exists (
      select 1 from public.notifications n
      where n.type = 'document_expiry'
        and n.user_id = pr.id
        and n.data->>'ref' = 'admin:' || e.ref
        and n.created_at > now() - interval '30 days'
    );

  return sent;
end;
$$;
