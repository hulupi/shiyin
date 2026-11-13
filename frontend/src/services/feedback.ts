import { ElMessage } from "element-plus";
export function notify(message: string) {
  ElMessage.success({
    message,
    grouping: true,
    duration: 3000,
    showClose: true,
  });
}
export function reportError(error: unknown) {
  ElMessage.error({
    message: error instanceof Error ? error.message : String(error),
    grouping: true,
    showClose: true,
  });
}
export function inform(message: string) {
  ElMessage.info({ message, grouping: true, showClose: true });
}
