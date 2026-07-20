create extension if not exists "pgcrypto";

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member',
  relationship_role text default 'relative' check (relationship_role in ('parent', 'child', 'spouse', 'relative', 'friend', 'guest')),
  household_roles text[] not null default '{}',
  status text not null default 'online' check (status in ('online', 'away')),
  avatar_seed text not null default 'family',
  color text,
  profile_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

alter table public.family_members
  add column if not exists profile_json jsonb not null default '{}'::jsonb;

-- Auth proves who signed in; this table stores the stable, app-facing person.
-- Invite rows and memberships never replace this identity.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.family_spaces (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  space_type text not null default 'core' check (space_type in ('core', 'guest')),
  created_by_member_id uuid references public.family_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.family_spaces(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  access_role text not null default 'member' check (access_role in ('owner', 'member', 'guest')),
  created_at timestamptz not null default now(),
  unique (space_id, member_id)
);

create table public.family_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid references public.family_members(id) on delete set null,
  space_id uuid references public.family_spaces(id) on delete cascade,
  created_by_member_id uuid references public.family_members(id) on delete set null,
  assignee_member_ids uuid[] not null default '{}',
  audience text not null default 'core' check (audience in ('core', 'guest')),
  assignment_status text not null default 'assigned' check (assignment_status in ('suggested', 'assigned', 'accepted', 'done')),
  assignment_reason text not null default '',
  kind text not null check (kind in ('task', 'note', 'link', 'media')),
  title text not null,
  summary text not null default '',
  status text not null default 'saved' check (status in ('todo', 'doing', 'done', 'saved')),
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.family_records(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'guest' check (role in ('member', 'guest')),
  status text not null default 'active' check (status in ('active', 'removed')),
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('family', 'group')),
  family_id uuid references public.families(id) on delete cascade,
  group_id uuid references public.family_records(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_by_member_id uuid references public.family_members(id) on delete set null,
  code_hash text not null,
  expires_at timestamptz not null,
  max_use integer not null check (max_use between 1 and 100),
  used_count integer not null default 0 check (used_count >= 0),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (type = 'family' and family_id is not null and group_id is null and max_use = 1)
    or (type = 'group' and group_id is not null and family_id is not null)
  )
);

create table if not exists public.invite_acceptances (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_id uuid not null,
  accepted_at timestamptz not null default now(),
  unique (invite_id, user_id)
);

-- Family invites create a reviewable request first. Registration alone never
-- grants access to the family space.
create table if not exists public.family_join_requests (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.invites(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null default '',
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  avatar_url text,
  relationship_label text not null,
  relationship_role text not null default 'relative' check (relationship_role in ('parent', 'child', 'spouse', 'relative')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_member_id uuid references public.family_members(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Directed edges make kinship viewer-relative: subject sees object as label.
create table if not exists public.family_relationships (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  subject_member_id uuid not null references public.family_members(id) on delete cascade,
  object_member_id uuid not null references public.family_members(id) on delete cascade,
  relationship_kind text not null,
  relationship_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subject_member_id <> object_member_id),
  unique (family_id, subject_member_id, object_member_id)
);

create index if not exists group_members_user_id_idx on public.group_members(user_id) where status = 'active';
create index if not exists invites_target_active_idx on public.invites(type, family_id, group_id, status, expires_at);
create index if not exists family_join_requests_review_idx on public.family_join_requests(family_id, status, created_at desc);
create unique index if not exists family_join_requests_one_pending_user_idx on public.family_join_requests(family_id, user_id) where status = 'pending';
create index if not exists family_relationships_subject_idx on public.family_relationships(family_id, subject_member_id);

create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid references public.family_members(id) on delete set null,
  body text not null,
  message_type text not null default 'text' check (message_type in ('text', 'voice', 'file', 'system')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.family_decisions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  room_record_id uuid not null references public.family_records(id) on delete cascade,
  creator_member_id uuid not null references public.family_members(id) on delete restrict,
  question text not null check (char_length(question) between 1 and 80),
  decision_type text not null default 'quick' check (decision_type = 'quick'),
  status text not null default 'open' check (status in ('open', 'closed', 'canceled')),
  closes_at timestamptz not null,
  closed_at timestamptz,
  close_reason text check (close_reason in ('all_voted', 'deadline', 'creator')),
  summary_status text not null default 'pending' check (summary_status in ('pending', 'ready', 'failed')),
  summary_text text not null default '',
  summary_json jsonb not null default '{}'::jsonb,
  source_text text not null default '',
  adopted_task_id uuid references public.family_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_decision_options (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.family_decisions(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  description text not null default '',
  icon text not null default '',
  position integer not null,
  unique (decision_id, position)
);

create table if not exists public.family_decision_participants (
  decision_id uuid not null references public.family_decisions(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  invited_at timestamptz not null default now(),
  primary key (decision_id, member_id)
);

create table if not exists public.family_decision_ballots (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.family_decisions(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  option_id uuid not null references public.family_decision_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (decision_id, member_id)
);

create table if not exists public.family_decision_messages (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.family_decisions(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  body text not null default '',
  message_type text not null default 'text' check (message_type in ('text', 'voice', 'file', 'system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- "评评理" is intentionally independent from family_decisions. It aggregates
-- confirmed member viewpoints; it is not a poll and never stores an AI vote.
create table if not exists public.family_judgements (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  space_id uuid references public.family_spaces(id) on delete set null,
  room_record_id uuid not null references public.family_records(id) on delete cascade,
  creator_member_id uuid not null references public.family_members(id) on delete restrict,
  statement text not null check (char_length(statement) between 10 and 1200),
  title text not null check (char_length(title) between 1 and 80),
  left_label text not null check (char_length(left_label) between 1 and 30),
  right_label text not null check (char_length(right_label) between 1 and 30),
  left_member_id uuid references public.family_members(id) on delete set null,
  right_member_id uuid references public.family_members(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  ends_at timestamptz,
  closed_at timestamptz,
  close_reason text check (close_reason in ('creator', 'deadline')),
  neutral_summary text not null default '',
  resolution_kind text check (resolution_kind in ('creator')),
  resolved_stance text check (resolved_stance in ('left', 'right')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (left_label <> right_label)
);

create table if not exists public.family_judgement_stances (
  id uuid primary key default gen_random_uuid(),
  judgement_id uuid not null references public.family_judgements(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  stance text not null check (stance in ('left', 'right', 'neutral', 'undecided')),
  source text not null check (source in ('manual', 'ai_suggested', 'ai_confirmed')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence_message_id text,
  evidence_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (judgement_id, member_id)
);

-- Keep judgement totals synchronized for every open group-chat client.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'family_judgements') then
      alter publication supabase_realtime add table public.family_judgements;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'family_judgement_stances') then
      alter publication supabase_realtime add table public.family_judgement_stances;
    end if;
  end if;
end
$$;

create or replace function public.cast_family_decision_vote(target_decision_id uuid, actor_member_id uuid, target_option_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  decision_row public.family_decisions%rowtype;
  participant_count integer;
  ballot_count integer;
begin
  select * into decision_row from public.family_decisions where id = target_decision_id for update;
  if decision_row.id is null then raise exception '家庭决定不存在。'; end if;
  if decision_row.status <> 'open' or decision_row.closes_at <= now() then raise exception '家庭决定已经结束。'; end if;
  if not exists (select 1 from public.family_decision_participants where decision_id = target_decision_id and member_id = actor_member_id) then raise exception '无权参与该家庭决定。'; end if;
  if not exists (select 1 from public.family_decision_options where id = target_option_id and decision_id = target_decision_id) then raise exception '选项不属于该家庭决定。'; end if;
  insert into public.family_decision_ballots(decision_id, member_id, option_id)
  values(target_decision_id, actor_member_id, target_option_id)
  on conflict(decision_id, member_id) do update set option_id = excluded.option_id, updated_at = now();
  select count(*) into participant_count from public.family_decision_participants where decision_id = target_decision_id;
  select count(*) into ballot_count from public.family_decision_ballots where decision_id = target_decision_id;
  if participant_count > 0 and ballot_count >= participant_count then
    update public.family_decisions set status = 'closed', close_reason = 'all_voted', closed_at = now(), updated_at = now() where id = target_decision_id;
    return 'all_voted';
  end if;
  return 'open';
end;
$$;

revoke all on function public.cast_family_decision_vote(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cast_family_decision_vote(uuid, uuid, uuid) to service_role;

create or replace function public.create_family_decision(
  target_family_id uuid,
  target_room_record_id uuid,
  actor_member_id uuid,
  decision_question text,
  decision_closes_at timestamptz,
  decision_source_text text,
  option_labels jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  created_id uuid;
  room_row public.family_records%rowtype;
begin
  if decision_closes_at <= now() then raise exception '截止时间必须晚于当前时间。'; end if;
  if jsonb_array_length(option_labels) < 2 or jsonb_array_length(option_labels) > 8 then raise exception '家庭决定需要 2 到 8 个选项。'; end if;
  select * into room_row from public.family_records
  where id = target_room_record_id and family_id = target_family_id for update;
  if room_row.id is null or not (room_row.tags && array['群组', '群聊']) or coalesce(room_row.metadata->>'inviteLink', '') = '' then raise exception '群聊不存在。'; end if;
  if not exists (select 1 from public.family_members where id = actor_member_id and family_id = target_family_id) then raise exception '发起人不属于当前家庭。'; end if;
  if actor_member_id::text <> all(array(select jsonb_array_elements_text(coalesce(room_row.metadata->'chatMembers', '[]'::jsonb)))) then raise exception '发起人不是群聊成员。'; end if;
  insert into public.family_decisions(family_id, room_record_id, creator_member_id, question, closes_at, source_text)
  values(target_family_id, target_room_record_id, actor_member_id, left(trim(decision_question), 80), decision_closes_at, decision_source_text)
  returning id into created_id;
  insert into public.family_decision_participants(decision_id, member_id)
  select created_id, fm.id
  from public.family_members fm
  where fm.family_id = target_family_id
    and fm.id::text in (select jsonb_array_elements_text(coalesce(room_row.metadata->'chatMembers', '[]'::jsonb)))
  union select created_id, actor_member_id;
  insert into public.family_decision_options(decision_id, label, position)
  select created_id, left(trim(value), 60), ordinality - 1 from jsonb_array_elements_text(option_labels) with ordinality;
  return created_id;
end;
$$;

revoke all on function public.create_family_decision(uuid, uuid, uuid, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_family_decision(uuid, uuid, uuid, text, timestamptz, text, jsonb) to service_role;

create or replace function public.accept_invite_membership(
  target_invite_id uuid,
  target_user_id uuid,
  target_display_name text,
  target_avatar_url text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  invite_row public.invites%rowtype;
  membership_id uuid;
  next_used_count integer;
begin
  if target_user_id is null or char_length(trim(target_display_name)) not between 1 and 40 then
    raise exception '身份资料不完整。';
  end if;

  select * into invite_row from public.invites where id = target_invite_id for update;
  if invite_row.id is null then raise exception '邀请不存在。'; end if;
  if invite_row.status = 'revoked' then raise exception '邀请已撤销。'; end if;
  if invite_row.status <> 'active' or invite_row.expires_at <= now() then
    update public.invites set status = 'expired', updated_at = now() where id = target_invite_id and status <> 'revoked';
    raise exception '邀请已过期。';
  end if;
  if invite_row.used_count >= invite_row.max_use then
    update public.invites set status = 'expired', updated_at = now() where id = target_invite_id;
    raise exception '邀请使用次数已满。';
  end if;
  if exists (select 1 from public.invite_acceptances where invite_id = target_invite_id and user_id = target_user_id) then
    raise exception '你已经使用过这个邀请。';
  end if;

  insert into public.users(id, display_name, avatar_url)
  values(target_user_id, trim(target_display_name), nullif(trim(coalesce(target_avatar_url, '')), ''))
  on conflict(id) do update set
    display_name = excluded.display_name,
    avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url),
    updated_at = now();

  if invite_row.type = 'family' then
    if exists (select 1 from public.family_members where family_id = invite_row.family_id and user_id = target_user_id) then
      raise exception '你已经是这个家庭的成员。';
    end if;
    insert into public.family_members(family_id, user_id, display_name, role, relationship_role, avatar_seed)
    values(
      invite_row.family_id,
      target_user_id,
      trim(target_display_name),
      'member',
      coalesce(nullif(invite_row.metadata->>'relationship_role', ''), 'relative'),
      coalesce(nullif(invite_row.metadata->>'avatar_seed', ''), target_user_id::text)
    ) returning id into membership_id;
  else
    if exists (select 1 from public.group_members where group_id = invite_row.group_id and user_id = target_user_id and status = 'active') then
      raise exception '你已经在这个群聊中。';
    end if;
    insert into public.group_members(group_id, user_id, role, status, display_name, avatar_url)
    values(invite_row.group_id, target_user_id, 'guest', 'active', trim(target_display_name), nullif(trim(coalesce(target_avatar_url, '')), ''))
    on conflict(group_id, user_id) do update set
      role = 'guest', status = 'active', display_name = excluded.display_name,
      avatar_url = excluded.avatar_url, updated_at = now()
    returning id into membership_id;
  end if;

  insert into public.invite_acceptances(invite_id, user_id, membership_id)
  values(target_invite_id, target_user_id, membership_id);

  next_used_count := invite_row.used_count + 1;
  update public.invites set
    used_count = next_used_count,
    status = case when next_used_count >= max_use then 'expired' else 'active' end,
    updated_at = now()
  where id = target_invite_id;

  return jsonb_build_object(
    'invite_id', target_invite_id,
    'membership_id', membership_id,
    'type', invite_row.type,
    'family_id', invite_row.family_id,
    'group_id', invite_row.group_id
  );
end;
$$;

revoke all on function public.accept_invite_membership(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.accept_invite_membership(uuid, uuid, text, text) to service_role;

create table if not exists public.raw_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  actor_member_id uuid references public.family_members(id) on delete set null,
  actor_member_key text,
  actor_name text,
  source_space_id uuid references public.family_spaces(id) on delete set null,
  source_space_key text,
  source_type text not null check (source_type in (
    'home_input',
    'group_chat',
    'upload',
    'voice',
    'automation',
    'automation.action',
    'automation.action_request',
    'automation.pipeline',
    'automation.pipeline_request',
    'assistant_output',
    'system',
    'meta_event'
  )),
  raw_text text,
  raw_payload_json jsonb not null default '{}'::jsonb,
  client_metadata_json jsonb not null default '{}'::jsonb,
  server_metadata_json jsonb not null default '{}'::jsonb,
  conversation_id text,
  parent_event_id uuid references public.raw_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.assistant_interpretations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  raw_event_id uuid references public.raw_events(id) on delete cascade,
  raw_event_key text,
  intent_json jsonb not null default '[]'::jsonb,
  entities_json jsonb not null default '{}'::jsonb,
  tags_json jsonb not null default '[]'::jsonb,
  summary text,
  mood text,
  candidate_actions_json jsonb not null default '[]'::jsonb,
  action_buttons_json jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  route_source text check (route_source is null or route_source in ('rule', 'llm', 'hybrid', 'client')),
  matched_rule text,
  reason text,
  model_name text,
  prompt_version text,
  input_hash text,
  output_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  raw_event_id uuid references public.raw_events(id) on delete set null,
  raw_event_key text,
  interpretation_id uuid references public.assistant_interpretations(id) on delete set null,
  interpretation_key text,
  action_id text,
  pipeline_id text,
  status text not null default 'pending' check (status in ('pending', 'running', 'success', 'failed', 'canceled', 'waiting_confirmation')),
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  error_message text,
  requires_confirmation boolean not null default false,
  confirmed_by_member_id uuid references public.family_members(id) on delete set null,
  confirmed_at timestamptz,
  side_effect_level text not null default 'low' check (side_effect_level in ('none', 'low', 'medium', 'high')),
  model_name text,
  prompt_version text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  family_key text,
  actor_member_id uuid references public.family_members(id) on delete set null,
  actor_member_key text,
  summary_type text not null check (summary_type in ('daily', 'weekly', 'monthly', 'custom')),
  scope text not null check (scope in ('personal', 'family')),
  start_time timestamptz not null,
  end_time timestamptz not null,
  summary_text text not null default '',
  summary_json jsonb not null default '{}'::jsonb,
  source_event_ids_json jsonb not null default '[]'::jsonb,
  source_record_ids_json jsonb not null default '[]'::jsonb,
  source_message_ids_json jsonb not null default '[]'::jsonb,
  source_task_ids_json jsonb not null default '[]'::jsonb,
  source_resource_ids_json jsonb not null default '[]'::jsonb,
  model_name text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  family_key text,
  provider text not null,
  model_name text not null,
  operation text not null,
  status text not null check (status in ('success', 'failed')),
  request_id text,
  prompt_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cache_miss_input_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  input_cost_usd numeric(18, 9) not null default 0,
  output_cost_usd numeric(18, 9) not null default 0,
  total_cost_usd numeric(18, 9) not null default 0,
  input_cost_cny numeric(18, 6) not null default 0,
  output_cost_cny numeric(18, 6) not null default 0,
  total_cost_cny numeric(18, 6) not null default 0,
  pricing_json jsonb not null default '{}'::jsonb,
  pricing_source_url text,
  pricing_retrieved_at text,
  exchange_rate_source_url text,
  exchange_rate_retrieved_at text,
  duration_ms integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  in_app_enabled boolean not null default true,
  push_enabled boolean not null default true,
  task_assigned_enabled boolean not null default true,
  chat_message_enabled boolean not null default true,
  due_reminder_enabled boolean not null default true,
  timezone text not null default 'Asia/Shanghai',
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  reminder_offsets integer[] not null default array[15, 0],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, member_id)
);

create table if not exists public.notification_endpoints (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  channel text not null check (channel in ('web_push', 'fcm')),
  platform text not null check (platform in ('ios_pwa', 'android_pwa', 'desktop_pwa', 'android_native')),
  device_id text not null,
  endpoint text,
  p256dh text,
  auth text,
  fcm_token text,
  active boolean not null default true,
  failure_count integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, member_id, channel, device_id),
  check (
    (channel = 'web_push' and endpoint is not null and p256dh is not null and auth is not null and fcm_token is null)
    or (channel = 'fcm' and fcm_token is not null and endpoint is null and p256dh is null and auth is null)
  )
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  recipient_member_id uuid not null references public.family_members(id) on delete cascade,
  type text not null check (type in ('task_assigned', 'chat_message', 'task_due', 'decision_invited', 'decision_due', 'decision_closed')),
  title text not null,
  body text not null default '',
  deep_link text not null default '/',
  source_record_id uuid references public.family_records(id) on delete cascade,
  source_message_id text,
  actor_member_id uuid references public.family_members(id) on delete set null,
  scheduled_for timestamptz not null default now(),
  deliver_after timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'dispatching', 'sent', 'failed', 'canceled')),
  dedupe_key text not null unique,
  attempt_count integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notifications_due_idx on public.notifications (status, deliver_after) where status = 'queued';
create index if not exists notifications_member_created_idx on public.notifications (recipient_member_id, created_at desc);
create index if not exists notification_endpoints_member_idx on public.notification_endpoints (member_id, active);

create or replace function public.claim_due_notifications(batch_size integer default 100)
returns setof public.notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select id from public.notifications
    where (status = 'queued' and deliver_after <= now())
       or (status = 'dispatching' and claimed_at < now() - interval '10 minutes' and attempt_count < 4)
    order by deliver_after asc
    for update skip locked
    limit greatest(1, least(batch_size, 500))
  )
  update public.notifications n
  set status = 'dispatching', claimed_at = now(), attempt_count = attempt_count + 1, updated_at = now()
  from claimed
  where n.id = claimed.id
  returning n.*;
end;
$$;

revoke all on function public.claim_due_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(integer) to service_role;

create index family_members_family_id_idx on public.family_members (family_id);
create index family_members_user_id_idx on public.family_members (user_id) where user_id is not null;
create index family_spaces_family_type_idx on public.family_spaces (family_id, space_type);
create index space_members_space_idx on public.space_members (space_id);
create index space_members_member_idx on public.space_members (member_id);
create index family_records_family_updated_idx on public.family_records (family_id, updated_at desc);
create index family_records_space_updated_idx on public.family_records (space_id, updated_at desc);
create index family_records_family_kind_updated_idx on public.family_records (family_id, kind, updated_at desc);
create index family_records_family_status_updated_idx on public.family_records (family_id, status, updated_at desc);
create index if not exists family_decisions_room_created_idx on public.family_decisions (room_record_id, created_at desc);
create index if not exists family_judgements_room_created_idx on public.family_judgements (room_record_id, created_at desc);
create unique index if not exists family_judgements_one_active_room_idx on public.family_judgements (room_record_id) where status = 'active';
create index if not exists family_judgement_stances_judgement_idx on public.family_judgement_stances (judgement_id, updated_at desc);
create index family_records_assignees_gin_idx on public.family_records using gin (assignee_member_ids);
create index room_messages_family_created_idx on public.room_messages (family_id, created_at desc);
create index if not exists raw_events_family_created_idx on public.raw_events (family_id, created_at desc);
create index if not exists raw_events_source_type_idx on public.raw_events (source_type);
create index if not exists raw_events_conversation_idx on public.raw_events (conversation_id);
create index if not exists raw_events_parent_idx on public.raw_events (parent_event_id);
create index if not exists assistant_interpretations_family_created_idx on public.assistant_interpretations (family_id, created_at desc);
create index if not exists assistant_interpretations_raw_event_idx on public.assistant_interpretations (raw_event_id);
create index if not exists assistant_interpretations_route_source_idx on public.assistant_interpretations (route_source);
create index if not exists automation_runs_family_created_idx on public.automation_runs (family_id, created_at desc);
create index if not exists automation_runs_raw_event_idx on public.automation_runs (raw_event_id);
create index if not exists automation_runs_action_idx on public.automation_runs (action_id);
create index if not exists automation_runs_pipeline_idx on public.automation_runs (pipeline_id);
create index if not exists automation_runs_status_idx on public.automation_runs (status);
create index if not exists summaries_family_created_idx on public.summaries (family_id, created_at desc);
create index if not exists summaries_family_key_created_idx on public.summaries (family_key, created_at desc);
create index if not exists summaries_scope_range_idx on public.summaries (scope, summary_type, start_time, end_time);
create unique index if not exists summaries_background_job_unique_idx
  on public.summaries (family_id, ((summary_json ->> 'jobKey')))
  where summary_json ->> 'kind' = 'background_organization';
create index if not exists api_usage_family_created_idx on public.api_usage (family_id, created_at desc);
create index if not exists api_usage_family_key_created_idx on public.api_usage (family_key, created_at desc);
create index if not exists api_usage_model_idx on public.api_usage (model_name);
create index if not exists api_usage_operation_idx on public.api_usage (operation);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-notes',
  'voice-notes',
  false,
  26214400,
  array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.families enable row level security;
alter table public.users enable row level security;
alter table public.family_members enable row level security;
alter table public.family_spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.family_records enable row level security;
alter table public.group_members enable row level security;
alter table public.invites enable row level security;
alter table public.invite_acceptances enable row level security;
alter table public.family_join_requests enable row level security;
alter table public.family_relationships enable row level security;
alter table public.room_messages enable row level security;
alter table public.family_decisions enable row level security;
alter table public.family_decision_options enable row level security;
alter table public.family_decision_participants enable row level security;
alter table public.family_decision_ballots enable row level security;
alter table public.family_decision_messages enable row level security;
alter table public.family_judgements enable row level security;
alter table public.family_judgement_stances enable row level security;
alter table public.raw_events enable row level security;
alter table public.assistant_interpretations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.summaries enable row level security;
alter table public.api_usage enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_endpoints enable row level security;
alter table public.notification_preferences enable row level security;

create function public.is_family_creator(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.families
    where id = target_family_id
      and created_by = auth.uid()
  );
$$;

create function public.is_family_member(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members
    where family_id = target_family_id
      and user_id = auth.uid()
  );
$$;

create function public.is_member_in_family(target_family_id uuid, target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_member_id is null
    or exists (
      select 1
      from public.family_members
      where family_id = target_family_id
        and id = target_member_id
    );
$$;

create function public.is_decision_participant(target_decision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_decision_participants participant
    join public.family_decisions decision on decision.id = participant.decision_id
    join public.family_members member
      on member.id = participant.member_id
      and member.family_id = decision.family_id
    where participant.decision_id = target_decision_id
      and member.user_id = auth.uid()
  );
$$;

create function public.is_judgement_room_member(target_judgement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_judgements judgement
    join public.family_records room on room.id = judgement.room_record_id
    join public.family_members member on member.family_id = judgement.family_id
    where judgement.id = target_judgement_id
      and member.user_id = auth.uid()
      and member.id::text in (
        select jsonb_array_elements_text(coalesce(room.metadata->'chatMembers', '[]'::jsonb))
      )
  );
$$;

create function public.is_space_member(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.space_members sm
    join public.family_members fm on fm.id = sm.member_id
    where sm.space_id = target_space_id
      and fm.user_id = auth.uid()
  );
$$;

create function public.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create function public.set_family_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger family_records_set_updated_at
  before update on public.family_records
  for each row
  execute function public.set_family_records_updated_at();

create trigger family_judgements_set_updated_at
  before update on public.family_judgements
  for each row
  execute function public.set_family_records_updated_at();

create trigger family_judgement_stances_set_updated_at
  before update on public.family_judgement_stances
  for each row
  execute function public.set_family_records_updated_at();

create trigger raw_events_set_updated_at
  before update on public.raw_events
  for each row
  execute function public.set_family_records_updated_at();

create policy "authenticated users can create families"
  on public.families for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "users can read their identity"
  on public.users for select
  to authenticated
  using (id = auth.uid());

create policy "users can update their identity"
  on public.users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "members can read families"
  on public.families for select
  to authenticated
  using (public.is_family_creator(id) or public.is_family_member(id));

create policy "members can update families"
  on public.families for update
  to authenticated
  using (public.is_family_creator(id) or public.is_family_member(id))
  with check (public.is_family_creator(id) or public.is_family_member(id));

create policy "members can read family members"
  on public.family_members for select
  to authenticated
  using (public.is_family_member(family_id));

create policy "creators and members can add family members"
  on public.family_members for insert
  to authenticated
  with check (public.is_family_creator(family_id) or public.is_family_member(family_id));

create policy "members can update family members"
  on public.family_members for update
  to authenticated
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

create policy "space members can read spaces"
  on public.family_spaces for select
  to authenticated
  using (public.is_space_member(id));

create policy "family members can create spaces"
  on public.family_spaces for insert
  to authenticated
  with check (public.is_family_member(family_id));

create policy "space members can read memberships"
  on public.space_members for select
  to authenticated
  using (public.is_space_member(space_id));

create policy "family members can add space memberships"
  on public.space_members for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.family_spaces fs
      where fs.id = space_id
        and public.is_family_member(fs.family_id)
    )
  );

create policy "members can read records"
  on public.family_records for select
  to authenticated
  using (
    (space_id is null and public.is_family_member(family_id))
    or public.is_space_member(space_id)
    or public.is_group_member(id)
  );

create policy "group participants can read memberships"
  on public.group_members for select
  to authenticated
  using (
    public.is_group_member(group_id)
    or exists (
      select 1 from public.family_records room
      where room.id = group_id and public.is_family_member(room.family_id)
    )
  );

create policy "invite creators can read invites"
  on public.invites for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_family_member(family_id)
  );

create policy "users can read their invite acceptances"
  on public.invite_acceptances for select
  to authenticated
  using (user_id = auth.uid());

create policy "applicants and family creators can read join requests"
  on public.family_join_requests for select
  to authenticated
  using (user_id = auth.uid() or public.is_family_creator(family_id));

create policy "family members can read viewer relationships"
  on public.family_relationships for select
  to authenticated
  using (public.is_family_member(family_id));

create policy "members can insert records"
  on public.family_records for insert
  to authenticated
  with check (
    public.is_family_member(family_id)
    and (space_id is null or public.is_space_member(space_id))
    and public.is_member_in_family(family_id, member_id)
    and public.is_member_in_family(family_id, created_by_member_id)
  );

create policy "members can update records"
  on public.family_records for update
  to authenticated
  using (
    (space_id is null and public.is_family_member(family_id))
    or public.is_space_member(space_id)
  )
  with check (
    public.is_family_member(family_id)
    and (space_id is null or public.is_space_member(space_id))
    and public.is_member_in_family(family_id, member_id)
    and public.is_member_in_family(family_id, created_by_member_id)
  );

create policy "members can read messages"
  on public.room_messages for select
  to authenticated
  using (public.is_family_member(family_id));

create policy "members can insert messages"
  on public.room_messages for insert
  to authenticated
  with check (
    public.is_family_member(family_id)
    and public.is_member_in_family(family_id, member_id)
  );

create policy "decision participants can read decisions"
  on public.family_decisions for select to authenticated
  using (public.is_decision_participant(id));

create policy "family members can create decisions"
  on public.family_decisions for insert to authenticated
  with check (public.is_family_member(family_id) and public.is_member_in_family(family_id, creator_member_id));

create policy "decision participants can read decision options"
  on public.family_decision_options for select to authenticated
  using (public.is_decision_participant(decision_id));

create policy "decision participants can read decision participants"
  on public.family_decision_participants for select to authenticated
  using (public.is_decision_participant(decision_id));

create policy "decision participants can read decision ballots"
  on public.family_decision_ballots for select to authenticated
  using (public.is_decision_participant(decision_id));

create policy "decision participants can read decision messages"
  on public.family_decision_messages for select to authenticated
  using (public.is_decision_participant(decision_id));

create policy "room members can read judgements"
  on public.family_judgements for select to authenticated
  using (public.is_judgement_room_member(id));

create policy "room members can read judgement stances"
  on public.family_judgement_stances for select to authenticated
  using (public.is_judgement_room_member(judgement_id));

create policy "members can read raw events"
  on public.raw_events for select
  to authenticated
  using (family_id is not null and public.is_family_member(family_id));

create policy "members can insert raw events"
  on public.raw_events for insert
  to authenticated
  with check (
    family_id is not null
    and public.is_family_member(family_id)
    and public.is_member_in_family(family_id, actor_member_id)
  );

create policy "members can read assistant interpretations"
  on public.assistant_interpretations for select
  to authenticated
  using (family_id is not null and public.is_family_member(family_id));

create policy "members can insert assistant interpretations"
  on public.assistant_interpretations for insert
  to authenticated
  with check (family_id is not null and public.is_family_member(family_id));

create policy "members can read automation runs"
  on public.automation_runs for select
  to authenticated
  using (family_id is not null and public.is_family_member(family_id));

create policy "members can insert automation runs"
  on public.automation_runs for insert
  to authenticated
  with check (family_id is not null and public.is_family_member(family_id));

create policy "members can read summaries"
  on public.summaries for select
  to authenticated
  using (family_id is not null and public.is_family_member(family_id));

create policy "members can insert summaries"
  on public.summaries for insert
  to authenticated
  with check (family_id is not null and public.is_family_member(family_id));

create policy "members can read api usage"
  on public.api_usage for select
  to authenticated
  using (family_id is not null and public.is_family_member(family_id));

create policy "members can insert api usage"
  on public.api_usage for insert
  to authenticated
  with check (family_id is not null and public.is_family_member(family_id));

create policy "members can read own notifications"
  on public.notifications for select to authenticated
  using (
    public.is_family_member(family_id)
    and recipient_member_id in (select id from public.family_members where user_id = auth.uid())
  );

create policy "members can update own notifications"
  on public.notifications for update to authenticated
  using (recipient_member_id in (select id from public.family_members where user_id = auth.uid()))
  with check (recipient_member_id in (select id from public.family_members where user_id = auth.uid()));

create policy "members manage own notification endpoints"
  on public.notification_endpoints for all to authenticated
  using (member_id in (select id from public.family_members where user_id = auth.uid()))
  with check (
    public.is_family_member(family_id)
    and member_id in (select id from public.family_members where user_id = auth.uid())
  );

create policy "members manage own notification preferences"
  on public.notification_preferences for all to authenticated
  using (member_id in (select id from public.family_members where user_id = auth.uid()))
  with check (
    public.is_family_member(family_id)
    and member_id in (select id from public.family_members where user_id = auth.uid())
  );

-- Persistent, cross-device state for evidence-first family knowledge inquiries.
-- `revision` is used as an optimistic compare-and-swap guard. `active_key`
-- prevents duplicate open inquiries while allowing the same question to be
-- asked again after the previous inquiry is resolved or dismissed.
create table if not exists public.knowledge_inquiries (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  requester_member_id uuid not null references public.family_members(id) on delete cascade,
  target_member_id uuid not null references public.family_members(id) on delete cascade,
  status text not null check (status in ('awaiting_choice', 'awaiting_member_reply', 'awaiting_user_input', 'resolved', 'dismissed')),
  creation_key text not null,
  active_key text,
  revision integer not null default 1 check (revision > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, active_key)
);

create index if not exists knowledge_inquiries_requester_updated_idx
  on public.knowledge_inquiries (family_id, requester_member_id, updated_at desc);
create index if not exists knowledge_inquiries_target_updated_idx
  on public.knowledge_inquiries (family_id, target_member_id, updated_at desc);
create index if not exists knowledge_inquiries_due_lease_idx
  on public.knowledge_inquiries (status, lease_expires_at, updated_at);

alter table public.knowledge_inquiries enable row level security;

create policy "inquiry participants can read knowledge inquiries"
  on public.knowledge_inquiries for select to authenticated
  using (
    public.is_family_member(family_id)
    and (
      requester_member_id in (select id from public.family_members where user_id = auth.uid())
      or target_member_id in (select id from public.family_members where user_id = auth.uid())
    )
  );

create trigger knowledge_inquiries_set_updated_at
  before update on public.knowledge_inquiries
  for each row execute function public.set_updated_at();
