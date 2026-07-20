with seed_target as (
  select
    families.id as family_id,
    (
      select family_members.id
      from public.family_members
      where family_members.family_id = families.id
      order by family_members.created_at asc
      limit 1
    ) as member_id
  from public.families
  order by families.created_at asc
  limit 1
)
insert into public.family_records (
  id,
  family_id,
  member_id,
  kind,
  title,
  summary,
  status,
  tags,
  metadata,
  created_at,
  updated_at
)
select
  record.id::uuid,
  seed_target.family_id,
  seed_target.member_id,
  record.kind,
  record.title,
  record.summary,
  record.status,
  record.tags,
  record.metadata::jsonb,
  record.created_at::timestamptz,
  record.updated_at::timestamptz
from seed_target
cross join (
  values
    (
      '8f763b18-5cfd-4c3d-9a70-9f73445b1f21',
      'media',
      '客厅改造前照片',
      '图片 · 3 张 · 需要确认保留哪一版',
      'saved',
      array['媒体', '图片'],
      '{"asset_type":"image","files":[{"name":"living-room-before-1.jpg","mime_type":"image/jpeg","size":428000},{"name":"living-room-before-2.jpg","mime_type":"image/jpeg","size":389000},{"name":"living-room-before-3.jpg","mime_type":"image/jpeg","size":417000}]}',
      '2026-06-06 11:12:00+08',
      '2026-06-06 11:12:00+08'
    ),
    (
      'c2d62379-8ec9-46d2-a4c3-7ca4636b1fc8',
      'media',
      '老妈语音留言',
      '语音 · 00:42 · 周末聚餐提醒',
      'saved',
      array['媒体', '语音'],
      '{"asset_type":"voice","duration_seconds":42,"files":[{"name":"mom-dinner-reminder.m4a","mime_type":"audio/mp4","size":612000}]}',
      '2026-06-06 11:06:00+08',
      '2026-06-06 11:06:00+08'
    ),
    (
      'c557b220-d0f2-42fa-9909-240c8446a7e8',
      'media',
      '机票截图汇总',
      '图片 · 2 张 · 来自姐姐',
      'saved',
      array['媒体', '图片'],
      '{"asset_type":"image","files":[{"name":"ticket-option-a.png","mime_type":"image/png","size":322000},{"name":"ticket-option-b.png","mime_type":"image/png","size":301000}]}',
      '2026-06-06 10:58:00+08',
      '2026-06-06 10:58:00+08'
    )
) as record(id, kind, title, summary, status, tags, metadata, created_at, updated_at)
where seed_target.family_id is not null
on conflict (id) do update set
  title = excluded.title,
  summary = excluded.summary,
  status = excluded.status,
  tags = excluded.tags,
  metadata = excluded.metadata,
  updated_at = excluded.updated_at;
