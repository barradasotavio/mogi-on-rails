/** 4 s, plus 1 s for every 40 characters past 40, at most 8 s. */
export function toastDuration(message: string) {
  return Math.min(8000, 4000 + Math.ceil(Math.max(0, message.length - 40) / 40) * 1000);
}
