-- Credits one daily reward per 13:00 Africa/Kampala (10:00 UTC) checkpoint to
-- every active test plan. The function catches up checkpoints missed while the
-- job was not running, and each plan never earns more than its duration_days.

alter table public.investments
  add column if not exists last_reward_on date;

create or replace function public.credit_daily_rewards()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_local timestamp;
  v_today date;
  v_last_checkpoint date;
  v_credited integer;
begin
  v_now_local := now() at time zone 'Africa/Kampala';
  v_today := v_now_local::date;
  v_last_checkpoint := case
    when v_now_local >= v_today + time '13:00' then v_today
    else v_today - 1
  end;

  with due as (
    select
      plan.id,
      plan.user_id,
      plan.daily_income,
      greatest(
        0,
        least(
          (v_last_checkpoint - plan.first_checkpoint) + 1,
          plan.duration_days
        ) - plan.claimed_days
      ) as credits
    from (
      select
        i.*,
        case
          when (i.started_at at time zone 'Africa/Kampala')
               <= ((i.started_at at time zone 'Africa/Kampala')::date + time '13:00')
            then (i.started_at at time zone 'Africa/Kampala')::date
          else (i.started_at at time zone 'Africa/Kampala')::date + 1
        end as first_checkpoint
      from public.investments i
      where i.status = 'active'
        and i.claimed_days < i.duration_days
        and (i.last_reward_on is null or i.last_reward_on < v_today)
    ) plan
  ),
  updated as (
    update public.investments i
    set claimed_days = i.claimed_days + due.credits,
        last_reward_on = v_today,
        status = case
          when i.claimed_days + due.credits >= i.duration_days then 'completed'
          else 'active'
        end
    from due
    where i.id = due.id
      and due.credits > 0
      and (i.last_reward_on is null or i.last_reward_on < v_today)
    returning i.user_id, i.daily_income, due.credits
  ),
  credited as (
    update public.profiles p
    set balance = p.balance + (updated.daily_income * updated.credits)
    from updated
    where p.id = updated.user_id
    returning updated.user_id, updated.daily_income * updated.credits as amount
  )
  insert into public.transactions (user_id, kind, amount, status, note)
  select
    credited.user_id,
    'income',
    credited.amount,
    'approved',
    'Daily test plan reward through ' || to_char(v_last_checkpoint, 'YYYY-MM-DD')
  from credited;

  get diagnostics v_credited = row_count;
  return v_credited;
end;
$$;

revoke all on function public.credit_daily_rewards() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'daily-test-plan-rewards';

select cron.schedule(
  'daily-test-plan-rewards',
  '0 10 * * *',
  $job$select public.credit_daily_rewards();$job$
);
