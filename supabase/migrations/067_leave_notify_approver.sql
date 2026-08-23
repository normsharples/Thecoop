-- ============================================================================
-- 067. LEAVE REQUESTS PICK AN APPROVER
-- ----------------------------------------------------------------------------
-- Requesting leave now means choosing WHO it goes to, and that person gets the
-- notification. Until now nothing fired on insert at all — a request sat in the
-- approvals list until someone happened to look.
--
-- A team member cannot read other profiles (042 RLS: own row, or rosterable
-- rows if you're a roster manager), so the picker is fed by a SECURITY DEFINER
-- function that exposes only the id and name of superadmins — nothing else.
-- ============================================================================

alter table public.leave_requests
  add column if not exists notify_user_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_leave_requests_notify on public.leave_requests(notify_user_id);

-- ── Who can be picked ───────────────────────────────────────────────────────
create or replace function public.list_leave_approvers()
returns table (id uuid, full_name text)
language sql security definer stable as $$
  select p.id, p.full_name
  from public.profiles p
  where p.role = 'superadmin'
  order by p.full_name;
$$;

grant execute on function public.list_leave_approvers() to authenticated;

-- ── Tell them ───────────────────────────────────────────────────────────────
create or replace function public.notify_leave_requested()
returns trigger language plpgsql security definer as $$
declare
  who text;
  span text;
begin
  select full_name into who from public.profiles where id = new.employee_id;
  span := to_char(new.start_date, 'FMDD Mon') ||
          case when new.end_date <> new.start_date
               then ' – ' || to_char(new.end_date, 'FMDD Mon') else '' end;

  if new.notify_user_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      new.notify_user_id,
      'leave_requested',
      'Leave request from ' || coalesce(who, 'a team member'),
      coalesce(who, 'A team member') || ' requested ' || new.leave_type ||
        ' leave for ' || span || '.' ||
        case when coalesce(new.note, '') <> '' then ' Note: ' || new.note else '' end,
      jsonb_build_object('path', '/rostering', 'leave_id', new.id)
    );
  else
    -- Created without a nominated approver (a manager entering it on someone's
    -- behalf, or a row from before this migration) — fall back to every
    -- superadmin so a request can never land silently.
    insert into public.notifications (user_id, type, title, body, data)
    select pr.id,
      'leave_requested',
      'Leave request from ' || coalesce(who, 'a team member'),
      coalesce(who, 'A team member') || ' requested ' || new.leave_type ||
        ' leave for ' || span || '.',
      jsonb_build_object('path', '/rostering', 'leave_id', new.id)
    from public.profiles pr
    where pr.role = 'superadmin' and pr.id <> new.employee_id;
  end if;

  return new;
end;
$$;

drop trigger if exists leave_requests_notify_insert on public.leave_requests;
create trigger leave_requests_notify_insert
  after insert on public.leave_requests
  for each row execute function public.notify_leave_requested();
