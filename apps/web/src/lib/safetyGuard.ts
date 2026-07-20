export type DangerousOperationMatch = {
  reason: string;
  riskLevel: "high";
};

const destructiveTargets = /(所有数据|全部数据|全量数据|所有记录|全部记录|家庭记录|记录|所有资料|全部资料|资料库|资料|数据库|家庭|成员|家庭成员|任务|群聊|画像|meta|缓存|本地数据)/;
const destructiveVerbs = /(删除|删掉|删光|清空|清除|抹掉|重置|恢复出厂|销毁|擦除|格式化|drop|truncate|delete|reset|wipe)/i;

export function detectDangerousOperation(text: string): DangerousOperationMatch | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  if (destructiveVerbs.test(normalized) && destructiveTargets.test(normalized)) {
    return {
      reason: "命中批量删除、清空或重置家庭数据的高危意图。",
      riskLevel: "high"
    };
  }

  return null;
}
