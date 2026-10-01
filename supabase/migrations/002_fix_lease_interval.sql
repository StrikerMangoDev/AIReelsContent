-- Apply once in the existing Supabase project's SQL editor.
-- Repairs the function in place without changing data, RLS, grants or model quota.
begin;
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.signal_repository(text,jsonb)'::regprocedure);
  if position('make_interval(secs=' in definition) > 0 then
    definition := replace(definition, 'make_interval(secs=', 'make_interval(secs => ');
    execute definition;
  elsif position('make_interval(secs => ' in definition) = 0 then
    raise exception 'Unexpected lease function definition; inspect before migrating';
  end if;
end;
$migration$;
commit;
