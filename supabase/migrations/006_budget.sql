-- Lifetime monetary caps; absent caps are zero. No live spending is enabled by this migration.
create table if not exists public.signal_budget_limits (
  owner text not null, currency text not null, limit_micros bigint not null check(limit_micros between 0 and 1000000000000), primary key(owner,currency)
);
create table if not exists public.signal_budget_reservations (
  owner text not null, request_id text not null, currency text not null, payload jsonb not null, primary key(owner,request_id)
);
create index if not exists signal_budget_reservations_currency on public.signal_budget_reservations(currency);
alter table public.signal_budget_limits enable row level security;
alter table public.signal_budget_reservations enable row level security;
revoke all on public.signal_budget_limits, public.signal_budget_reservations from public,anon,authenticated;
grant all on public.signal_budget_limits, public.signal_budget_reservations to service_role;

create or replace function public.signal_budget_validate_quote(quote jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare field text;
begin
  if jsonb_typeof(quote->'upperBoundMicros') is distinct from 'number' or coalesce(quote->>'upperBoundMicros','') !~ '^[0-9]+$' or (quote->>'upperBoundMicros')::numeric>1000000000000 or coalesce(quote->>'currency','') !~ '^[A-Z]{3}$' or coalesce(btrim(quote->>'priceVersion'),'')='' or coalesce(quote->>'kind','') not in ('generation','research','storage') then raise exception using errcode='P0004',message='Current bounded pricing is required'; end if;
  if coalesce(quote->>'priceExpiresAt','')='' or not isfinite((quote->>'priceExpiresAt')::timestamptz) or (quote->>'priceExpiresAt')::timestamptz<=clock_timestamp() then raise exception using errcode='P0004',message='Price evidence expired'; end if;
  if quote ? 'credit' then
    if quote->'creditEvidence'->>'status' is distinct from 'verified' or quote->'credit'->>'currency' is distinct from quote->>'currency' then raise exception using errcode='P0004',message='Credit eligibility is unverified'; end if;
    foreach field in array array['grantId','billingAccount','projectId','service','sku','region','currency'] loop
      if coalesce(quote->'credit'->>field,'')='' or quote->'credit'->>field is distinct from quote->'creditEvidence'->>field then raise exception using errcode='P0004',message='Credit eligibility does not match'; end if;
    end loop;
    if coalesce(quote->'creditEvidence'->>'expiresAt','')='' or coalesce(quote->'creditEvidence'->>'verifiedUntil','')='' or not isfinite((quote->'creditEvidence'->>'expiresAt')::timestamptz) or not isfinite((quote->'creditEvidence'->>'verifiedUntil')::timestamptz) or (quote->'creditEvidence'->>'expiresAt')::timestamptz<=clock_timestamp() or (quote->'creditEvidence'->>'verifiedUntil')::timestamptz<=clock_timestamp() then raise exception using errcode='P0004',message='Credit evidence expired'; end if;
  end if;
exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='P0004',message='Invalid pricing or credit date';
end;
$$;
revoke all on function public.signal_budget_validate_quote(jsonb) from public,anon,authenticated;
grant execute on function public.signal_budget_validate_quote(jsonb) to service_role;

create or replace function public.signal_budget(operation text, args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public as $$
declare own text:=args->>'owner'; curr text; request_id_value text:=args->>'requestId'; current_res jsonb; result jsonb;
  amount bigint; actual bigint; global_used numeric; owner_used numeric; global_cap bigint; owner_cap bigint;
  next_status text; action_value text:=args->>'action'; timestamp_text text;
begin
  if coalesce(own,'')='' or own='*' or length(own)>128 then raise exception using errcode='P0004',message='Invalid budget owner'; end if;
  if operation='get' then select payload into result from signal_budget_reservations where owner=own and request_id=request_id_value; return result; end if;
  if operation='summary' then
    curr:=coalesce(args->>'currency','USD');
    if curr !~ '^[A-Z]{3}$' then raise exception using errcode='P0004',message='Invalid currency'; end if;
    select jsonb_build_object('currency',curr,
      'limitMicros',coalesce((select limit_micros from signal_budget_limits where owner=own and currency=curr),0),
      'heldMicros',coalesce(sum(case when payload->>'status' not in ('settled','cancelled') then (payload->'quote'->>'upperBoundMicros')::bigint else 0 end),0),
      'settledMicros',coalesce(sum(case when payload->>'status'='settled' then (payload->>'actualMicros')::bigint else 0 end),0),
      'overageBlocked',coalesce(bool_or(payload->>'overage'='true'),false),
      'unreconciledCount',count(*) filter(where payload->>'status' not in ('settled','cancelled')))
      into result from signal_budget_reservations where owner=own and currency=curr;
    return result;
  end if;
  -- A shared transaction lock protects admission across all owners and settlement/limit changes.
  perform pg_advisory_xact_lock(91842006,0);
  timestamp_text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if operation='configure' then
    curr:=args->>'currency';
    if coalesce(curr,'') !~ '^[A-Z]{3}$' or jsonb_typeof(args->'globalLimitMicros') is distinct from 'number' or jsonb_typeof(args->'ownerLimitMicros') is distinct from 'number' or coalesce(args->>'globalLimitMicros','') !~ '^[0-9]+$' or coalesce(args->>'ownerLimitMicros','') !~ '^[0-9]+$' then raise exception using errcode='P0004',message='Invalid budget limits'; end if;
    global_cap:=(args->>'globalLimitMicros')::bigint; owner_cap:=(args->>'ownerLimitMicros')::bigint;
    if global_cap>1000000000000 or owner_cap>1000000000000 then raise exception using errcode='P0004',message='Budget limit exceeds supported range'; end if;
    insert into signal_budget_limits values('*',curr,global_cap) on conflict(owner,currency) do update set limit_micros=excluded.limit_micros;
    insert into signal_budget_limits values(own,curr,owner_cap) on conflict(owner,currency) do update set limit_micros=excluded.limit_micros;
    return null;
  end if;
  if coalesce(request_id_value,'')='' or length(request_id_value)>200 then raise exception using errcode='P0004',message='Invalid monetary request'; end if;
  select payload into current_res from signal_budget_reservations where owner=own and request_id=request_id_value;
  if operation='reserve' then
    perform signal_budget_validate_quote(args->'quote');
    curr:=args->'quote'->>'currency';
    if coalesce(curr,'') !~ '^[A-Z]{3}$' or coalesce(args->>'scopeHash','') !~ '^[a-f0-9]{64}$' or coalesce(args->'quote'->>'upperBoundMicros','') !~ '^[0-9]+$' or coalesce(btrim(args->'quote'->>'priceVersion'),'')='' or coalesce(args->'quote'->>'priceExpiresAt','')='' or coalesce(args->'quote'->>'kind','') not in ('research','generation','storage') then raise exception using errcode='P0004',message='Current bounded pricing is required'; end if;
    amount:=(args->'quote'->>'upperBoundMicros')::bigint;
    if amount>1000000000000 or (args->'quote'->>'priceExpiresAt')::timestamptz<=clock_timestamp() then raise exception using errcode='P0004',message='Expired or unsupported monetary quote'; end if;
    if current_res is not null then
      if current_res->>'scopeHash' is distinct from args->>'scopeHash' or current_res->'quote'->>'currency' is distinct from curr or (current_res->'quote'->>'upperBoundMicros')::bigint<>amount then raise exception using errcode='P0004',message='Monetary request scope changed'; end if;
      return jsonb_build_object('reserved',false,'reservation',current_res);
    end if;
    if exists(select 1 from signal_budget_reservations where currency=curr and payload->>'overage'='true') then raise exception using errcode='P0004',message='Unreconciled overage blocks further reservations'; end if;
    select coalesce(sum(case when payload->>'status'='settled' then (payload->>'actualMicros')::bigint when payload->>'status'='cancelled' then 0 else (payload->'quote'->>'upperBoundMicros')::bigint end),0),
      coalesce(sum(case when owner<>own then 0 when payload->>'status'='settled' then (payload->>'actualMicros')::bigint when payload->>'status'='cancelled' then 0 else (payload->'quote'->>'upperBoundMicros')::bigint end),0)
      into global_used,owner_used from signal_budget_reservations where currency=curr;
    select limit_micros into global_cap from signal_budget_limits where owner='*' and currency=curr;
    select limit_micros into owner_cap from signal_budget_limits where owner=own and currency=curr;
    if global_used+amount>coalesce(global_cap,0) or owner_used+amount>coalesce(owner_cap,0) then raise exception using errcode='P0004',message='Global or owner budget exhausted'; end if;
    result:=jsonb_build_object('id',request_id_value,'scopeHash',args->>'scopeHash','quote',args->'quote','status','reserved','revision',1,'createdAt',timestamp_text,'updatedAt',timestamp_text,'cancellationRequested',false);
    insert into signal_budget_reservations values(own,request_id_value,curr,result);
    return jsonb_build_object('reserved',true,'reservation',result);
  elsif operation='transition' then
    if current_res is null or jsonb_typeof(args->'expectedRevision') is distinct from 'number' or (current_res->>'revision')::integer is distinct from (args->>'expectedRevision')::integer then raise exception using errcode='P0004',message='Monetary reservation changed or unavailable'; end if;
    next_status:=current_res->>'status'; result:=current_res;
    if action_value='dispatch' and next_status='reserved' then
      perform signal_budget_validate_quote(current_res->'quote');
      if exists(select 1 from signal_budget_reservations where currency=current_res->'quote'->>'currency' and payload->>'overage'='true') then raise exception using errcode='P0004',message='Unreconciled overage blocks dispatch'; end if;
      curr:=current_res->'quote'->>'currency';
      select coalesce(sum(case when payload->>'status'='settled' then (payload->>'actualMicros')::bigint when payload->>'status'='cancelled' then 0 else (payload->'quote'->>'upperBoundMicros')::bigint end),0),
        coalesce(sum(case when owner<>own then 0 when payload->>'status'='settled' then (payload->>'actualMicros')::bigint when payload->>'status'='cancelled' then 0 else (payload->'quote'->>'upperBoundMicros')::bigint end),0)
        into global_used,owner_used from signal_budget_reservations where currency=curr;
      select limit_micros into global_cap from signal_budget_limits where owner='*' and currency=curr;
      select limit_micros into owner_cap from signal_budget_limits where owner=own and currency=curr;
      if global_used>coalesce(global_cap,0) or owner_used>coalesce(owner_cap,0) then raise exception using errcode='P0004',message='Current global or owner budget blocks dispatch'; end if;
      next_status:='dispatched';
    elsif action_value='unknown' and next_status='dispatched' then next_status:='dispatch_unknown';
    elsif action_value='cancel' and next_status in ('reserved','dispatched','dispatch_unknown') then
      result:=result||jsonb_build_object('cancellationRequested',true);
      if next_status='reserved' then next_status:='cancelled'; end if;
    elsif action_value='settle' and next_status in ('dispatched','dispatch_unknown') then
      if jsonb_typeof(args->'actualMicros') is distinct from 'number' or coalesce(args->>'actualMicros','') !~ '^[0-9]+$' then raise exception using errcode='P0004',message='A bounded integer settlement is required'; end if;
      actual:=(args->>'actualMicros')::bigint;
      if actual>1000000000000 then raise exception using errcode='P0004',message='Settlement exceeds supported range'; end if;
      next_status:='settled'; result:=result||jsonb_build_object('actualMicros',actual,'overage',actual>(current_res->'quote'->>'upperBoundMicros')::bigint);
    else raise exception using errcode='P0004',message='Invalid monetary reservation transition'; end if;
    result:=result||jsonb_build_object('status',next_status,'revision',(current_res->>'revision')::integer+1,'updatedAt',timestamp_text);
    update signal_budget_reservations set payload=result where owner=own and request_id=request_id_value;
    return result;
  else raise exception using errcode='P0004',message='Unknown budget operation'; end if;
end;
$$;
revoke all on function public.signal_budget(text,jsonb) from public,anon,authenticated;
grant execute on function public.signal_budget(text,jsonb) to service_role;
