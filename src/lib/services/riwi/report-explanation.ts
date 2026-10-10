import "server-only";
import { formatMetricValue, type ReportMetric } from "@/lib/reporter/snapshot";

/** Called only after the gateway binds all metrics to canonical Reporter specs.
 * No model, arithmetic, comparison estimate or new source query is involved. */
export function explainReportMetric(metric: ReportMetric, language: "uz" | "en"): string {
  const uz = language === "uz";
  const value = metric.value === null ? (uz ? "Mavjud emas" : "Unavailable") : formatMetricValue(metric);
  const meaning = metric.unit === "count"
    ? (uz ? "Qamrovdagi qaydlar soni. Bu mahorat o'lchovi emas." : "A count of records in this scope. It is not a measure of mastery.")
    : metric.unit === "ratio"
      ? (uz ? "Qayd etilgan tekshirilgan natijalar ulushi, foiz ko'rinishida." : "The recorded checked-result proportion, displayed as a percentage.")
      : metric.unit === "band"
        ? (uz ? "Qayd etilgan tekshirilgan baholarning o'rtacha bali." : "The average band of recorded checked evaluations.")
        : (uz ? "Qayd etilgan natijalarning o'rtacha qiymati." : "The average of recorded results.");
  const basis = metric.window.basis === "as_of_end"
    ? (uz ? "Davr oxiridagi holat." : "A snapshot at the end of the period.")
    : (uz ? "Faqat ko'rsatilgan davr ichidagi qaydlar." : "Records within the stated period only.");
  return `${metric.label[language]}: ${value}\n${meaning} ${basis}`;
}

export function reportExplanationBoundary(language: "uz" | "en"): [string, string] {
  return language === "uz" ? [
    "O'zgarish: bu hisobotda oldingi davr bilan taqqoslash yo'q. O'sish yoki pasayishni tasdiqlab bo'lmaydi.",
    "Keyingi amal: o'z qamrovingizdagi yakunlangan ishni ko'rib chiqing va dalil bilan ko'rsatilgan bitta tuzatishni mashq qiling.",
  ] : [
    "Change: this report has no comparison with an earlier period. Improvement or decline cannot be confirmed.",
    "Next action: review completed work within your scope and practise one correction supported by that work.",
  ];
}
