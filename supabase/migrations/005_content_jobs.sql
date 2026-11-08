-- Durable free-operation reservations. This is a count ceiling, not permission to spend.
create table if not exists public.signal_studio_jobs (
  uid text not null, request_id text not null, attempted_at timestamptz not null default now(),
  payload jsonb not null, primary key(uid,request_id)
);
create index if not exists signal_studio_jobs_time on public.signal_studio_jobs(uid,attempted_at);
alter table public.signal_studio_jobs enable row level security;
revoke all on public.signal_studio_jobs from public,anon,authenticated;
grant all on public.signal_studio_jobs to service_role;

create or replace function public.signal_studio_jobs(operation text, args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = public as $$
declare current_job jsonb; result jsonb; used integer; lim integer; next_status text; timestamp_text text;
begin
  if operation='pending' then
    lim:=coalesce((args->>'limit')::integer,20);
    if lim<1 or lim>100 then raise exception 'Invalid pending job limit'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('uid',p.uid,'id',p.request_id)),'[]') into result
      from (select uid,request_id from signal_studio_jobs where payload->>'status'='reserved' and payload->'ready'='true'::jsonb order by attempted_at,uid,request_id limit lim) p;
    return result;
  end if;
  if coalesce(args->>'uid','')='' or coalesce(args->>'requestId','')='' then raise exception 'Missing job owner or request'; end if;
  if operation='get' then
    select payload into result from signal_studio_jobs where uid=args->>'uid' and request_id=args->>'requestId'; return result;
  end if;
  perform pg_advisory_xact_lock(91842005,hashtext(args->>'uid'));
  select payload into current_job from signal_studio_jobs where uid=args->>'uid' and request_id=args->>'requestId';
  timestamp_text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  case operation
  when 'reserve' then
    lim:=(args->>'limit')::integer;
    if coalesce(args->>'scopeHash','') !~ '^[a-f0-9]{64}$' or lim is null or lim<0 or jsonb_typeof(args->'scope') is distinct from 'object' then raise exception 'Invalid job reservation'; end if;
    if current_job is not null then
      if current_job->>'scopeHash' is distinct from args->>'scopeHash' then raise exception using errcode='P0002',message='Request scope changed'; end if;
      return jsonb_build_object('reserved',false,'job',current_job);
    end if;
    select count(*) into used from signal_studio_jobs where uid=args->>'uid' and (attempted_at>clock_timestamp()-interval '24 hours' or payload->>'status' in ('reserved','running','dispatch_unknown'));
    if used>=lim then raise exception using errcode='P0003',message='Job allowance reached'; end if;
    result:=jsonb_build_object('id',args->>'requestId','scopeHash',args->>'scopeHash','scope',args->'scope','status','reserved','revision',1,'createdAt',timestamp_text,'updatedAt',timestamp_text);
    insert into signal_studio_jobs(uid,request_id,payload) values(args->>'uid',args->>'requestId',result);
    return jsonb_build_object('reserved',true,'job',result);
  when 'update' then
    next_status:=args->'patch'->>'status';
    if jsonb_typeof(args->'patch') is distinct from 'object' then raise exception using errcode='P0002',message='Invalid job transition'; end if;
    if exists(select 1 from jsonb_object_keys(args->'patch') k where k not in ('status','result','error','ready')) then raise exception using errcode='P0002',message='Invalid job fields'; end if;
    if current_job is null or (current_job->>'revision')::integer is distinct from (args->>'expectedRevision')::integer or current_job->>'status' is distinct from args->>'expectedStatus' then raise exception using errcode='P0002',message='Job state changed'; end if;
    if (args->'patch') ? 'ready' and not coalesce(current_job->>'status'='reserved' and next_status='reserved' and args->'patch'->'ready'='true'::jsonb and (select count(*) from jsonb_object_keys(args->'patch'))=2,false) then raise exception using errcode='P0002',message='Invalid readiness publication'; end if;
    if not coalesce((current_job->>'status'='reserved' and next_status='reserved' and args->'patch'->'ready'='true'::jsonb) or (current_job->>'status'='reserved' and next_status in ('running','failed','cancelled')) or (current_job->>'status'='running' and next_status in ('completed','failed','dispatch_unknown')) or (current_job->>'status'='dispatch_unknown' and next_status in ('completed','failed')),false) then raise exception using errcode='P0002',message='Invalid job transition'; end if;
    result:=current_job||(args->'patch')||jsonb_build_object('revision',(current_job->>'revision')::integer+1,'updatedAt',timestamp_text);
    update signal_studio_jobs set payload=result where uid=args->>'uid' and request_id=args->>'requestId'; return result;
  else raise exception 'Unknown job operation';
  end case;
end;
$$;
revoke all on function public.signal_studio_jobs(text,jsonb) from public,anon,authenticated;
grant execute on function public.signal_studio_jobs(text,jsonb) to service_role;
