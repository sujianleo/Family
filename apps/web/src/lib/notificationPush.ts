export type NotificationPermissionState = "unsupported" | NotificationPermission;

export function describeNotificationStatus(input: {
  iosNeedsInstall: boolean;
  permission: NotificationPermissionState;
  publicKey: string;
  pushSupported: boolean;
  subscribed: boolean;
}) {
  if (!input.pushSupported || input.permission === "unsupported") {
    return { title: "当前浏览器不支持系统推送", description: "App 内通知弹窗仍可正常使用。" };
  }
  if (input.iosNeedsInstall) {
    return { title: "先添加到主屏幕", description: "iPhone/iPad 需要从主屏幕打开饭米粒后才能授权通知。" };
  }
  if (input.permission === "denied") {
    return { title: "系统通知权限已关闭", description: "请在浏览器或系统设置中允许饭米粒发送通知。" };
  }
  if (!input.publicKey && input.permission === "granted") {
    return { title: "系统通知已开启", description: "App 运行时会到点提醒；完全关闭后的后台推送尚未配置。" };
  }
  if (!input.publicKey) {
    return { title: "开启系统通知", description: "任务到点时发送系统通知；完全关闭后的后台推送尚未配置。" };
  }
  if (input.subscribed) {
    return { title: "系统通知已开启", description: "App 关闭时也能收到任务、群聊和到期提醒。" };
  }
  if (input.permission === "granted") {
    return { title: "系统通知已授权", description: "点击注册此设备，恢复后台通知投递。" };
  }
  return { title: "开启系统通知", description: "App 关闭时也能收到任务、群聊和到期提醒。" };
}
