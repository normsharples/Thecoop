-- ============================================================================
-- 065. AUTO-ISSUE CONTRACTS + PER-AUTHORISER SIGNATURES
-- ----------------------------------------------------------------------------
-- Two changes:
--
-- 1. The contract now issues itself the moment both halves are ready — the
--    admin has set the employment terms, and the employee has finished their
--    own details. Nobody has to remember to press "send".
--
-- 2. The employer signature is the person who STARTED the onboarding
--    (employee_onboarding.requested_by), not one global company signatory. If
--    Jason onboards someone, Jason's name is on their contract. Each user gets
--    their own signatory title + signature image; app_settings['company'] stays
--    as the fallback for anyone who has not set one.
--
-- The rendering itself happens in the `issue-contract` edge function (service
-- role) so an employee can never supply their own contract body.
-- ============================================================================

alter table public.profiles
  add column if not exists signatory_title text,
  add column if not exists signature_image text;

comment on column public.profiles.signatory_title is
  'Title printed under this person''s signature when they authorise a contract, e.g. Director.';
comment on column public.profiles.signature_image is
  'Data URL of this person''s signature, applied to contracts they authorise.';

-- Who authorised each contract (distinct from issued_by, which is whoever's
-- session created the row — for an auto-issue that is the employee).
alter table public.employee_contracts
  add column if not exists authorised_by uuid references public.profiles(id) on delete set null,
  add column if not exists auto_issued boolean not null default false,
  -- Snapshot the authoriser's signature onto the row: if Jason later changes
  -- or clears his signature, contracts he already signed must not change.
  add column if not exists employer_signature_image text;

-- Per-person onboarding override: turn auto-issue off for one employee if you
-- want to review their contract by hand before it goes out.
alter table public.employee_onboarding
  add column if not exists auto_issue boolean not null default true;

-- ── Readiness check, used by the edge function and the UI ───────────────────
-- "Ready" = onboarding wants a contract, the employee's own details are in,
-- the employment terms exist, and nothing is already out for signature.
create or replace function public.contract_ready_to_issue(target uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from public.employee_onboarding ob
    join public.profiles p on p.id = ob.employee_id
    where ob.employee_id = target
      and ob.issue_contract
      and ob.auto_issue
      and ob.details_complete
      and ob.sensitive_complete
      and p.employment_type is not null
      and (p.award_level is not null or p.base_pay_rate is not null or p.salary_annual is not null)
      and not exists (
        select 1 from public.employee_contracts c
        where c.employee_id = target
          and c.kind = 'contract'
          and c.status in ('issued', 'viewed', 'signed')
      )
  );
$$;

-- Employees may read the templates only through the edge function, never
-- directly — contract_templates RLS (063) stays superadmin-only.
