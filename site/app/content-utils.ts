export type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

// Public publication dates follow the site's calendar, regardless of Worker or visitor timezone.
const publicationTimeZone = "Asia/Shanghai";

const longDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: publicationTimeZone,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: publicationTimeZone,
  year: "numeric",
  month: "short",
  day: "numeric",
});

const monthDayFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: publicationTimeZone,
  month: "2-digit",
  day: "2-digit",
});

const yearFormatter = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: publicationTimeZone });

export function formatPublicationYear(value: string | null | undefined, fallback = "未定") {
  return value ? yearFormatter.format(new Date(value)) : fallback;
}

/** Reuse formatters: constructing Intl.DateTimeFormat repeatedly is relatively expensive. */
export function formatLongDate(value: string | null | undefined, fallback = "") {
  return value ? longDateFormatter.format(new Date(value)) : fallback;
}

export function formatShortDate(value: string | null | undefined, fallback = "") {
  return value ? shortDateFormatter.format(new Date(value)) : fallback;
}

export function formatMonthDay(value: string | null | undefined, fallback = "—") {
  return value ? monthDayFormatter.format(new Date(value)) : fallback;
}

export function estimateReadingMinutes(markdown: string) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\[\]()!-]/g, " ")
    .replace(/\s+/g, "");
  return Math.max(1, Math.ceil(text.length / 350));
}

export function estimateReadingMinutesFromLength(length: number) {
  return Math.max(1, Math.ceil(Math.max(0, length) / 350));
}

export function avatarSource(url: string, renderedSize: "small" | "portrait") {
  if (url !== "/images/xingyu-avatar.jpg") return url;
  return renderedSize === "small"
    ? "/images/xingyu-avatar-64.webp"
    : "/images/xingyu-avatar-192.webp";
}

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
