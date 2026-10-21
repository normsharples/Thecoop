-- ============================================================================
-- 091. ORBIT Agent — one cheap poll for every venue on a computer
--
--   One ORBIT Agent can now run several venues (one pairing per venue, so each
--   venue keeps its own token and its own row in agent_devices).
--
--   Polling used to go through the coop-agent edge function: a "claim" call
--   every 5 s plus a heartbeat every minute, per venue. That is ~540,000 edge
--   function invocations a month for ONE computer, over the Free plan's
--   500,000. This RPC does the same claim (and the heartbeat) straight
--   through PostgREST, which doesn't count as an edge function invocation, and
--   takes every venue on the computer in one request.
--
--   agent_poll(p_items) — p_items is a JSON array, one entry per venue:
--     [{ "token": "<device token>", "claim": true, "status": { …heartbeat… } (optional) }, …]
--   "claim": false (agent paused) records the heartbeat without claiming anything.
--   Returns an array in the same order:
--     [{ "ok": true, "restaurant_id": …, "refresh": [{id, source}], "roster": [{id, week_start}] }
--      | { "ok": false, "unpaired": true }, …]
--
--   Tokens are checked exactly as the edge function checks them (sha256 hash,
--   active device). A device only ever claims its own venue's requests, plus
--   the all-venue ones (restaurant_id is null), the same rule as before.
-- ============================================================================

create or replace function public.agent_poll(p_items jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_item    jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_token   text;
  d         public.agent_devices;
  rq        record;
  v_refresh jsonb;
  v_roster  jsonb;
  v_now     timestamptz := now();
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;
  if jsonb_array_length(p_items) > 25 then
    raise exception 'Too many venues in one poll (max 25)';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_token := coalesce(v_item->>'token', '');
    d := null;
    if length(v_token) >= 32 then
      select * into d from public.agent_devices
       where token_hash = encode(digest(v_token, 'sha256'), 'hex') and active;
    end if;

    if d.id is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('ok', false, 'unpaired', true));
      continue;
    end if;

    -- Heartbeat (optional) + last seen.
    if jsonb_typeof(v_item->'status') = 'object' then
      update public.agent_devices set last_seen_at = v_now, status = v_item->'status' where id = d.id;
    else
      update public.agent_devices set last_seen_at = v_now where id = d.id;
    end if;

    v_refresh := '[]'::jsonb;
    v_roster  := '[]'::jsonb;
    if coalesce(v_item->>'claim', 'true') = 'false' then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'ok', true, 'restaurant_id', d.restaurant_id, 'refresh', v_refresh, 'roster', v_roster));
      continue;
    end if;

    -- Refresh buttons: claim open requests for this venue (or all venues).
    -- Same rules as the edge function's "claim": the insert is the claim.
    for rq in
      select r.id, r.source, r.status
        from public.refresh_requests r
       where r.status in ('pending', 'running')
         and r.requested_at >= v_now - interval '30 minutes'
         and (r.restaurant_id is null or r.restaurant_id = d.restaurant_id)
         and not exists (select 1 from public.refresh_request_runs x
                          where x.request_id = r.id and x.device_id = d.id)
       order by r.requested_at
       limit 10
    loop
      begin
        insert into public.refresh_request_runs (request_id, device_id, status)
        values (rq.id, d.id, 'running');
      exception when unique_violation then
        continue;
      end;
      if rq.status = 'pending' then
        update public.refresh_requests set status = 'running', started_at = v_now
         where id = rq.id and status = 'pending';
      end if;
      v_refresh := v_refresh || jsonb_build_array(jsonb_build_object('id', rq.id, 'source', rq.source));
    end loop;

    -- Deputy roster refreshes for this venue.
    with claimed as (
      update public.roster_refresh_requests
         set status = 'running'
       where restaurant_id = d.restaurant_id and status = 'pending'
      returning id, week_start
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'week_start', week_start)), '[]'::jsonb)
      into v_roster from claimed;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ok', true,
      'restaurant_id', d.restaurant_id,
      'refresh', v_refresh,
      'roster', v_roster
    ));
  end loop;

  return v_out;
end;
$$;

revoke all on function public.agent_poll(jsonb) from public;
grant execute on function public.agent_poll(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
