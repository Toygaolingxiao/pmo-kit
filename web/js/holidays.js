/**
 * 日本の祝日・会社休日計算モジュール
 * 内閣府「国民の祝日」および振替休日のルールに準拠して動的計算します。
 */

import { dayNumber, isoDate } from "./utils.js";

/**
 * 指定年の第 N 週 X 曜日の日付を算出します。
 */
function getNthWeekday(year, month, nth, weekday) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayOffset = (weekday - firstDay + 7) % 7;
  const day = 1 + dayOffset + (nth - 1) * 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 簡易天文学的計算による春分・秋分の日付
 */
function getVernalEquinox(year) {
  const day = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return `${year}-03-${String(day).padStart(2, "0")}`;
}

function getAutumnalEquinox(year) {
  const day = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return `${year}-09-${String(day).padStart(2, "0")}`;
}

/**
 * 指定年の国民の祝日一覧を生成します。
 */
export function getJapanHolidays(year) {
  const list = [
    { date: `${year}-01-01`, name: "元日", type: "national_holiday" },
    { date: getNthWeekday(year, 1, 2, 1), name: "成人の日", type: "national_holiday" },
    { date: `${year}-02-11`, name: "建国記念の日", type: "national_holiday" },
    { date: `${year}-02-23`, name: "天皇誕生日", type: "national_holiday" },
    { date: getVernalEquinox(year), name: "春分の日", type: "national_holiday" },
    { date: `${year}-04-29`, name: "昭和の日", type: "national_holiday" },
    { date: `${year}-05-03`, name: "憲法記念日", type: "national_holiday" },
    { date: `${year}-05-04`, name: "みどりの日", type: "national_holiday" },
    { date: `${year}-05-05`, name: "こどもの日", type: "national_holiday" },
    { date: getNthWeekday(year, 7, 3, 1), name: "海の日", type: "national_holiday" },
    { date: `${year}-08-11`, name: "山の日", type: "national_holiday" },
    { date: getNthWeekday(year, 9, 3, 1), name: "敬老の日", type: "national_holiday" },
    { date: getAutumnalEquinox(year), name: "秋分の日", type: "national_holiday" },
    { date: getNthWeekday(year, 10, 2, 1), name: "スポーツの日", type: "national_holiday" },
    { date: `${year}-11-03`, name: "文化の日", type: "national_holiday" },
    { date: `${year}-11-23`, name: "勤労感謝の日", type: "national_holiday" },
  ];

  // 振替休日（日曜日と重なった場合、翌月曜日が休み）
  const holidayDates = new Set(list.map((h) => h.date));
  const substitutes = [];

  list.forEach((item) => {
    const d = new Date(`${item.date}T00:00:00Z`);
    if (d.getUTCDay() === 0) {
      let subDayNum = dayNumber(item.date) + 1;
      let subDateStr = isoDate(subDayNum);
      while (holidayDates.has(subDateStr)) {
        subDayNum += 1;
        subDateStr = isoDate(subDayNum);
      }
      holidayDates.add(subDateStr);
      substitutes.push({
        date: subDateStr,
        name: `振替休日（${item.name}）`,
        type: "national_holiday",
      });
    }
  });

  return [...list, ...substitutes].sort((a, b) => a.date.localeCompare(b.date));
}
