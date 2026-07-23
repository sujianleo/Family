import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type LiteGlobal = typeof globalThis & {
  familyLiteDatabase?: DatabaseSync;
};

const globalForLite = globalThis as LiteGlobal;

export function getLiteDatabase() {
  if (globalForLite.familyLiteDatabase) return globalForLite.familyLiteDatabase;

  const configuredPath = process.env.FAMILY_APP_SQLITE_PATH?.trim() || "data/family.sqlite";
  const databasePath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(/* turbopackIgnore: true */ process.cwd(), configuredPath);
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("pragma journal_mode = WAL;");
  database.exec("pragma foreign_keys = ON;");
  database.exec("pragma busy_timeout = 5000;");
  database.exec(`
    create table if not exists lite_installation (
      id integer primary key check (id = 1),
      family_id text not null,
      family_name text not null,
      created_at text not null
    );

    create table if not exists lite_accounts (
      id text primary key,
      family_id text not null,
      member_id text not null unique,
      phone text not null unique,
      display_name text not null,
      password_hash text not null,
      role text not null check (role in ('admin', 'member')),
      created_at text not null
    );

    create table if not exists lite_family_records (
      id text primary key,
      family_id text not null,
      member_id text,
      payload_json text not null,
      updated_at text not null
    );

    create table if not exists lite_settings (
      key text primary key,
      value_json text not null,
      updated_at text not null
    );

    create table if not exists lite_member_profiles (
      member_id text primary key,
      avatar_seed text not null default '',
      relationship_label text not null default '',
      relationship_role text not null default 'relative',
      profile_json text not null default '{}'
    );

    create table if not exists lite_invites (
      id text primary key,
      family_id text not null,
      type text not null check (type in ('family', 'group')),
      code_hash text not null,
      status text not null check (status in ('active', 'expired', 'revoked')),
      max_use integer not null,
      used_count integer not null default 0,
      created_by_member_id text not null,
      expires_at text not null,
      metadata_json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists lite_join_requests (
      id text primary key,
      invite_id text not null unique,
      family_id text not null,
      display_name text not null,
      phone text not null,
      password_hash text not null,
      avatar_seed text not null default '',
      relationship_label text not null,
      relationship_role text not null,
      status text not null check (status in ('pending', 'approved', 'rejected')),
      reviewed_by_member_id text,
      reviewed_at text,
      created_at text not null,
      updated_at text not null,
      foreign key(invite_id) references lite_invites(id)
    );

    create index if not exists lite_family_records_family_updated_idx
      on lite_family_records(family_id, updated_at desc);
    create index if not exists lite_invites_family_created_idx
      on lite_invites(family_id, created_at desc);
    create index if not exists lite_join_requests_family_status_idx
      on lite_join_requests(family_id, status, created_at desc);
  `);
  const profileColumns = database.prepare("pragma table_info(lite_member_profiles)").all() as Array<{ name: string }>;
  if (!profileColumns.some((column) => column.name === "profile_json")) {
    database.exec("alter table lite_member_profiles add column profile_json text not null default '{}';");
  }

  globalForLite.familyLiteDatabase = database;
  return database;
}
