-- Apply in MangoTree's SQL editor. Browser clients receive no table privileges.
create table if not exists public.signal_articles (id text primary key, url text unique not null, published_at timestamptz not null, payload jsonb not null);
create index if not exists signal_articles_date on public.signal_articles(published_at desc);
create table if not exists public.signal_processed (id text primary key);
create table if not exists public.signal_runs (id uuid primary key default gen_random_uuid(), started_at timestamptz default now(), finished_at timestamptz, status text not null, payload jsonb default '{}');
create table if not exists public.signal_leases (name text primary key, owner text not null, expires_at timestamptz not null);
create table if not exists public.signal_model_attempts (attempted_at timestamptz default now());
create table if not exists public.signal_users (uid text primary key, email text, name text, role text, last_seen timestamptz default now());
create table if not exists public.signal_events (id uuid primary key default gen_random_uuid(), session_id uuid not null, user_id text, type text not null, path text not null, payload jsonb not null, created_at timestamptz default now());
create index if not exists signal_events_date on public.signal_events(created_at desc);
alter table public.signal_articles enable row level security;
alter table public.signal_processed enable row level security;
alter table public.signal_runs enable row level security;
alter table public.signal_leases enable row level security;
alter table public.signal_model_attempts enable row level security;
alter table public.signal_users enable row level security;
alter table public.signal_events enable row level security;
revoke all on public.signal_articles,public.signal_processed,public.signal_runs,public.signal_leases,public.signal_model_attempts,public.signal_users,public.signal_events from anon,authenticated;
grant all on public.signal_articles,public.signal_processed,public.signal_runs,public.signal_leases,public.signal_model_attempts,public.signal_users,public.signal_events to service_role;

create or replace function public.signal_repository(operation text, args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = public as $$
declare result jsonb; item jsonb; run_id uuid; affected integer; saved integer := 0; page integer; lim integer;
begin
  case operation
  when 'ping' then return 'true';
  when 'acquire_lease' then
    insert into signal_leases values(args->>'name',args->>'owner',now()+make_interval(secs => coalesce((args->>'ttlMs')::integer,600000)/1000.0))
    on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at where signal_leases.expires_at<now();
    get diagnostics affected=row_count; return to_jsonb(affected>0);
  when 'renew_lease' then
    update signal_leases set expires_at=now()+interval '10 minutes' where name=args->>'name' and owner=args->>'owner' and expires_at>now();
    if not found then raise exception 'Lease lost'; end if; return 'true';
  when 'release_lease' then delete from signal_leases where name=args->>'name' and owner=args->>'owner'; return 'true';
  when 'reserve_call' then
    perform pg_advisory_xact_lock(91842001);
    if (select count(*) from signal_model_attempts where attempted_at>now()-interval '24 hours') >= least(coalesce((args->>'limit')::integer,2),2) then raise exception 'Rolling 24-hour request ceiling reached'; end if;
    insert into signal_model_attempts default values; return 'true';
  when 'processed' then return to_jsonb(exists(select 1 from signal_processed where id=args->>'id'));
  when 'processed_ids' then select coalesce(jsonb_agg(id),'[]') into result from signal_processed where id in (select jsonb_array_elements_text(args->'ids')); return result;
  when 'persist_batch' then
    for item in select jsonb_array_elements(args->'articles') loop
      insert into signal_articles values(item->>'id',item->>'url',(item->>'publishedAt')::timestamptz,item)
      on conflict(id) do update set payload=excluded.payload where signal_articles.payload->>'summaryBasis'='publisher-excerpt' and coalesce(excluded.payload->>'summaryBasis','curated')!='publisher-excerpt';
      get diagnostics affected=row_count; saved:=saved+affected;
    end loop;
    for item in select jsonb_array_elements(args->'candidates') loop insert into signal_processed values(item->>'id') on conflict do nothing; end loop;
    return to_jsonb(saved);
  when 'start_run' then insert into signal_runs(status) values('running') returning id into run_id; return to_jsonb(run_id);
  when 'finish_run' then update signal_runs set finished_at=now(),status=args->>'status',payload=args->'payload' where id=(args->>'id')::uuid; return 'true';
  when 'last_run','last_successful_run' then
    select jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status)||payload into result from signal_runs
    where operation='last_run' or status in ('success','degraded') order by started_at desc limit 1; return result;
  when 'all_articles','articles_since' then
    select coalesce(jsonb_agg(payload order by published_at desc),'[]') into result from signal_articles where operation='all_articles' or published_at>=(args->>'since')::timestamptz; return result;
  when 'query_articles' then
    page:=greatest(coalesce((args->>'page')::integer,1),1); lim:=least(greatest(coalesce((args->>'limit')::integer,24),1),100);
    with matching as (select * from signal_articles where
      (coalesce(args->>'region','Global')='Global' or (payload->'regions') ? (args->>'region')) and
      (coalesce(args->>'category','All signals')='All signals' or payload->>'category'=args->>'category') and
      (coalesce(args->>'q','')='' or strpos(lower(concat_ws(' ',payload->>'title',payload->>'summary',payload->>'sourceName',payload->>'tags')),lower(args->>'q'))>0)),
    sliced as (select * from matching order by published_at desc limit lim offset (page-1)*lim)
    select jsonb_build_object('total',(select count(*) from matching),'articles',coalesce((select jsonb_agg(payload order by published_at desc) from sliced),'[]'),'page',page,'limit',lim) into result; return result;
  when 'find' then select payload into result from signal_articles where id=args->>'id'; return result;
  when 'update_article' then update signal_articles set payload=args->'article' where id=args->'article'->>'id'; return 'true';
  when 'update_image' then update signal_articles set payload=jsonb_set(payload,'{imageUrl}',args->'imageUrl') where id=args->>'id'; return 'true';
  when 'upsert_user' then item:=args->'user'; insert into signal_users values(item->>'uid',item->>'email',item->>'name',item->>'role',now()) on conflict(uid) do update set email=excluded.email,name=excluded.name,role=excluded.role,last_seen=now(); return 'true';
  when 'record_event' then item:=args->'event'; delete from signal_events where created_at<now()-interval '90 days'; insert into signal_events(session_id,user_id,type,path,payload) values((item->>'sessionId')::uuid,args->>'uid',item->>'type',item->>'path',item); return 'true';
  when 'admin_overview' then
    select jsonb_build_object('period','30 days','sessions',(select count(distinct session_id) from signal_events where created_at>now()-interval '30 days'),
      'events',coalesce((select jsonb_agg(to_jsonb(e)) from (select type,count(*) as total from signal_events where created_at>now()-interval '30 days' group by type) e),'[]'),
      'daily',coalesce((select jsonb_agg(to_jsonb(e)) from (select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as day,count(*) as total from signal_events where created_at>now()-interval '30 days' group by day order by day) e),'[]'),
      'users',coalesce((select jsonb_agg(to_jsonb(u)) from (select uid,email,name,role,last_seen as "lastSeen" from signal_users order by last_seen desc limit 100) u),'[]'),
      'recent',coalesce((select jsonb_agg(to_jsonb(e)) from (select id,type,path,user_id as "userId",created_at as "createdAt",payload from signal_events order by created_at desc limit 100) e),'[]')) into result; return result;
  else raise exception 'Unknown repository operation';
  end case;
end;
$$;
revoke all on function public.signal_repository(text,jsonb) from public,anon,authenticated;
grant execute on function public.signal_repository(text,jsonb) to service_role;
