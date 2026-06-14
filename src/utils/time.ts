import type { Language } from '../i18n';

const timeStrings = {
  zh: {
    justNow: '刚刚',
    minutes: (n: number) => `${n}分钟`,
    hours: (n: number) => `${n}小时`,
    days: (n: number) => `${n}天`,
  },
  en: {
    justNow: 'just now',
    minutes: (n: number) => `${n}m`,
    hours: (n: number) => `${n}h`,
    days: (n: number) => `${n}d`,
  },
};

export function formatRelativeTime(timestamp: number, lang: Language = 'zh'): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const s = timeStrings[lang];

  if (seconds < 60) {
    return s.justNow;
  } else if (minutes < 60) {
    return s.minutes(minutes);
  } else if (hours < 24) {
    return s.hours(hours);
  } else {
    return s.days(days);
  }
}
