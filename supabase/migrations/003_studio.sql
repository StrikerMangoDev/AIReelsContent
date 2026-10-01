-- Server-only, Firebase uid scoped storage. Apply after 001 and 002.
create table if not exists public.signal_studio_records (
  uid text not null, kind text not null, id text not null,
  revision integer not null, payload jsonb not null, primary key(uid,kind,id)
);
create table if not exists public.signal_studio_revisions (
  uid text not null, kind text not null, id text not null,
  revision integer not null, payload jsonb not null, primary key(uid,kind,id,revision)
);
create table if not exists public.signal_studio_reservations (
  uid text not null, request_id text not null, attempted_at timestamptz not null default now(), primary key(uid,request_id)
);
create index if not exists signal_studio_reservations_time on public.signal_studio_reservations(uid,attempted_at);
alter table public.signal_studio_records enable row level security;
alter table public.signal_studio_revisions enable row level security;
alter table public.signal_studio_reservations enable row level security;
revoke all on public.signal_studio_records,public.signal_studio_revisions,public.signal_studio_reservations from public,anon,authenticated;
grant all on public.signal_studio_records,public.signal_studio_revisions,public.signal_studio_reservations to service_role;

create or replace function public.signal_studio(operation text, args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = public as $$
declare result jsonb; current_record signal_studio_records%rowtype; used integer; lim integer; already_reserved boolean; next_revision integer;
begin
  if coalesce(args->>'uid','')='' then raise exception 'Missing studio owner'; end if;
  if operation <> 'reserve' and coalesce(args->>'kind','')='' then raise exception 'Missing studio kind'; end if;
  case operation
  when 'get' then
    select payload into result from signal_studio_records where uid=args->>'uid' and kind=args->>'kind' and id=args->>'id'; return result;
  when 'list' then
    select coalesce(jsonb_agg(payload order by payload->>'updatedAt' desc,id),'[]') into result from signal_studio_records where uid=args->>'uid' and kind=args->>'kind'; return result;
  when 'history' then
    select coalesce(jsonb_agg(payload order by revision desc),'[]') into result from signal_studio_revisions where uid=args->>'uid' and kind=args->>'kind' and id=args->>'id'; return result;
  when 'put' then
    if coalesce(args->>'id','')='' or jsonb_typeof(args->'payload') is distinct from 'object' then raise exception 'Invalid studio record'; end if;
    -- Owner locks serialize both absent-row creation and updates; collisions only add contention.
    perform pg_advisory_xact_lock(91842003,hashtext(args->>'uid'));
    select * into current_record from signal_studio_records where uid=args->>'uid' and kind=args->>'kind' and id=args->>'id';
    if args ? 'expectedRevision' and (args->>'expectedRevision')::integer is distinct from coalesce(current_record.revision,0) then
      raise exception using errcode='P0002', message='Content changed; reload before saving';
    end if;
    next_revision:=coalesce(current_record.revision,0)+1;
    result:=(args->'payload')||jsonb_build_object('id',args->>'id','revision',next_revision,'createdAt',coalesce(current_record.payload->>'createdAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    insert into signal_studio_records values(args->>'uid',args->>'kind',args->>'id',next_revision,result)
    on conflict(uid,kind,id) do update set revision=excluded.revision,payload=excluded.payload;
    insert into signal_studio_revisions values(args->>'uid',args->>'kind',args->>'id',next_revision,result);
    return result;
  when 'reserve' then
    lim:=(args->>'limit')::integer;
    if coalesce(args->>'requestId','')='' or lim is null or lim<0 then raise exception 'Invalid studio reservation'; end if;
    perform pg_advisory_xact_lock(91842003,hashtext(args->>'uid'));
    select count(*) into used from signal_studio_reservations where uid=args->>'uid' and attempted_at>clock_timestamp()-interval '24 hours';
    select exists(select 1 from signal_studio_reservations where uid=args->>'uid' and request_id=args->>'requestId') into already_reserved;
    if not already_reserved then
      if used>=lim then raise exception using errcode='P0003',message='Studio rolling 24-hour request limit reached'; end if;
      insert into signal_studio_reservations(uid,request_id) values(args->>'uid',args->>'requestId'); used:=used+1;
    end if;
    return jsonb_build_object('reserved',not already_reserved,'used',used,'limit',lim);
  else raise exception 'Unknown studio operation';
  end case;
end;
$$;
revoke all on function public.signal_studio(text,jsonb) from public,anon,authenticated;
grant execute on function public.signal_studio(text,jsonb) to service_role;
