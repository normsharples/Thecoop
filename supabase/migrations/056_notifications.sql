-- ============================================================================
-- 056. NOTIFICATIONS — event triggers + prefs  (P5 layer A: in-app)
-- ----------------------------------------------------------------------------
-- The notifications + push_subscriptions tables already exist (migration 042).
-- This wires DB events to create in-app notifications, and adds per-user channel
-- preferences (email/push; in-app is always on). Email + web-push delivery are
-- handled by the notify-dispatch edge function (layers B/C) off these rows.
-- All trigger functions are SECURITY DEFINER so they can insert notifications
-- for other users regardless of who performed the action.
-- ============================================================================

-- Per-user channel preferences (in-app always on).
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{"email": true, "push": true}'::jsonb;

-- ── Roster published → notify everyone rostered that week ─────────────────────
create or replace function public.notify_roster_published()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'published' and (old.status is distinct from 'published') then
    insert into public.notifications (user_id, type, title, body, data)
    select distinct s.employee_id,
      'roster_published',
      'Your roster is published',
      'The roster for the week of ' || to_char(new.week_start, 'FMDD Mon') || ' is now available.',
      jsonb_build_object('path', '/my-roster', 'week_start', new.week_start)
    from public.shifts s
    where s.restaurant_id = new.restaurant_id
      and s.employee_id is not null
      and s.date >= new.week_start
      and s.date < new.week_start + 7;
  end if;
  return new;
end;
$$;

drop trigger if exists roster_weeks_notify on public.roster_weeks;
create trigger roster_weeks_notify
  after update on public.roster_weeks
  for each row execute function public.notify_roster_published();

-- ── Leave approved/declined → notify the employee ────────────────────────────
create or replace function public.notify_leave_decision()
returns trigger language plpgsql security definer as $$
begin
  if new.status in ('approved', 'declined') and new.status is distinct from old.status then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      new.employee_id,
      'leave_decision',
      'Leave request ' || new.status,
      'Your leave (' || to_char(new.start_date, 'FMDD Mon') || ' – ' ||
        to_char(new.end_date, 'FMDD Mon') || ') was ' || new.status || '.',
      jsonb_build_object('path', '/my-roster')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists leave_requests_notify on public.leave_requests;
create trigger leave_requests_notify
  after update on public.leave_requests
  for each row execute function public.notify_leave_decision();

-- ── Shift swap approved → notify both parties ────────────────────────────────
create or replace function public.notify_swap_decision()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'approved' and (old.status is distinct from 'approved') then
    insert into public.notifications (user_id, type, title, body, data)
    select uid, 'swap_approved', 'Shift swap approved',
      'A shift swap you were part of has been approved.',
      jsonb_build_object('path', '/my-roster')
    from (
      select new.offered_by as uid
      union
      select new.claimed_by
    ) u
    where uid is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists shift_swaps_notify on public.shift_swaps;
create trigger shift_swaps_notify
  after update on public.shift_swaps
  for each row execute function public.notify_swap_decision();

-- ============================================================================
-- END OF MIGRATION 056
-- ============================================================================
