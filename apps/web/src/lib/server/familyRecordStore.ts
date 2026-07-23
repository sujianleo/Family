import type { AssignmentStatus, FamilyRecord, FamilyRecordStatus } from "../types";
import {
  deleteLiteFamilyRecord,
  listLiteFamilyRecords,
  readLiteAccounts,
  saveLiteFamilyRecord,
  updateLiteFamilyRecord
} from "./liteRepository";

export type SaveFamilyRecordInput = {
  familyId: string;
  memberId: string;
  record: FamilyRecord;
};

export type UpdateFamilyRecordInput = {
  assignmentStatus?: AssignmentStatus;
  familyId: string;
  id: string;
  status: FamilyRecordStatus;
  taskResponses?: FamilyRecord["taskResponses"];
};

export interface FamilyRecordStore {
  readonly backend: "sqlite";
  delete(familyId: string, id: string): Promise<number>;
  list(familyId: string): Promise<FamilyRecord[]>;
  save(input: SaveFamilyRecordInput): Promise<FamilyRecord>;
  update(input: UpdateFamilyRecordInput): Promise<FamilyRecord | null>;
}

export class FamilyRecordStoreError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 500 | 503
  ) {
    super(message);
  }
}

export function createFamilyRecordStore(): FamilyRecordStore {
  return sqliteFamilyRecordStore;
}

const sqliteFamilyRecordStore: FamilyRecordStore = {
  backend: "sqlite",
  async list(familyId) {
    return listLiteFamilyRecords(familyId);
  },
  async save({ familyId, memberId, record }) {
    const allowedIds = new Set([
      ...readLiteAccounts().map((account) => account.memberId)
    ]);
    if ((record.assigneeMemberIds || []).some((id) => !allowedIds.has(id))) {
      throw new FamilyRecordStoreError("任务负责人不属于当前本地家庭。", 400);
    }
    return saveLiteFamilyRecord(familyId, memberId, record);
  },
  async update(input) {
    return updateLiteFamilyRecord(input);
  },
  async delete(familyId, id) {
    return deleteLiteFamilyRecord(familyId, id);
  }
};
