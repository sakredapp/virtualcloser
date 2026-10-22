with
tabs as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
),
seqs as (
  select 10 as sec, c.relname as k, format('create sequence if not exists public.%I;', c.relname) as ddl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'
),
tbl as (
  select 20 as sec, t.relname as k,
    format(E'create table if not exists public.%I (\n%s\n);', t.relname,
      string_agg(
        format('  %I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
          case when a.attgenerated='s' then format(' generated always as (%s) stored', pg_get_expr(d.adbin, d.adrelid))
               when d.adbin is not null then ' default ' || pg_get_expr(d.adbin, d.adrelid) else '' end,
          case when a.attnotnull then ' not null' else '' end),
        E',\n' order by a.attnum)) as ddl
  from tabs t join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=t.oid and d.adnum=a.attnum
  group by t.relname
),
seqown as (
  select 25 as sec, c.relname as k, format('alter sequence public.%I owned by public.%I.%I;', c.relname, t.relname, a.attname) as ddl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_depend dp on dp.objid=c.oid and dp.deptype='a' and dp.classid='pg_class'::regclass
  join pg_class t on t.oid=dp.refobjid join pg_attribute a on a.attrelid=t.oid and a.attnum=dp.refobjsubid
  where n.nspname='public' and c.relkind='S'
),
cons as (
  select case when co.contype in ('f','c') then 50 else 30 end as sec, t.relname||'.'||co.conname as k,
    format('alter table public.%I add constraint %I %s;', t.relname, co.conname, pg_get_constraintdef(co.oid)) as ddl
  from pg_constraint co join tabs t on t.oid=co.conrelid
  where co.contype in ('p','u','c','f','x')
),
funcs as (
  select 40 as sec, p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as k, pg_get_functiondef(p.oid)||';' as ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind in ('f','p')
    and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
),
mv as (
  select 45 as sec, c.relname as k, format(E'create materialized view if not exists public.%I as\n%s', c.relname, pg_get_viewdef(c.oid)) as ddl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='m'
),
idx as (
  select 60 as sec, ic.relname as k, replace(pg_get_indexdef(i.indexrelid), 'CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
    ||';' as ddl
  from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_class tc on tc.oid=i.indrelid
  join pg_namespace n on n.oid=tc.relnamespace
  where n.nspname='public' and tc.relkind in ('r','m')
    and not exists (select 1 from pg_constraint co where co.conindid=i.indexrelid and co.contype in ('p','u','x'))
),
trg as (
  select 70 as sec, c.relname||'.'||t.tgname as k, pg_get_triggerdef(t.oid)||';' as ddl
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal
),
rls as (
  select 80 as sec, t.relname as k, format('alter table public.%I enable row level security;', t.relname) as ddl
  from pg_class c join tabs t on t.oid=c.oid where c.relrowsecurity
),
pol as (
  select 85 as sec, tablename||'.'||policyname as k,
    format('create policy %I on public.%I as %s for %s to %s%s%s;', policyname, tablename, permissive, cmd,
      array_to_string(roles, ', '),
      case when qual is not null then ' using ('||qual||')' else '' end,
      case when with_check is not null then ' with check ('||with_check||')' else '' end) as ddl
  from pg_policies where schemaname='public'
)
select string_agg(ddl, E'\n\n' order by sec, k) as ddl
from (select * from seqs union all select * from tbl union all select * from seqown union all select * from cons
      union all select * from funcs union all select * from mv union all select * from idx union all select * from trg
      union all select * from rls union all select * from pol) x
