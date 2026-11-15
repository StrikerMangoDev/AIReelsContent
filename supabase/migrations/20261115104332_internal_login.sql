create table public.signal_internal_accounts (
  uid text primary key, email text unique not null check (email = lower(trim(email))),
  name text not null, role text not null check (role in ('user','admin')),
  password_hash text not null check (password_hash ~ '^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$'),
  disabled boolean not null default false, session_hash text unique,
  expires_at timestamptz, last_seen timestamptz
);
create table public.signal_login_attempts (key text primary key, count integer not null, expires_at timestamptz not null);
alter table public.signal_internal_accounts enable row level security;
alter table public.signal_login_attempts enable row level security;
revoke all on public.signal_internal_accounts, public.signal_login_attempts from public, anon, authenticated;
grant all on public.signal_internal_accounts, public.signal_login_attempts to service_role;

create function public.signal_internal_auth(operation text, args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb; attempts integer;
begin
  if operation = 'account' then
    select to_jsonb(a) into result from public.signal_internal_accounts a where email=args->>'email';
  elsif operation = 'attempt' then
    delete from public.signal_login_attempts where expires_at <= clock_timestamp();
    insert into public.signal_login_attempts as a values(args->>'key',1,clock_timestamp()+interval '15 minutes')
      on conflict(key) do update set count=a.count+1 returning count into attempts;
    return to_jsonb(attempts <= (args->>'limit')::integer);
  elsif operation = 'claim' then
    -- The conditional update serializes competing logins and password resets across instances.
    update public.signal_internal_accounts set session_hash=args->>'tokenHash', expires_at=clock_timestamp()+interval '12 hours',last_seen=clock_timestamp()
      where uid=args->>'uid' and password_hash=args->>'passwordHash' and not disabled
      and (session_hash is null or expires_at<=clock_timestamp() or last_seen<=clock_timestamp()-interval '30 minutes' or session_hash=args->>'currentHash')
      returning jsonb_build_object('uid',uid,'email',email,'name',name,'role',role) into result;
  elsif operation = 'session' then
    update public.signal_internal_accounts set last_seen=clock_timestamp()
      where session_hash=args->>'tokenHash' and not disabled and expires_at>clock_timestamp() and last_seen>clock_timestamp()-interval '30 minutes'
      returning jsonb_build_object('uid',uid,'email',email,'name',name,'role',role) into result;
  elsif operation = 'logout' then
    update public.signal_internal_accounts set session_hash=null,expires_at=null,last_seen=null where session_hash=args->>'tokenHash';
  elsif operation = 'provision' then
    insert into public.signal_internal_accounts(uid,email,name,role,password_hash)
      values(args->>'uid',args->>'email',args->>'name',args->>'role',args->>'passwordHash')
      on conflict(uid) do update set email=excluded.email,name=excluded.name,role=excluded.role,password_hash=excluded.password_hash,
        disabled=false,session_hash=null,expires_at=null,last_seen=null;
  elsif operation = 'revoke' then
    update public.signal_internal_accounts set session_hash=null,expires_at=null,last_seen=null where uid=args->>'uid';
  else raise exception 'Unknown authentication operation';
  end if;
  return result;
end;
$$;
revoke all on function public.signal_internal_auth(text,jsonb) from public, anon, authenticated;
grant execute on function public.signal_internal_auth(text,jsonb) to service_role;
