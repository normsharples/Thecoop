-- ============================================================================
-- 032 — Waste depletes live inventory (Phase A)
--   waste_logs already has food_cost_item_id (006) + quantity (001).
--   * BEFORE INSERT: auto-fill estimated_cost from the current moving-avg cost.
--   * AFTER  INSERT: post a 'waste' issue movement (valued at avg).
--   * BEFORE DELETE: reverse the depletion (restore qty, avg unchanged).
--   Only fires when a tracked item is linked. Depends on 030. Safe to re-run.
-- ============================================================================

create or replace function public.waste_log_fill_cost()
returns trigger as $$
declare
  v_avg numeric;
begin
  if new.food_cost_item_id is not null and coalesce(new.quantity,0) > 0
     and coalesce(new.estimated_cost,0) = 0 then
    select avg_cost into v_avg from public.inventory_levels
      where restaurant_id = new.restaurant_id and food_cost_item_id = new.food_cost_item_id;
    if coalesce(v_avg,0) = 0 then
      select cost_per_unit into v_avg from public.food_cost_items where id = new.food_cost_item_id;
    end if;
    new.estimated_cost := round(coalesce(v_avg,0) * new.quantity, 2);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_waste_log_fill_cost on public.waste_logs;
create trigger trg_waste_log_fill_cost
  before insert on public.waste_logs
  for each row execute function public.waste_log_fill_cost();


create or replace function public.waste_log_post_depletion()
returns trigger as $$
begin
  if new.food_cost_item_id is null or coalesce(new.quantity,0) <= 0 then
    return null;
  end if;
  insert into public.inventory_movements
    (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
     movement_date, source_type, source_id, notes, created_by)
  values
    (new.restaurant_id, new.food_cost_item_id, 'waste', -new.quantity, null,
     new.date, 'waste_log', new.id, new.reason, auth.uid());
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_waste_log_post_depletion on public.waste_logs;
create trigger trg_waste_log_post_depletion
  after insert on public.waste_logs
  for each row execute function public.waste_log_post_depletion();


create or replace function public.waste_log_reverse_depletion()
returns trigger as $$
begin
  if old.food_cost_item_id is null or coalesce(old.quantity,0) <= 0 then
    return null;
  end if;
  -- positive quantity fix: restores on-hand, leaves moving-avg unchanged
  insert into public.inventory_movements
    (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
     movement_date, source_type, source_id, notes, created_by)
  values
    (old.restaurant_id, old.food_cost_item_id, 'count_adjustment', old.quantity, null,
     (now() at time zone 'utc')::date, 'waste_log_reversal', old.id,
     'reversal of waste', auth.uid());
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_waste_log_reverse_depletion on public.waste_logs;
create trigger trg_waste_log_reverse_depletion
  before delete on public.waste_logs
  for each row execute function public.waste_log_reverse_depletion();

-- ============================================================================
-- END 032
-- ============================================================================
