import { useSyncExternalStore } from "react";

// 설정의 "화면 효과" 스위치. 끄면 후처리와 덧씌움 없이 그린다.
const KEY = "feign:fx";
const listen = (f: () => void) => {
  addEventListener("feign:fx", f);
  return () => removeEventListener("feign:fx", f);
};
const read = () => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
};
export const useFx = () => useSyncExternalStore(listen, read, () => true);
export function setFx(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  dispatchEvent(new Event("feign:fx"));
}
