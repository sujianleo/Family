import type { MemberProfile, TaskActionType } from "./types";

export type DeepSeekAssignmentJson = {
  task_title: string;
  display_time: string;
  personal_todo: boolean;
  suggested_assignee_ids: string[];
  suggested_roles: string[];
  reason: string;
  confidence: number;
  task_action_type: TaskActionType;
  task_options: string[];
};

export const assignmentSuggestionResponseFormat = {
  type: "json_object"
} as const;

export const assignmentSuggestionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "task_title",
    "display_time",
    "personal_todo",
    "suggested_assignee_ids",
    "suggested_roles",
    "reason",
    "confidence",
    "task_action_type",
    "task_options"
  ],
  properties: {
    task_title: {
      type: "string",
      minLength: 1,
      maxLength: 24
    },
    display_time: {
      type: "string",
      maxLength: 24
    },
    personal_todo: {
      type: "boolean"
    },
    suggested_assignee_ids: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        minLength: 1
      }
    },
    suggested_roles: {
      type: "array",
      items: {
        type: "string",
        minLength: 1
      }
    },
    reason: {
      type: "string",
      minLength: 1
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    task_action_type: {
      type: "string",
      enum: ["approval", "input", "multiple_choice"]
    },
    task_options: {
      type: "array",
      items: {
        type: "string",
        minLength: 1
      }
    }
  }
} as const;

type SchemaResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      reason: "invalid_assignment_schema" | "invalid_profile_schema";
    };

const assignmentKeys = new Set([
  "task_title",
  "display_time",
  "personal_todo",
  "suggested_assignee_ids",
  "suggested_roles",
  "reason",
  "confidence",
  "task_action_type",
  "task_options"
]);

const profileKeys = new Set([
  "gender",
  "ageRange",
  "occupation",
  "resumeNotes",
  "interests",
  "healthNotes",
  "chronicConditions",
  "careNotes",
  "recentMedicalVisits",
  "evidence",
  "confidence"
]);

const visitKeys = new Set(["hospital", "department", "checkup", "time", "note"]);
const evidenceKeys = new Set(["eventId", "field", "text", "confidence"]);
const profileClaimFields = new Set([
  "gender",
  "ageRange",
  "occupation",
  "resumeNotes",
  "interests",
  "healthNotes",
  "chronicConditions",
  "careNotes",
  "recentMedicalVisits"
]);

export function validateAssignmentSuggestionJson(value: unknown): SchemaResult<DeepSeekAssignmentJson> {
  if (!isPlainObject(value) || hasUnknownKeys(value, assignmentKeys)) {
    return invalidAssignment();
  }

  if (
    !isNonEmptyString(value.task_title) ||
    !isString(value.display_time) ||
    typeof value.personal_todo !== "boolean" ||
    !isNonEmptyStringArray(value.suggested_assignee_ids) ||
    !isStringArray(value.suggested_roles) ||
    !isNonEmptyString(value.reason) ||
    !isConfidence(value.confidence) ||
    !isTaskActionType(value.task_action_type) ||
    !isStringArray(value.task_options)
  ) {
    return invalidAssignment();
  }

  if (value.task_action_type === "multiple_choice" && (value.task_options.length < 2 || value.task_options.length > 8)) {
    return invalidAssignment();
  }

  return {
    ok: true,
    value: {
      task_title: value.task_title.trim(),
      display_time: value.display_time.trim(),
      personal_todo: value.personal_todo,
      suggested_assignee_ids: value.suggested_assignee_ids.map((item) => item.trim()),
      suggested_roles: value.suggested_roles.map((item) => item.trim()),
      reason: value.reason.trim(),
      confidence: value.confidence,
      task_action_type: value.task_action_type,
      task_options: value.task_options.map((item) => item.trim())
    }
  };
}

export function validateMemberProfileJson(value: unknown, allowedEventIds?: ReadonlySet<string>): SchemaResult<MemberProfile> {
  if (!isPlainObject(value) || hasUnknownKeys(value, profileKeys)) {
    return invalidProfile();
  }

  const profile: MemberProfile = {};

  if (!copyOptionalString(profile, value, "gender")) return invalidProfile();
  if (!copyOptionalString(profile, value, "ageRange")) return invalidProfile();
  if (!copyOptionalString(profile, value, "occupation")) return invalidProfile();
  if (!copyOptionalStringArray(profile, value, "resumeNotes")) return invalidProfile();
  if (!copyOptionalStringArray(profile, value, "interests")) return invalidProfile();
  if (!copyOptionalStringArray(profile, value, "healthNotes")) return invalidProfile();
  if (!copyOptionalStringArray(profile, value, "chronicConditions")) return invalidProfile();
  if (!copyOptionalStringArray(profile, value, "careNotes")) return invalidProfile();

  if ("recentMedicalVisits" in value) {
    if (!Array.isArray(value.recentMedicalVisits)) return invalidProfile();
    const visits = [];
    for (const visit of value.recentMedicalVisits) {
      if (!isPlainObject(visit) || hasUnknownKeys(visit, visitKeys)) return invalidProfile();
      if (!allOptionalStrings(visit, visitKeys)) return invalidProfile();
      visits.push({
        hospital: optionalTrimmedString(visit.hospital),
        department: optionalTrimmedString(visit.department),
        checkup: optionalTrimmedString(visit.checkup),
        time: optionalTrimmedString(visit.time),
        note: optionalTrimmedString(visit.note)
      });
    }
    profile.recentMedicalVisits = visits;
  }

  if ("evidence" in value) {
    if (!Array.isArray(value.evidence)) return invalidProfile();
    const evidence = [];
    for (const item of value.evidence) {
      if (!isPlainObject(item) || hasUnknownKeys(item, evidenceKeys)) return invalidProfile();
      if (!isNonEmptyString(item.eventId) || !isNonEmptyString(item.field) || !isNonEmptyString(item.text) || !isConfidence(item.confidence)) {
        return invalidProfile();
      }
      if (allowedEventIds && !allowedEventIds.has(item.eventId)) {
        return invalidProfile();
      }
      evidence.push({
        eventId: item.eventId.trim(),
        field: item.field.trim(),
        text: item.text.trim(),
        confidence: item.confidence
      });
    }
    profile.evidence = evidence;
  }

  if (!hasEvidenceForEveryClaim(profile)) {
    return invalidProfile();
  }

  if ("confidence" in value) {
    if (!isConfidence(value.confidence)) return invalidProfile();
    profile.confidence = value.confidence;
  }

  return {
    ok: true,
    value: profile
  };
}

function copyOptionalString<T extends "gender" | "ageRange" | "occupation">(profile: MemberProfile, data: Record<string, unknown>, field: T) {
  if (!(field in data)) return true;
  const value = optionalTrimmedString(data[field]);
  if (!value) return false;
  profile[field] = value;
  return true;
}

function copyOptionalStringArray<T extends "resumeNotes" | "interests" | "healthNotes" | "chronicConditions" | "careNotes">(
  profile: MemberProfile,
  data: Record<string, unknown>,
  field: T
) {
  if (!(field in data)) return true;
  if (!isStringArray(data[field])) return false;
  profile[field] = data[field].map((item) => item.trim());
  return true;
}

function allOptionalStrings(data: Record<string, unknown>, keys: ReadonlySet<string>) {
  for (const key of keys) {
    if (key in data && data[key] !== undefined && data[key] !== null && typeof data[key] !== "string") {
      return false;
    }
  }
  return true;
}

function optionalTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasUnknownKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>) {
  return Object.keys(value).some((key) => !allowedKeys.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return isStringArray(value) && value.length > 0;
}

function hasEvidenceForEveryClaim(profile: MemberProfile) {
  const evidenceFields = new Set((profile.evidence || []).map((item) => item.field));
  for (const field of profileClaimFields) {
    const value = profile[field as keyof MemberProfile];
    if (Array.isArray(value) ? value.length > 0 : Boolean(value)) {
      if (!evidenceFields.has(field)) {
        return false;
      }
    }
  }
  return true;
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTaskActionType(value: unknown): value is TaskActionType {
  return value === "approval" || value === "input" || value === "multiple_choice";
}

function invalidAssignment(): SchemaResult<DeepSeekAssignmentJson> {
  return {
    ok: false,
    reason: "invalid_assignment_schema"
  };
}

function invalidProfile(): SchemaResult<MemberProfile> {
  return {
    ok: false,
    reason: "invalid_profile_schema"
  };
}
