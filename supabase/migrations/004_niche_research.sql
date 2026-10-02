-- Scheduler-only query. Apply after 003_studio.sql; Firebase clients cannot call it.
create or replace function public.signal_research_due(operation text, args jsonb default '{}') returns jsonb
language sql security invoker set search_path = public as $$
  select coalesce(jsonb_agg(due), '[]'::jsonb) from (
    select n.uid, n.id from signal_studio_records n
    left join signal_studio_records s on s.uid=n.uid and s.kind='research_schedule' and s.id=n.id
    where n.kind='niche' and n.payload->>'autoRefresh'='true'
      and (s.id is null or (s.payload->>'attemptedAt')::timestamptz < clock_timestamp()-interval '24 hours')
    order by coalesce(s.payload->>'attemptedAt',''), n.id limit 1
  ) due;
$$;
revoke all on function public.signal_research_due(text,jsonb) from public,anon,authenticated;
grant execute on function public.signal_research_due(text,jsonb) to service_role;

create or replace function public.signal_research_page(operation text, args jsonb default '{}') returns jsonb
language sql security invoker set search_path = public as $$
  select coalesce(jsonb_agg(item order by created_at desc,id desc), '[]'::jsonb) from (
    select id, payload->>'createdAt' as created_at,
      jsonb_build_object('id',id,'nicheId',payload->>'nicheId','researchedAt',payload->>'researchedAt','createdAt',payload->>'createdAt') as item
    from signal_studio_records where uid=args->>'uid' and kind='research'
      and (coalesce(args->>'before','')='' or payload->>'createdAt'<args->>'before'
        or (payload->>'createdAt'=args->>'before' and id<args->>'beforeId'))
    order by payload->>'createdAt' desc,id desc limit 21
  ) reports;
$$;
revoke all on function public.signal_research_page(text,jsonb) from public,anon,authenticated;
grant execute on function public.signal_research_page(text,jsonb) to service_role;
