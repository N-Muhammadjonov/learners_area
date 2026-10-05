import type { RiwiActor } from "@/lib/services/riwi/capabilities";
import { listSecuritySignals } from "@/lib/services/riwi/security-learning";

export async function OwnerSecurityLearning({ actor, locale }: { actor: RiwiActor; locale: "en" | "uz" }) {
  const signals = await listSecuritySignals(actor).catch(() => []);
  const total = signals.reduce((sum, signal) => sum + signal.count, 0);
  const pending = signals.filter((signal) => signal.state === "candidate" || signal.state === "in_review").length;
  const approved = signals.filter((signal) => signal.state === "approved_regression").length;
  const copy = locale === "uz" ? {
    title: "Xavfsizlik o'rganishi", intro: "Faqat tozalangan hujum tasnifi va hisoblari. Xom so'rovlar, audio va maxfiy kalitlar saqlanmaydi.",
    total: "Bloklangan urinishlar", pending: "Ko'rib chiqilmoqda", approved: "Tasdiqlangan regressiyalar", empty: "Hozircha xavfsizlik signali yo'q.",
    type: "Turi", count: "Soni", lastSeen: "Oxirgi kuzatuv", status: "Holat",
  } : {
    title: "Security learning", intro: "Sanitized attack classifications and counts only. Raw prompts, audio and secrets are not retained.",
    total: "Blocked attempts", pending: "Awaiting review", approved: "Approved regressions", empty: "No security signals recorded yet.",
    type: "Type", count: "Count", lastSeen: "Last seen", status: "Status",
  };
  return <section className="card flex flex-col gap-4 p-5" aria-labelledby="riwi-security-learning-title">
    <div><h2 id="riwi-security-learning-title" className="font-display text-xl text-ink-900">{copy.title}</h2><p className="mt-1 text-sm text-ink-500">{copy.intro}</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label={copy.total} value={total} /><Metric label={copy.pending} value={pending} /><Metric label={copy.approved} value={approved} />
    </div>
    {signals.length === 0 ? <p className="text-sm text-ink-500">{copy.empty}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr className="text-ink-500"><th className="py-2 pr-3">{copy.type}</th><th className="py-2 pr-3">{copy.count}</th><th className="py-2 pr-3">{copy.lastSeen}</th><th className="py-2">{copy.status}</th></tr></thead>
      <tbody>{signals.map((signal) => <tr key={signal.id} className="border-t border-ink-100"><td className="py-2 pr-3 text-ink-800">{signal.type.replaceAll("_", " ")}</td><td className="py-2 pr-3 text-ink-700">{signal.count}</td><td className="py-2 pr-3 text-ink-500">{signal.lastSeenAt.toISOString()}</td><td className="py-2 text-ink-700">{signal.state.replaceAll("_", " ")}</td></tr>)}</tbody>
    </table></div>}
  </section>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-paper-sunken p-3"><div className="text-xs text-ink-500">{label}</div><div className="mt-1 text-xl font-semibold text-ink-900">{value}</div></div>; }
