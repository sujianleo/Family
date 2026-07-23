export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RelationshipRole = "parent" | "child" | "spouse" | "relative" | "friend" | "guest";

export type FamilyMember = {
  id: string;
  displayName: string;
  role: string;
  relationshipRole?: RelationshipRole;
  relationshipLabel?: string;
  householdRoles?: string[];
  profile?: MemberProfile;
  status: "online" | "away";
  avatarSeed: string;
  color?: string;
};

export type FamilyRecordKind = "task" | "note" | "link" | "media";
export type FamilyAssetType = "photo" | "video" | "audio" | "pdf" | "word" | "excel" | "text" | "link" | "archive";
export type FamilyRecordStatus = "todo" | "doing" | "done" | "saved";
export type FamilySpaceType = "core" | "guest";
export type FamilyRecordAudience = "core" | "guest";
export type AssignmentStatus = "suggested" | "assigned" | "accepted" | "done";
export type TaskActionType = "approval" | "input" | "multiple_choice";
export type RoomMessageType = "text" | "voice" | "file" | "system";
export type MemberLocationSource = "browser" | "manual" | "profile" | "default";

export type MemberLocation = {
  label?: string;
  address?: string;
  province?: string;
  city?: string;
  district?: string;
  country?: string;
  lat?: number;
  lon?: number;
  source?: MemberLocationSource;
  updatedAt?: string;
};

export type MemberProfile = {
  gender?: string;
  ageRange?: string;
  age?: number;
  birthCalendar?: "solar" | "lunar";
  birthDate?: string;
  occupation?: string;
  resumeNotes?: string[];
  interests?: string[];
  healthNotes?: string[];
  chronicConditions?: string[];
  careNotes?: string[];
  defaultLocation?: MemberLocation;
  locations?: MemberLocation[];
  recentMedicalVisits?: Array<{
    hospital?: string;
    department?: string;
    checkup?: string;
    time?: string;
    note?: string;
  }>;
  evidence?: Array<{
    eventId: string;
    field: string;
    text: string;
    confidence: number;
  }>;
  confidence?: number;
  updatedAt?: string;
};

export type FamilySpace = {
  id: string;
  familyId: string;
  name: string;
  spaceType: FamilySpaceType;
};

export type SpaceMember = {
  id: string;
  spaceId: string;
  memberId: string;
  accessRole: "owner" | "member" | "guest";
};

export type FamilyRecord = {
  id: string;
  kind: FamilyRecordKind;
  title: string;
  summary: string;
  ownerName: string;
  ownerMemberId?: string;
  createdByMemberId?: string;
  displayTime?: string;
  dueAt?: string;
  occurredAt?: string;
  occurredOn?: string;
  timeZone?: string;
  timePrecision?: "date" | "minute" | "duration" | "recurrence";
  sourceTimeText?: string;
  reminderOffsets?: number[];
  recurrence?: TaskRecurrence;
  assigneeMemberIds?: string[];
  spaceId?: string;
  audience?: FamilyRecordAudience;
  assignmentStatus?: AssignmentStatus;
  assignmentReason?: string;
  taskActionType?: TaskActionType;
  taskOptions?: string[];
  taskResponses?: TaskResponse[];
  joinRequestId?: string;
  inviteId?: string;
  relationshipLabel?: string;
  inviteLink?: string;
  chatMembers?: string[];
  chatMessages?: RoomMessage[];
  assetType?: FamilyAssetType;
  audioPath?: string;
  durationMs?: number;
  fileName?: string;
  previewUrl?: string;
  sourceAvatarSeed?: string;
  sourceFiles?: {
    cacheUrl?: string;
    contentHash?: string;
    name: string;
    originalUrl?: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    size?: number;
    storage?: string;
    type?: string;
    url?: string;
  }[];
  sourceMemberId?: string;
  sourceMessageId?: string;
  transcript?: string;
  uploadProgress?: number;
  uploadState?: "error" | "uploading";
  status: FamilyRecordStatus;
  updatedAt: string;
  tags: string[];
};

export type TaskResponse = {
  memberId: string;
  memberName: string;
  status: "pending" | "accepted" | "rejected" | "answered";
  text?: string;
  choices?: string[];
  updatedAt?: string;
};

export type TaskRecurrence = {
  dayOfMonth?: number;
  interval: number;
  kind: "daily" | "interval_days" | "interval_weeks" | "monthly" | "weekdays" | "weekly";
  label: string;
  weekdays?: number[];
};

export type SuggestedAssignee = {
  id: string;
  displayName: string;
  roleLabel?: string;
  avatarSeed: string;
  color?: string;
};

export type AssignmentSuggestion = {
  suggestedAssignees: SuggestedAssignee[];
  suggestedRoles: string[];
  reason: string;
  confidence: number;
  source?: "deepseek" | "local";
  displayTime?: string;
  dueAt?: string;
  sourceText?: string;
  requiresClarification?: boolean;
  clarificationMessage?: string;
  personalTodo?: boolean;
  recurrence?: TaskRecurrence;
  taskTitle?: string;
  taskActionType?: TaskActionType;
  taskOptions?: string[];
};

export type RoomMessage = {
  id: string;
  senderName: string;
  body: string;
  sentAt: string;
  senderAvatarSeed?: string;
  senderMemberId?: string;
  stickerId?: string;
  type?: RoomMessageType;
  files?: {
    cacheUrl?: string;
    name: string;
    originalUrl?: string;
    previewUrl?: string;
    size?: number;
    storage?: string;
    type?: string;
    url?: string;
  }[];
  mine?: boolean;
  presentation?: "activity_plan";
  judgementId?: string;
  judgementLifecycle?: "started" | "closed";
  knowledgeInquiryId?: string;
};

export type Database = {
  public: {
    Tables: {
      families: {
        Row: {
          id: string;
          name: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_by?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: { id: string; display_name: string; avatar_url: string | null; created_at: string; updated_at: string };
        Insert: { id: string; display_name: string; avatar_url?: string | null; created_at?: string; updated_at?: string };
        Update: { display_name?: string; avatar_url?: string | null; updated_at?: string };
        Relationships: [];
      };
      family_members: {
        Row: {
          id: string;
          family_id: string;
          user_id: string | null;
          display_name: string;
          role: string;
          relationship_role: RelationshipRole | null;
          household_roles: string[];
          status: FamilyMember["status"];
          avatar_seed: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          user_id?: string | null;
          display_name: string;
          role?: string;
          relationship_role?: RelationshipRole | null;
          household_roles?: string[];
          status?: FamilyMember["status"];
          avatar_seed?: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          user_id?: string | null;
          display_name?: string;
          role?: string;
          relationship_role?: RelationshipRole | null;
          household_roles?: string[];
          status?: FamilyMember["status"];
          avatar_seed?: string;
          color?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey";
            columns: ["family_id"];
            isOneToOne: false;
            referencedRelation: "families";
            referencedColumns: ["id"];
          }
        ];
      };
      family_records: {
        Row: {
          id: string;
          family_id: string;
          member_id: string | null;
          space_id: string | null;
          created_by_member_id: string | null;
          assignee_member_ids: string[];
          audience: FamilyRecordAudience;
          assignment_status: AssignmentStatus;
          assignment_reason: string;
          kind: FamilyRecordKind;
          title: string;
          summary: string;
          status: FamilyRecordStatus;
          tags: string[];
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          member_id?: string | null;
          space_id?: string | null;
          created_by_member_id?: string | null;
          assignee_member_ids?: string[];
          audience?: FamilyRecordAudience;
          assignment_status?: AssignmentStatus;
          assignment_reason?: string;
          kind: FamilyRecordKind;
          title: string;
          summary?: string;
          status?: FamilyRecordStatus;
          tags?: string[];
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          member_id?: string | null;
          space_id?: string | null;
          created_by_member_id?: string | null;
          assignee_member_ids?: string[];
          audience?: FamilyRecordAudience;
          assignment_status?: AssignmentStatus;
          assignment_reason?: string;
          kind?: FamilyRecordKind;
          title?: string;
          summary?: string;
          status?: FamilyRecordStatus;
          tags?: string[];
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "family_records_family_id_fkey";
            columns: ["family_id"];
            isOneToOne: false;
            referencedRelation: "families";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "family_records_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "family_members";
            referencedColumns: ["id"];
          }
        ];
      };
      group_members: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          role: "member" | "guest";
          status: "active" | "removed";
          display_name: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          role?: "member" | "guest";
          status?: "active" | "removed";
          display_name: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          role?: "member" | "guest";
          status?: "active" | "removed";
          display_name?: string;
          avatar_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      invites: {
        Row: {
          id: string;
          type: "family" | "group";
          family_id: string | null;
          group_id: string | null;
          created_by: string;
          created_by_member_id: string | null;
          code_hash: string;
          expires_at: string;
          max_use: number;
          used_count: number;
          status: "active" | "expired" | "revoked";
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          type: "family" | "group";
          family_id?: string | null;
          group_id?: string | null;
          created_by: string;
          created_by_member_id?: string | null;
          code_hash: string;
          expires_at: string;
          max_use: number;
          used_count?: number;
          status?: "active" | "expired" | "revoked";
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          expires_at?: string;
          max_use?: number;
          used_count?: number;
          status?: "active" | "expired" | "revoked";
          metadata?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      invite_acceptances: {
        Row: { id: string; invite_id: string; user_id: string; membership_id: string; accepted_at: string };
        Insert: { id?: string; invite_id: string; user_id: string; membership_id: string; accepted_at?: string };
        Update: never;
        Relationships: [];
      };
      room_messages: {
        Row: {
          id: string;
          family_id: string;
          member_id: string | null;
          body: string;
          message_type: RoomMessageType;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          member_id?: string | null;
          body: string;
          message_type?: RoomMessageType;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          member_id?: string | null;
          body?: string;
          message_type?: RoomMessageType;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_messages_family_id_fkey";
            columns: ["family_id"];
            isOneToOne: false;
            referencedRelation: "families";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_messages_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "family_members";
            referencedColumns: ["id"];
          }
        ];
      };
      family_spaces: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          space_type: FamilySpaceType;
          created_by_member_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          space_type?: FamilySpaceType;
          created_by_member_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          space_type?: FamilySpaceType;
          created_by_member_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "family_spaces_family_id_fkey";
            columns: ["family_id"];
            isOneToOne: false;
            referencedRelation: "families";
            referencedColumns: ["id"];
          }
        ];
      };
      space_members: {
        Row: {
          id: string;
          space_id: string;
          member_id: string;
          access_role: "owner" | "member" | "guest";
          created_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          member_id: string;
          access_role?: "owner" | "member" | "guest";
          created_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          member_id?: string;
          access_role?: "owner" | "member" | "guest";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "space_members_space_id_fkey";
            columns: ["space_id"];
            isOneToOne: false;
            referencedRelation: "family_spaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "space_members_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "family_members";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_family_creator: {
        Args: { target_family_id: string };
        Returns: boolean;
      };
      is_family_member: {
        Args: { target_family_id: string };
        Returns: boolean;
      };
      is_group_member: {
        Args: { target_group_id: string };
        Returns: boolean;
      };
      accept_invite_membership: {
        Args: { target_invite_id: string; target_user_id: string; target_display_name: string; target_avatar_url?: string | null };
        Returns: Json;
      };
      is_member_in_family: {
        Args: { target_family_id: string; target_member_id: string | null };
        Returns: boolean;
      };
      set_family_records_updated_at: {
        Args: Record<string, never>;
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Inserts<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type Updates<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
