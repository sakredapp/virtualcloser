-- One agency, several subdomains: each exec can have their own address.
alter table public.reps add column if not exists host_aliases text[] not null default '{}';
create index if not exists reps_host_aliases_gin on public.reps using gin (host_aliases);
alter table public.members add column if not exists home_subdomain text;
update public.reps set host_aliases = array['pinnacle'] where id = 'rep_spence';
update public.members set home_subdomain = 'pinnacle' where id = '25c35534-93f3-418e-9422-1bdded2d03fe';
