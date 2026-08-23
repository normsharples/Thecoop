-- ============================================================================
-- 066. WHY HASN'T THE CONTRACT GONE OUT?
-- ----------------------------------------------------------------------------
-- contract_ready_to_issue() (065) answers yes/no, which is useless when the
-- answer is no. This returns the specific reasons, so the Contract tab can say
-- "waiting on the award level" instead of leaving you to guess.
-- ============================================================================

create or replace function public.contract_issue_blockers(target uuid)
returns text[] language plpgsql security definer stable as $$
declare
  ob  public.employee_onboarding%rowtype;
  p   public.profiles%rowtype;
  out_reasons text[] := '{}';
begin
  select * into ob from public.employee_onboarding where employee_id = target;
  if not found then
    return array['No onboarding record — start onboarding for this person first.'];
  end if;

  select * into p from public.profiles where id = target;

  if ob.status in ('legacy', 'exempt') then
    out_reasons := out_reasons || 'Onboarding is marked ' || ob.status || ' for this person.';
  end if;
  if not ob.issue_contract then
    out_reasons := out_reasons || 'This person was set up without a contract.';
  end if;
  if not ob.auto_issue then
    out_reasons := out_reasons || 'Automatic sending is switched off for this person.';
  end if;
  if not ob.details_complete then
    out_reasons := out_reasons || 'They have not finished their personal details yet.';
  end if;
  if not ob.sensitive_complete then
    out_reasons := out_reasons || 'They have not finished their tax, super and bank details yet.';
  end if;
  if p.employment_type is null then
    out_reasons := out_reasons || 'Employment type is not set.';
  end if;
  if p.award_level is null and p.base_pay_rate is null and p.salary_annual is null then
    out_reasons := out_reasons || 'No award level, manual rate or salary is set.';
  end if;
  if exists (
    select 1 from public.employee_contracts c
    where c.employee_id = target and c.kind = 'contract'
      and c.status in ('issued', 'viewed')
  ) then
    out_reasons := out_reasons || 'A contract is already out for signature.';
  end if;
  if exists (
    select 1 from public.employee_contracts c
    where c.employee_id = target and c.kind = 'contract' and c.status = 'signed'
  ) then
    out_reasons := out_reasons || 'They have already signed a contract.';
  end if;
  if not exists (
    select 1 from public.contract_templates t
    where t.active and t.kind = 'contract'
      and (t.employment_type is null or t.employment_type = p.employment_type)
      and (t.restaurant_id is null or t.restaurant_id = p.home_restaurant_id)
  ) then
    out_reasons := out_reasons || 'No active contract template matches their employment type and store.';
  end if;

  return out_reasons;
end;
$$;
