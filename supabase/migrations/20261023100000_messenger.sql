-- Internal messenger: team channels by role, 1-on-1 chats, custom group chats,
-- emoji reactions, GIFs, unread counts.

create table chat_channels (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('team','dm','group')),
  name       text check (name is null or length(trim(name)) between 1 and 60),
  team_role  app_role,              -- team channels: who sees it (null = everyone)
  dm_key     text unique,           -- 1-on-1: the two user ids, sorted
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check ((kind = 'dm') = (dm_key is not null)),
  check (kind = 'dm' or name is not null)
);
create unique index chat_team_name_uidx on chat_channels (lower(name)) where kind = 'team';

create table chat_members (
  channel_id   uuid not null references chat_channels(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table chat_messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references chat_channels(id) on delete cascade,
  sender_id  uuid not null references profiles(id) default auth.uid(),
  body       text not null default '' check (length(body) <= 4000),
  gif_url    text check (gif_url is null or length(gif_url) <= 500 and gif_url ~ '^https://[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  check (length(trim(body)) > 0 or gif_url is not null)
);
create index chat_messages_channel_idx on chat_messages (channel_id, created_at desc);

create table chat_reactions (
  message_id uuid not null references chat_messages(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade default auth.uid(),
  emoji      text not null check (length(emoji) between 1 and 16),
  primary key (message_id, user_id, emoji)
);

insert into chat_channels (kind, name, team_role) values
  ('team', 'Everyone', null),
  ('team', 'Sales', 'sales'),
  ('team', 'Warehouse', 'warehouse'),
  ('team', 'Buyers', 'buyer');

-- Can the signed-in user see this channel?
create function chat_can_see(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_member() and exists (
    select 1 from chat_channels c
     where c.id = p_channel
       and (
         (c.kind = 'team' and (c.team_role is null or has_role(c.team_role)))
         or (c.kind <> 'team' and exists (select 1 from chat_members m where m.channel_id = c.id and m.user_id = auth.uid()))
       )
  );
$$;

alter table chat_channels  enable row level security;
alter table chat_members   enable row level security;
alter table chat_messages  enable row level security;
alter table chat_reactions enable row level security;

create policy "see channels" on chat_channels for select to authenticated using (chat_can_see(id));
create policy "see members" on chat_members for select to authenticated using (chat_can_see(channel_id));
create policy "see messages" on chat_messages for select to authenticated using (chat_can_see(channel_id));
create policy "send messages" on chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and chat_can_see(channel_id));
create policy "see reactions" on chat_reactions for select to authenticated
  using (exists (select 1 from chat_messages m where m.id = message_id and chat_can_see(m.channel_id)));

-- People you can chat with: any active member (names only)
create view v_chat_people with (security_invoker = false) as
select id, coalesce(nullif(trim(full_name), ''), email) as name, email, role
  from profiles where active and is_member();

-- Open (or create) a 1-on-1 chat
create function chat_open_dm(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  if not is_member() then raise exception 'Not authorized'; end if;
  if p_user = auth.uid() then raise exception 'Pick someone else to message'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'That person isn''t active'; end if;
  v_key := least(auth.uid()::text, p_user::text) || ':' || greatest(auth.uid()::text, p_user::text);
  select id into v_id from chat_channels where dm_key = v_key;
  if v_id is null then
    insert into chat_channels (kind, dm_key) values ('dm', v_key) returning id into v_id;
    insert into chat_members (channel_id, user_id) values (v_id, auth.uid()), (v_id, p_user);
  end if;
  return v_id;
end $$;

-- Custom group chat; the creator is added automatically
create function chat_create_group(p_name text, p_users uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_users uuid[];
begin
  if not is_member() then raise exception 'Not authorized'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Name the group'; end if;
  select array_agg(distinct u) into v_users
    from unnest(coalesce(p_users, '{}') || auth.uid()) u
   where exists (select 1 from profiles where id = u and active);
  if coalesce(array_length(v_users, 1), 0) < 3 then raise exception 'A group needs at least two other people'; end if;
  insert into chat_channels (kind, name) values ('group', trim(p_name)) returning id into v_id;
  insert into chat_members (channel_id, user_id) select v_id, unnest(v_users);
  return v_id;
end $$;

create function chat_add_people(p_channel uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from chat_channels where id = p_channel and kind = 'group' and created_by = auth.uid()) then
    raise exception 'Only the person who made the group can add people';
  end if;
  insert into chat_members (channel_id, user_id)
  select p_channel, id from profiles where id = any(p_users) and active
  on conflict do nothing;
end $$;

create function chat_leave(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from chat_members m using chat_channels c
   where m.channel_id = p_channel and m.user_id = auth.uid() and c.id = m.channel_id and c.kind = 'group';
end $$;

-- Mark everything in a channel as read
create function chat_mark_read(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not chat_can_see(p_channel) then raise exception 'Not authorized'; end if;
  insert into chat_members (channel_id, user_id, last_read_at) values (p_channel, auth.uid(), now())
  on conflict (channel_id, user_id) do update set last_read_at = now();
end $$;

-- Add or remove my reaction
create function chat_react(p_message uuid, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ch uuid;
begin
  select channel_id into v_ch from chat_messages where id = p_message;
  if v_ch is null or not chat_can_see(v_ch) then raise exception 'Not authorized'; end if;
  if exists (select 1 from chat_reactions where message_id = p_message and user_id = auth.uid() and emoji = p_emoji) then
    delete from chat_reactions where message_id = p_message and user_id = auth.uid() and emoji = p_emoji;
  else
    insert into chat_reactions (message_id, emoji) values (p_message, p_emoji);
  end if;
end $$;

-- Unread messages per visible channel (other people's messages after I last read)
create function chat_unread() returns table (channel_id uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select c.id,
         count(m.id) filter (where m.sender_id <> auth.uid() and m.created_at > coalesce(cm.last_read_at, '-infinity'))
    from chat_channels c
    left join chat_members cm on cm.channel_id = c.id and cm.user_id = auth.uid()
    left join chat_messages m on m.channel_id = c.id
   where chat_can_see(c.id)
   group by c.id;
$$;

revoke execute on function chat_open_dm(uuid), chat_create_group(text, uuid[]), chat_add_people(uuid, uuid[]),
  chat_leave(uuid), chat_mark_read(uuid), chat_react(uuid, text), chat_unread(), chat_can_see(uuid) from public;
grant execute on function chat_open_dm(uuid), chat_create_group(text, uuid[]), chat_add_people(uuid, uuid[]),
  chat_leave(uuid), chat_mark_read(uuid), chat_react(uuid, text), chat_unread(), chat_can_see(uuid) to authenticated;
grant select on v_chat_people to authenticated;

-- Live delivery (Supabase realtime); skipped where the publication doesn't exist
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table chat_messages, chat_reactions;
  end if;
end $$;
