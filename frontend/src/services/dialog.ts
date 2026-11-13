import { ElMessageBox } from "element-plus";
export async function confirmAction(
  message: string,
  title = "操作确认",
): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
      closeOnClickModal: false,
    });
    return true;
  } catch {
    return false;
  }
}
export async function promptValue(
  message: string,
  title = "选择本地版本",
): Promise<string | null> {
  try {
    const result = await ElMessageBox.prompt(message, title, {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputPlaceholder: "请输入版本编号",
      inputPattern: /^[1-9]\d*$/,
      inputErrorMessage: "请输入有效编号",
      closeOnClickModal: false,
      customClass: "music-version-prompt",
    });
    return result.value;
  } catch {
    return null;
  }
}
