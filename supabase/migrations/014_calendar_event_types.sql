-- Migration 014 — Expand calendar event types for promotions, game days, etc.

alter table public.calendar_events
  drop constraint if exists calendar_events_type_check;

alter table public.calendar_events
  add constraint calendar_events_type_check
    check (event_type in (
      'promotion',
      'game_day',
      'holiday',
      'training',
      'store_event',
      'deadline',
      'milestone',
      'meeting',
      'catering',
      'catering_prep',
      'maintenance'
    ));
