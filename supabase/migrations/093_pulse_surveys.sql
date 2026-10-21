-- ============================================================================
-- 093. PULSE SURVEYS  (in-app only — no email anywhere in this module)
-- ----------------------------------------------------------------------------
-- Anonymous team check-ins, per brand, with a hard anonymity floor.
--
-- The security model is the whole point of this file, so it is worth stating
-- plainly before the schema:
--
--   • pulse_responses carries NO user_id. There is no column, so there is
--     nothing to leak and nothing to join on.
--   • pulse_responses has RLS enabled and NOT ONE POLICY. Nobody — staff,
--     venue manager, brand admin, superadmin — can select, insert, update or
--     delete a row through the API. Every read goes through an aggregate
--     function in this file; the one write goes through pulse_submit().
--   • Every aggregate function enforces the 5-response floor server-side.
--     Suppression is not a UI decision.
--   • pulse_completions (who answered, for reminders only) is readable ONLY
--     as your own row. Managers never get names, not even counts — response
--     rate is derived from the anonymous responses instead, so the two data
--     sets are never queried together.
--
-- One addition to the original design: pulse_responses.submission_id. A single
-- submission writes one row per question, so without it there is no way to
-- count *respondents* per venue — and the 5-response floor needs exactly that.
-- It is a fresh random uuid per submission with no relationship to the person,
-- the session or the time; it groups rows and nothing else.
--
-- Safe to re-run.
-- ============================================================================

-- ── The anonymity floor, in one place ───────────────────────────────────────
create or replace function public.pulse_min_responses()
returns integer as $$ select 5; $$ language sql immutable;

-- ============================================================================
-- QUESTION BANK  (brand-level only — there is no venue-level question)
-- ============================================================================
create table if not exists public.pulse_questions (
  id                  uuid        primary key default uuid_generate_v4(),
  brand_id            uuid        not null references public.brands(id) on delete cascade,
  text                text        not null,
  type                text        not null check (type in ('scale_1_5', 'text')),
  is_active           boolean     not null default true,
  sort_order          integer     not null default 0,
  version             integer     not null default 1,
  -- Set when this row replaced an earlier wording that already had responses.
  previous_version_id uuid        references public.pulse_questions(id) on delete set null,
  created_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_pulse_questions_brand on public.pulse_questions(brand_id, sort_order);

alter table public.pulse_questions enable row level security;

-- Wording is not sensitive, and staff need it to answer. Scoped to brands the
-- person can see at all.
drop policy if exists "pulse_questions_select" on public.pulse_questions;
create policy "pulse_questions_select" on public.pulse_questions
  for select using (brand_id in (select b from public.my_brand_ids() b));

-- Brand admins only. A venue manager cannot add, edit or remove a question.
drop policy if exists "pulse_questions_insert" on public.pulse_questions;
create policy "pulse_questions_insert" on public.pulse_questions
  for insert with check (public.has_brand_admin(brand_id));
drop policy if exists "pulse_questions_update" on public.pulse_questions;
create policy "pulse_questions_update" on public.pulse_questions
  for update using (public.has_brand_admin(brand_id));
drop policy if exists "pulse_questions_delete" on public.pulse_questions;
create policy "pulse_questions_delete" on public.pulse_questions
  for delete using (public.has_brand_admin(brand_id));

-- ============================================================================
-- SURVEYS
-- ============================================================================
create table if not exists public.pulse_surveys (
  id               uuid        primary key default uuid_generate_v4(),
  brand_id         uuid        not null references public.brands(id) on delete cascade,
  title            text        not null,
  opens_at         timestamptz not null,
  closes_at        timestamptz not null,
  status           text        not null default 'scheduled'
                               check (status in ('scheduled', 'open', 'closed')),
  recurrence       text        not null default 'none'
                               check (recurrence in ('none', 'weekly', 'fortnightly', 'monthly')),
  target           text        not null default 'all_venues'
                               check (target in ('all_venues', 'selected')),
  target_venue_ids uuid[]      not null default '{}',
  created_by       uuid        references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pulse_surveys_window check (closes_at > opens_at)
);

create index if not exists idx_pulse_surveys_brand on public.pulse_surveys(brand_id, opens_at desc);

alter table public.pulse_surveys enable row level security;

drop policy if exists "pulse_surveys_select" on public.pulse_surveys;
create policy "pulse_surveys_select" on public.pulse_surveys
  for select using (brand_id in (select b from public.my_brand_ids() b));
drop policy if exists "pulse_surveys_insert" on public.pulse_surveys;
create policy "pulse_surveys_insert" on public.pulse_surveys
  for insert with check (public.has_brand_admin(brand_id));
drop policy if exists "pulse_surveys_update" on public.pulse_surveys;
create policy "pulse_surveys_update" on public.pulse_surveys
  for update using (public.has_brand_admin(brand_id));
drop policy if exists "pulse_surveys_delete" on public.pulse_surveys;
create policy "pulse_surveys_delete" on public.pulse_surveys
  for delete using (public.has_brand_admin(brand_id));

drop trigger if exists pulse_surveys_updated_at on public.pulse_surveys;
create trigger pulse_surveys_updated_at
  before update on public.pulse_surveys
  for each row execute function public.handle_updated_at();

-- ── Which questions this survey asks ────────────────────────────────────────
-- A recurring survey reuses this same set every cycle, which is what makes the
-- trend line comparable across cycles.
create table if not exists public.pulse_survey_questions (
  survey_id   uuid    not null references public.pulse_surveys(id)   on delete cascade,
  question_id uuid    not null references public.pulse_questions(id) on delete cascade,
  sort_order  integer not null default 0,
  primary key (survey_id, question_id)
);

create index if not exists idx_pulse_survey_questions_survey
  on public.pulse_survey_questions(survey_id, sort_order);

alter table public.pulse_survey_questions enable row level security;

drop policy if exists "pulse_survey_questions_select" on public.pulse_survey_questions;
create policy "pulse_survey_questions_select" on public.pulse_survey_questions
  for select using (
    exists (select 1 from public.pulse_surveys s
            where s.id = survey_id and s.brand_id in (select b from public.my_brand_ids() b))
  );

drop policy if exists "pulse_survey_questions_insert" on public.pulse_survey_questions;
create policy "pulse_survey_questions_insert" on public.pulse_survey_questions
  for insert with check (
    exists (select 1 from public.pulse_surveys s
            where s.id = survey_id and public.has_brand_admin(s.brand_id))
  );
drop policy if exists "pulse_survey_questions_update" on public.pulse_survey_questions;
create policy "pulse_survey_questions_update" on public.pulse_survey_questions
  for update using (
    exists (select 1 from public.pulse_surveys s
            where s.id = survey_id and public.has_brand_admin(s.brand_id))
  );
drop policy if exists "pulse_survey_questions_delete" on public.pulse_survey_questions;
create policy "pulse_survey_questions_delete" on public.pulse_survey_questions
  for delete using (
    exists (select 1 from public.pulse_surveys s
            where s.id = survey_id and public.has_brand_admin(s.brand_id))
  );

-- ============================================================================
-- COMPLETIONS  (who answered — for reminders, and nothing else)
-- ============================================================================
-- Deliberately has no venue, no role and no link to any response row. Its only
-- job is to stop the banner nagging someone who has already answered.
create table if not exists public.pulse_completions (
  survey_id    uuid        not null references public.pulse_surveys(id) on delete cascade,
  cycle_start  date        not null,
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (survey_id, cycle_start, user_id)
);

alter table public.pulse_completions enable row level security;

-- Your own row only. There is no manager-facing policy at all: response rate
-- comes from the anonymous response rows, so nobody ever needs to read this
-- table for anyone but themselves.
drop policy if exists "pulse_completions_select" on public.pulse_completions;
create policy "pulse_completions_select" on public.pulse_completions
  for select using (user_id = auth.uid());

-- Written only by pulse_submit(). No insert/update/delete policy.

-- ============================================================================
-- RESPONSES  (anonymous — no user_id, and no RLS policies whatsoever)
-- ============================================================================
create table if not exists public.pulse_responses (
  id            uuid        primary key default uuid_generate_v4(),
  survey_id     uuid        not null references public.pulse_surveys(id)   on delete cascade,
  cycle_start   date        not null,
  -- Groups the rows of one submission so respondents can be counted. Random,
  -- and related to nothing else in the database.
  submission_id uuid        not null,
  venue_id      uuid        references public.restaurants(id) on delete set null,
  role          text,
  question_id   uuid        not null references public.pulse_questions(id) on delete cascade,
  value_int     smallint    check (value_int is null or value_int between 1 and 5),
  value_text    text,
  submitted_at  timestamptz not null default now()
);

create index if not exists idx_pulse_responses_cycle
  on public.pulse_responses(survey_id, cycle_start, venue_id);
create index if not exists idx_pulse_responses_question
  on public.pulse_responses(question_id);

alter table public.pulse_responses enable row level security;
-- INTENTIONALLY NO POLICIES. Reads go through the aggregate functions below;
-- the single write goes through pulse_submit(). Adding a select policy here
-- would defeat the entire module.

-- ============================================================================
-- CYCLES
-- A recurring survey repeats the same open window on its period. The cycle a
-- moment falls in is derived, never stored on the survey.
-- ============================================================================
create or replace function public.pulse_cycle(p_survey uuid, p_at timestamptz default now())
returns table (
  cycle_start  date,
  cycle_opens  timestamptz,
  cycle_closes timestamptz,
  is_live      boolean
)
language plpgsql stable as $$
declare
  s   public.pulse_surveys%rowtype;
  dur interval;
  n   integer;
begin
  select * into s from public.pulse_surveys where id = p_survey;
  if not found then return; end if;

  dur := s.closes_at - s.opens_at;

  if p_at < s.opens_at or s.recurrence = 'none' then
    cycle_opens := s.opens_at;
  elsif s.recurrence = 'weekly' then
    n := floor(extract(epoch from (p_at - s.opens_at)) / 604800);
    cycle_opens := s.opens_at + (n * interval '7 days');
  elsif s.recurrence = 'fortnightly' then
    n := floor(extract(epoch from (p_at - s.opens_at)) / 1209600);
    cycle_opens := s.opens_at + (n * interval '14 days');
  else -- monthly
    n := (extract(year from p_at) - extract(year from s.opens_at))::integer * 12
       + (extract(month from p_at) - extract(month from s.opens_at))::integer;
    if s.opens_at + (n * interval '1 month') > p_at then
      n := n - 1;
    end if;
    cycle_opens := s.opens_at + (greatest(n, 0) * interval '1 month');
  end if;

  cycle_closes := cycle_opens + dur;
  cycle_start  := cycle_opens::date;
  is_live      := s.status <> 'closed' and p_at >= cycle_opens and p_at < cycle_closes;
  return next;
end;
$$;

-- Which venues a survey is aimed at, always intersected with the brand's own
-- active venues so a stale id in target_venue_ids can never widen the audience.
create or replace function public.pulse_target_venues(p_survey uuid)
returns setof uuid language sql stable as $$
  select r.id
  from public.pulse_surveys s
  join public.restaurants r
    on r.brand_id = s.brand_id
   and r.status = 'active'
   and (s.target = 'all_venues' or r.id = any(s.target_venue_ids))
  where s.id = p_survey;
$$;

-- ============================================================================
-- STAFF SIDE
-- ============================================================================

-- Surveys open right now for my venue that I have not answered this cycle.
-- Drives the dashboard banner and the Team nav badge.
create or replace function public.pulse_open_for_me()
returns table (
  survey_id      uuid,
  title          text,
  cycle_start    date,
  cycle_closes   timestamptz,
  question_count integer
)
language sql security definer stable as $$
  select s.id,
         s.title,
         c.cycle_start,
         c.cycle_closes,
         (select count(*)::integer from public.pulse_survey_questions q where q.survey_id = s.id)
  from public.pulse_surveys s
  cross join lateral public.pulse_cycle(s.id) c
  where c.is_live
    and public.my_home_venue() in (select v from public.pulse_target_venues(s.id) v)
    and exists (select 1 from public.pulse_survey_questions q where q.survey_id = s.id)
    and not exists (
      select 1 from public.pulse_completions pc
      where pc.survey_id = s.id
        and pc.cycle_start = c.cycle_start
        and pc.user_id = auth.uid()
    )
  order by c.cycle_closes;
$$;

grant execute on function public.pulse_open_for_me() to authenticated;

-- The questions to put on screen, one per step.
create or replace function public.pulse_questions_for_survey(p_survey uuid)
returns table (
  question_id uuid,
  text        text,
  type        text,
  sort_order  integer
)
language plpgsql security definer stable as $$
declare
  v_live   boolean;
  v_brand  uuid;
begin
  select s.brand_id into v_brand from public.pulse_surveys s where s.id = p_survey;
  if v_brand is null then
    raise exception 'Survey not found';
  end if;

  select c.is_live into v_live from public.pulse_cycle(p_survey) c;

  -- Either it is open for me, or I am a brand admin previewing it.
  if not (
    (coalesce(v_live, false)
      and public.my_home_venue() in (select v from public.pulse_target_venues(p_survey) v))
    or public.has_brand_admin(v_brand)
  ) then
    raise exception 'This survey is not open for you';
  end if;

  return query
    select q.id, q.text, q.type, sq.sort_order
    from public.pulse_survey_questions sq
    join public.pulse_questions q on q.id = sq.question_id
    where sq.survey_id = p_survey
    order by sq.sort_order, q.text;
end;
$$;

grant execute on function public.pulse_questions_for_survey(uuid) to authenticated;

-- ── Submit ──────────────────────────────────────────────────────────────────
-- p_answers: [{"question_id":"…","value_int":4}, {"question_id":"…","value_text":"…"}]
--
-- Responses are written first, under a fresh submission_id, then the
-- completion row. They are separate statements against separate tables with no
-- shared key, exactly as designed — but they are one transaction, so a
-- submission can never land without its completion row (which would leave the
-- banner nagging someone who has already answered).
create or replace function public.pulse_submit(p_survey uuid, p_answers jsonb)
returns void language plpgsql security definer as $$
declare
  v_live       boolean;
  v_cycle      date;
  v_venue      uuid := public.my_home_venue();
  v_role       text;
  v_submission uuid := uuid_generate_v4();
  v_answer     jsonb;
  v_qid        uuid;
  v_type       text;
  v_int        smallint;
  v_text       text;
  v_written    integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select c.is_live, c.cycle_start into v_live, v_cycle
  from public.pulse_cycle(p_survey) c;

  if not coalesce(v_live, false) then
    raise exception 'This survey is not open';
  end if;

  if v_venue is null or v_venue not in (select v from public.pulse_target_venues(p_survey) v) then
    raise exception 'This survey is not open for your venue';
  end if;

  if exists (
    select 1 from public.pulse_completions
    where survey_id = p_survey and cycle_start = v_cycle and user_id = auth.uid()
  ) then
    raise exception 'You have already answered this check-in';
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    v_qid := nullif(v_answer->>'question_id', '')::uuid;
    if v_qid is null then continue; end if;

    -- The question has to belong to this survey; nothing else is accepted.
    select q.type into v_type
    from public.pulse_survey_questions sq
    join public.pulse_questions q on q.id = sq.question_id
    where sq.survey_id = p_survey and sq.question_id = v_qid;

    if v_type is null then
      raise exception 'Question does not belong to this check-in';
    end if;

    v_int  := null;
    v_text := null;

    if v_type = 'scale_1_5' then
      v_int := nullif(v_answer->>'value_int', '')::smallint;
      if v_int is null then continue; end if;             -- unanswered scale: skip
      if v_int < 1 or v_int > 5 then
        raise exception 'Scale answers must be 1 to 5';
      end if;
    else
      v_text := nullif(btrim(coalesce(v_answer->>'value_text', '')), '');
      if v_text is null then continue; end if;            -- free text is optional
      v_text := left(v_text, 2000);
    end if;

    insert into public.pulse_responses (
      survey_id, cycle_start, submission_id, venue_id, role, question_id, value_int, value_text
    )
    values (p_survey, v_cycle, v_submission, v_venue, v_role, v_qid, v_int, v_text);

    v_written := v_written + 1;
  end loop;

  if v_written = 0 then
    raise exception 'Nothing to submit';
  end if;

  insert into public.pulse_completions (survey_id, cycle_start, user_id)
  values (p_survey, v_cycle, auth.uid());
end;
$$;

grant execute on function public.pulse_submit(uuid, jsonb) to authenticated;

-- ============================================================================
-- REPORTING  (every function below enforces the 5-response floor itself)
-- ============================================================================

-- Brand admins see the whole brand; a venue manager sees only their own venue.
create or replace function public.pulse_can_view(p_survey uuid, p_venue uuid default null)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.pulse_surveys s
    where s.id = p_survey
      and (
        public.has_brand_admin(s.brand_id)
        or (p_venue is not null
            and public.has_roster_manage(p_venue)
            and p_venue in (select v from public.pulse_target_venues(p_survey) v))
      )
  );
$$;

-- Respondents and response rate per venue. The numerator is distinct
-- submissions off the anonymous rows — pulse_completions is never touched.
create or replace function public.pulse_response_rate(
  p_survey uuid,
  p_cycle_start date default null,
  p_venue uuid default null
)
returns table (
  venue_id    uuid,
  venue_name  text,
  responses   integer,
  eligible    integer,
  rate        numeric,
  met_floor   boolean
)
language plpgsql security definer stable as $$
declare
  v_cycle date := p_cycle_start;
  v_floor integer := public.pulse_min_responses();
begin
  if not public.pulse_can_view(p_survey, p_venue) then
    raise exception 'Not allowed to view these results';
  end if;

  if v_cycle is null then
    select c.cycle_start into v_cycle from public.pulse_cycle(p_survey) c;
  end if;

  return query
    select r.id,
           r.name,
           coalesce(a.n, 0)::integer,
           coalesce(e.n, 0)::integer,
           case when coalesce(e.n, 0) = 0 then null
                else round(coalesce(a.n, 0)::numeric * 100 / e.n, 0) end,
           coalesce(a.n, 0) >= v_floor
    from public.restaurants r
    left join lateral (
      select count(distinct pr.submission_id) as n
      from public.pulse_responses pr
      where pr.survey_id = p_survey
        and pr.cycle_start = v_cycle
        and pr.venue_id = r.id
    ) a on true
    left join lateral (
      select count(*) as n
      from public.profiles p
      where p.home_restaurant_id = r.id
        and coalesce(p.is_rosterable, false)
        and p.access_revoked_at is null
    ) e on true
    where r.id in (select v from public.pulse_target_venues(p_survey) v)
      and (p_venue is null or r.id = p_venue)
    order by r.name;
end;
$$;

grant execute on function public.pulse_response_rate(uuid, date, uuid) to authenticated;

-- Average per question for one venue (or the whole brand when p_venue is null).
-- Suppressed below the floor — the average is returned as null and
-- met_floor is false, so the UI has nothing to display even by accident.
create or replace function public.pulse_question_averages(
  p_survey uuid,
  p_cycle_start date default null,
  p_venue uuid default null
)
returns table (
  question_id   uuid,
  question_text text,
  question_type text,
  sort_order    integer,
  responses     integer,
  average       numeric,
  met_floor     boolean
)
language plpgsql security definer stable as $$
declare
  v_cycle date := p_cycle_start;
  v_floor integer := public.pulse_min_responses();
  v_group integer;
begin
  if not public.pulse_can_view(p_survey, p_venue) then
    raise exception 'Not allowed to view these results';
  end if;

  if v_cycle is null then
    select c.cycle_start into v_cycle from public.pulse_cycle(p_survey) c;
  end if;

  -- The floor applies to the grouping being shown, not to each question: one
  -- venue-cycle either clears 5 respondents or shows nothing at all.
  select count(distinct pr.submission_id) into v_group
  from public.pulse_responses pr
  where pr.survey_id = p_survey
    and pr.cycle_start = v_cycle
    and (p_venue is null or pr.venue_id = p_venue);

  return query
    select q.id,
           q.text,
           q.type,
           sq.sort_order,
           coalesce(n.cnt, 0)::integer,
           case when v_group >= v_floor then n.avg_value else null end,
           v_group >= v_floor
    from public.pulse_survey_questions sq
    join public.pulse_questions q on q.id = sq.question_id
    left join lateral (
      select count(pr.value_int) as cnt, round(avg(pr.value_int)::numeric, 2) as avg_value
      from public.pulse_responses pr
      where pr.survey_id = p_survey
        and pr.cycle_start = v_cycle
        and pr.question_id = q.id
        and (p_venue is null or pr.venue_id = p_venue)
    ) n on true
    where sq.survey_id = p_survey
      and q.type = 'scale_1_5'
    order by sq.sort_order, q.text;
end;
$$;

grant execute on function public.pulse_question_averages(uuid, date, uuid) to authenticated;

-- The last N cycles for one venue (or the brand): overall average plus the
-- per-question averages, for the trend line.
create or replace function public.pulse_trend(
  p_survey uuid,
  p_venue uuid default null,
  p_cycles integer default 12
)
returns table (
  cycle_start   date,
  responses     integer,
  overall       numeric,
  question_id   uuid,
  question_text text,
  average       numeric,
  met_floor     boolean
)
language plpgsql security definer stable as $$
declare
  v_floor integer := public.pulse_min_responses();
begin
  if not public.pulse_can_view(p_survey, p_venue) then
    raise exception 'Not allowed to view these results';
  end if;

  return query
    with cycles as (
      select distinct pr.cycle_start as cs
      from public.pulse_responses pr
      where pr.survey_id = p_survey
        and (p_venue is null or pr.venue_id = p_venue)
      order by 1 desc
      limit greatest(coalesce(p_cycles, 12), 1)
    ),
    sized as (
      select c.cs,
             (select count(distinct pr.submission_id)
                from public.pulse_responses pr
               where pr.survey_id = p_survey
                 and pr.cycle_start = c.cs
                 and (p_venue is null or pr.venue_id = p_venue))::integer as n
      from cycles c
    )
    select s.cs,
           s.n,
           case when s.n >= v_floor then (
             select round(avg(pr.value_int)::numeric, 2)
             from public.pulse_responses pr
             where pr.survey_id = p_survey
               and pr.cycle_start = s.cs
               and pr.value_int is not null
               and (p_venue is null or pr.venue_id = p_venue)
           ) end,
           q.id,
           q.text,
           case when s.n >= v_floor then (
             select round(avg(pr.value_int)::numeric, 2)
             from public.pulse_responses pr
             where pr.survey_id = p_survey
               and pr.cycle_start = s.cs
               and pr.question_id = q.id
               and (p_venue is null or pr.venue_id = p_venue)
           ) end,
           s.n >= v_floor
    from sized s
    join public.pulse_survey_questions sq on sq.survey_id = p_survey
    join public.pulse_questions q on q.id = sq.question_id and q.type = 'scale_1_5'
    order by s.cs, sq.sort_order;
end;
$$;

grant execute on function public.pulse_trend(uuid, uuid, integer) to authenticated;

-- Free-text answers: shuffled, no timestamp, no role, no venue when the brand
-- view asks for them. Suppressed below the floor.
create or replace function public.pulse_comments(
  p_survey uuid,
  p_cycle_start date default null,
  p_venue uuid default null
)
returns table (comment text)
language plpgsql security definer as $$   -- volatile: it shuffles
declare
  v_cycle date := p_cycle_start;
  v_floor integer := public.pulse_min_responses();
  v_group integer;
begin
  if not public.pulse_can_view(p_survey, p_venue) then
    raise exception 'Not allowed to view these results';
  end if;

  if v_cycle is null then
    select c.cycle_start into v_cycle from public.pulse_cycle(p_survey) c;
  end if;

  select count(distinct pr.submission_id) into v_group
  from public.pulse_responses pr
  where pr.survey_id = p_survey
    and pr.cycle_start = v_cycle
    and (p_venue is null or pr.venue_id = p_venue);

  if v_group < v_floor then
    return;
  end if;

  return query
    select pr.value_text
    from public.pulse_responses pr
    where pr.survey_id = p_survey
      and pr.cycle_start = v_cycle
      and pr.value_text is not null
      and (p_venue is null or pr.venue_id = p_venue)
    order by random();
end;
$$;

grant execute on function public.pulse_comments(uuid, date, uuid) to authenticated;

-- Venue benchmarking. Brand admins only — a venue manager has no business
-- comparing other venues. Comparison is per survey, so by construction every
-- venue in the table was asked the same questions.
create or replace function public.pulse_benchmark(
  p_survey uuid,
  p_cycle_start date default null
)
returns table (
  venue_id      uuid,
  venue_name    text,
  responses     integer,
  eligible      integer,
  met_floor     boolean,
  overall       numeric,
  question_id   uuid,
  question_text text,
  average       numeric,
  flagged       boolean,
  flag_reason   text
)
language plpgsql security definer stable as $$
declare
  v_cycle date := p_cycle_start;
  v_floor integer := public.pulse_min_responses();
  v_brand uuid;
begin
  select s.brand_id into v_brand from public.pulse_surveys s where s.id = p_survey;
  if v_brand is null or not public.has_brand_admin(v_brand) then
    raise exception 'Not allowed to view brand results';
  end if;

  if v_cycle is null then
    select c.cycle_start into v_cycle from public.pulse_cycle(p_survey) c;
  end if;

  return query
    with venues as (
      select r.id, r.name,
             (select count(distinct pr.submission_id) from public.pulse_responses pr
               where pr.survey_id = p_survey and pr.cycle_start = v_cycle and pr.venue_id = r.id
             )::integer as n,
             (select count(*) from public.profiles p
               where p.home_restaurant_id = r.id
                 and coalesce(p.is_rosterable, false)
                 and p.access_revoked_at is null
             )::integer as eligible
      from public.restaurants r
      where r.id in (select v from public.pulse_target_venues(p_survey) v)
    ),
    qs as (
      select q.id, q.text, sq.sort_order
      from public.pulse_survey_questions sq
      join public.pulse_questions q on q.id = sq.question_id
      where sq.survey_id = p_survey and q.type = 'scale_1_5'
    ),
    cell as (
      select v.id as vid, q.id as qid,
             (select round(avg(pr.value_int)::numeric, 2) from public.pulse_responses pr
               where pr.survey_id = p_survey and pr.cycle_start = v_cycle
                 and pr.venue_id = v.id and pr.question_id = q.id) as avg_now,
             -- The venue's own average for this question over the four cycles
             -- before this one. Self-comparison, never cross-venue.
             (select round(avg(pr.value_int)::numeric, 2) from public.pulse_responses pr
               where pr.survey_id = p_survey
                 and pr.venue_id = v.id
                 and pr.question_id = q.id
                 and pr.cycle_start in (
                   select distinct c2.cycle_start from public.pulse_responses c2
                   where c2.survey_id = p_survey and c2.venue_id = v.id
                     and c2.cycle_start < v_cycle
                   order by 1 desc limit 4
                 )) as avg_before
      from venues v cross join qs q
    )
    select v.id, v.name, v.n, v.eligible, v.n >= v_floor,
           case when v.n >= v_floor then (
             select round(avg(pr.value_int)::numeric, 2) from public.pulse_responses pr
             where pr.survey_id = p_survey and pr.cycle_start = v_cycle
               and pr.venue_id = v.id and pr.value_int is not null
           ) end,
           q.id, q.text,
           case when v.n >= v_floor then c.avg_now end,
           v.n >= v_floor
             and c.avg_now is not null and c.avg_before is not null
             and (c.avg_before - c.avg_now) >= 0.5,
           case when v.n >= v_floor
                      and c.avg_now is not null and c.avg_before is not null
                      and (c.avg_before - c.avg_now) >= 0.5
                then 'Down ' || to_char(c.avg_before - c.avg_now, 'FM0.0')
                     || ' on its own 4-cycle average'
           end
    from venues v
    cross join qs q
    join cell c on c.vid = v.id and c.qid = q.id
    order by v.name, q.sort_order;
end;
$$;

grant execute on function public.pulse_benchmark(uuid, date) to authenticated;

-- ============================================================================
-- QUESTION VERSIONING
-- Never overwrite wording that already has responses tied to it: the old row
-- stays exactly as it was asked, a new version takes its place, and only
-- surveys that have not opened yet are swapped over. An open or closed survey
-- keeps the wording it was answered under, so its trend stays comparable.
-- ============================================================================
create or replace function public.pulse_save_question(
  p_question_id uuid,
  p_text        text,
  p_is_active   boolean default null,
  p_sort_order  integer default null
)
returns uuid language plpgsql security definer as $$
declare
  q           public.pulse_questions%rowtype;
  v_text      text := btrim(coalesce(p_text, ''));
  v_has_resp  boolean;
  v_new_id    uuid;
  v_swapped   integer := 0;
begin
  select * into q from public.pulse_questions where id = p_question_id;
  if not found then raise exception 'Question not found'; end if;
  if not public.has_brand_admin(q.brand_id) then
    raise exception 'Only a brand admin can edit the question bank';
  end if;
  if v_text = '' then raise exception 'Question text is required'; end if;

  -- Wording unchanged → an ordinary edit, no new version.
  if v_text = q.text then
    update public.pulse_questions
       set is_active  = coalesce(p_is_active, is_active),
           sort_order = coalesce(p_sort_order, sort_order)
     where id = q.id;
    return q.id;
  end if;

  select exists (select 1 from public.pulse_responses where question_id = q.id)
    into v_has_resp;

  -- No responses yet → safe to edit in place.
  if not v_has_resp then
    update public.pulse_questions
       set text       = v_text,
           is_active  = coalesce(p_is_active, is_active),
           sort_order = coalesce(p_sort_order, sort_order)
     where id = q.id;
    return q.id;
  end if;

  insert into public.pulse_questions (
    brand_id, text, type, is_active, sort_order, version, previous_version_id, created_by
  )
  values (
    q.brand_id, v_text, q.type, coalesce(p_is_active, true),
    coalesce(p_sort_order, q.sort_order), q.version + 1, q.id, auth.uid()
  )
  returning id into v_new_id;

  -- The old wording is retired but kept, so its responses still make sense.
  update public.pulse_questions set is_active = false where id = q.id;

  -- Swap into surveys that have not opened yet.
  with swapped as (
    update public.pulse_survey_questions sq
       set question_id = v_new_id
     where sq.question_id = q.id
       and exists (
         select 1 from public.pulse_surveys s
         where s.id = sq.survey_id and s.status = 'scheduled'
       )
       and not exists (
         select 1 from public.pulse_survey_questions x
         where x.survey_id = sq.survey_id and x.question_id = v_new_id
       )
    returning 1
  )
  select count(*) into v_swapped from swapped;

  perform public.team_audit(
    'pulse', 'question_versioned', 'pulse_question', v_new_id, v_text,
    q.brand_id, null, q.text, v_text,
    jsonb_build_object(
      'previous_question_id', q.id,
      'version', q.version + 1,
      'scheduled_surveys_updated', v_swapped
    )
  );

  return v_new_id;
end;
$$;

grant execute on function public.pulse_save_question(uuid, text, boolean, integer) to authenticated;

-- ============================================================================
-- STATUS AUTOMATION  (call daily — see nightly-sync)
-- 'scheduled' → 'open' when the window starts; 'open' → 'closed' when a
-- one-off window ends. Recurring surveys stay open and roll to the next cycle.
-- ============================================================================
create or replace function public.pulse_refresh_statuses()
returns integer language plpgsql security definer as $$
declare
  r       record;
  changed integer := 0;
begin
  for r in
    select s.id, s.brand_id, s.title, s.status, s.recurrence, c.is_live, c.cycle_closes
    from public.pulse_surveys s
    cross join lateral public.pulse_cycle(s.id) c
    where s.status <> 'closed'
  loop
    if r.status = 'scheduled' and r.is_live then
      update public.pulse_surveys set status = 'open' where id = r.id;
      perform public.team_audit('pulse', 'survey_opened', 'pulse_survey', r.id, r.title,
                                r.brand_id, null, 'scheduled', 'open');
      changed := changed + 1;
    elsif r.status = 'open' and r.recurrence = 'none' and not r.is_live
          and now() >= r.cycle_closes then
      update public.pulse_surveys set status = 'closed' where id = r.id;
      perform public.team_audit('pulse', 'survey_closed', 'pulse_survey', r.id, r.title,
                                r.brand_id, null, 'open', 'closed');
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

-- Audit the manual open/close a brand admin does from the UI.
create or replace function public.pulse_audit_survey_status()
returns trigger language plpgsql security definer as $$
begin
  if new.status is distinct from old.status then
    perform public.team_audit(
      'pulse',
      case new.status when 'open' then 'survey_opened'
                      when 'closed' then 'survey_closed'
                      else 'status_changed' end,
      'pulse_survey', new.id, new.title, new.brand_id, null, old.status, new.status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists pulse_surveys_audit on public.pulse_surveys;
create trigger pulse_surveys_audit
  after update of status on public.pulse_surveys
  for each row execute function public.pulse_audit_survey_status();

-- ============================================================================
-- DEFAULT QUESTION BANK
-- Every brand gets its own copy of the six starters. They are a starting
-- point, not a fixed set: brand admins edit, deactivate, add and reorder.
-- ============================================================================
create or replace function public.pulse_seed_brand_questions(p_brand uuid)
returns integer language plpgsql security definer as $$
declare
  n integer;
begin
  with ins as (
    insert into public.pulse_questions (brand_id, text, type, sort_order)
    select p_brand, d.q_text, d.q_type, d.q_order
    from (values
      ('How was your week at work?',                       'scale_1_5', 10),
      ('Do you feel supported by your manager?',           'scale_1_5', 20),
      ('Do you have what you need to do your job well?',   'scale_1_5', 30),
      ('Would you recommend working here to a friend?',     'scale_1_5', 40),
      ('How manageable was your workload?',                'scale_1_5', 50),
      ('Anything you want management to know?',            'text',      60)
    ) as d(q_text, q_type, q_order)
    where not exists (
      select 1 from public.pulse_questions q
      where q.brand_id = p_brand and q.text = d.q_text
    )
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;

create or replace function public.pulse_seed_on_brand_insert()
returns trigger language plpgsql security definer as $$
begin
  perform public.pulse_seed_brand_questions(new.id);
  return new;
end;
$$;

drop trigger if exists brands_seed_pulse_questions on public.brands;
create trigger brands_seed_pulse_questions
  after insert on public.brands
  for each row execute function public.pulse_seed_on_brand_insert();

-- Backfill every brand that already exists.
select public.pulse_seed_brand_questions(id) from public.brands;
