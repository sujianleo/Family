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
  if room_row.id is null or not (room_row.tags && array['群组', '群聊']) then raise exception '群聊不存在。'; end if;
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
