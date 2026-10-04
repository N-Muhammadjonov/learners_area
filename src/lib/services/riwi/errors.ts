import type { Locale } from "@/lib/i18n";

export const RIWI_ERROR_CODES = [
  "riwi_not_enabled", "riwi_permission_denied", "riwi_scope_denied", "riwi_tool_not_found",
  "riwi_tool_invalid_input", "riwi_tool_timeout", "riwi_tool_failed", "riwi_provider_unavailable",
  "riwi_provider_timeout", "riwi_provider_invalid_response", "riwi_external_required",
  "riwi_dictionary_unresolved", "riwi_dictionary_locked", "riwi_knowledge_unavailable",
  "riwi_knowledge_conflict", "riwi_action_confirmation_required", "riwi_action_stale",
  "riwi_rate_limited", "riwi_request_invalid", "riwi_exam_help_locked", "riwi_security_denial",
] as const;
export type RiwiErrorCode = (typeof RIWI_ERROR_CODES)[number];

const MESSAGES: Record<Locale, Record<RiwiErrorCode, string>> = {
  en: {
    riwi_not_enabled: "RIWI is not available for this account right now.",
    riwi_permission_denied: "You are not allowed to use that RIWI capability.",
    riwi_scope_denied: "That information is outside your permitted scope.",
    riwi_tool_not_found: "RIWI could not match that request to an available action.",
    riwi_tool_invalid_input: "Please check the request and try again.",
    riwi_tool_timeout: "That request took too long. Please try again.",
    riwi_tool_failed: "RIWI could not complete that request safely.",
    riwi_provider_unavailable: "External AI is not available; no external result was produced.",
    riwi_provider_timeout: "The external provider did not respond in time.",
    riwi_provider_invalid_response: "The provider response could not be verified.",
    riwi_external_required: "This task needs a configured external provider; no result was invented.",
    riwi_dictionary_unresolved: "The centre dictionary does not have enough verified information for this term.",
    riwi_dictionary_locked: "Dictionary help is unavailable while this exam is in progress.",
    riwi_knowledge_unavailable: "Approved learning material is not available for that request.",
    riwi_knowledge_conflict: "The available sources conflict, so RIWI cannot give a certain answer.",
    riwi_action_confirmation_required: "Review the exact action and confirm it before it can be completed.",
    riwi_action_stale: "The target or permission changed. Review the request again.",
    riwi_rate_limited: "Too many requests. Wait a moment and try again.",
    riwi_request_invalid: "Please enter a valid request and try again.",
    riwi_exam_help_locked: "RIWI help is paused while a timed Reading or Listening attempt is in progress.",
    riwi_security_denial: "I can’t access credentials, run arbitrary commands, or reveal another learner’s private data.",
  },
  uz: {
    riwi_not_enabled: "Hozir RIWI bu akkaunt uchun mavjud emas.",
    riwi_permission_denied: "Sizda bu RIWI imkoniyatidan foydalanish huquqi yo'q.",
    riwi_scope_denied: "Bu ma'lumot sizga ruxsat berilgan doiraga kirmaydi.",
    riwi_tool_not_found: "RIWI bu so'rovga mos ruxsat etilgan amalni topa olmadi.",
    riwi_tool_invalid_input: "So'rovni tekshirib, qayta urinib ko'ring.",
    riwi_tool_timeout: "So'rov juda uzoq davom etdi. Qayta urinib ko'ring.",
    riwi_tool_failed: "RIWI bu so'rovni xavfsiz yakunlay olmadi.",
    riwi_provider_unavailable: "Tashqi AI hozir mavjud emas; tashqi natija olinmadi.",
    riwi_provider_timeout: "Tashqi provayder vaqtida javob bermadi.",
    riwi_provider_invalid_response: "Provayder javobini tekshirib bo'lmadi.",
    riwi_external_required: "Bu vazifa sozlangan tashqi provayderni talab qiladi; natija to'qib chiqarilmadi.",
    riwi_dictionary_unresolved: "Markaz lug'atida bu so'z uchun yetarli tekshirilgan ma'lumot yo'q.",
    riwi_dictionary_locked: "Imtihon davomida lug'at yordami mavjud emas.",
    riwi_knowledge_unavailable: "Bu so'rov uchun tasdiqlangan o'quv materiali mavjud emas.",
    riwi_knowledge_conflict: "Manbalar o'zaro zid; RIWI aniq javob bera olmaydi.",
    riwi_action_confirmation_required: "Amalni bajarishdan oldin uning tafsilotlarini tekshirib tasdiqlang.",
    riwi_action_stale: "Nishon yoki ruxsat o'zgardi. So'rovni qayta tekshiring.",
    riwi_rate_limited: "So'rovlar juda ko'p. Biroz kutib, yana urinib ko'ring.",
    riwi_request_invalid: "Yaroqli so'rov kiriting va qayta urinib ko'ring.",
    riwi_exam_help_locked: "Vaqtli Reading yoki Listening urinishlari davomida RIWI yordami to'xtatiladi.",
    riwi_security_denial: "Men maxfiy kalitlarga kira olmayman, ixtiyoriy buyruqlarni bajara olmayman yoki boshqa o'quvchining shaxsiy ma'lumotlarini ko'rsata olmayman.",
  },
};

export function riwiErrorMessage(code: RiwiErrorCode, locale: Locale): string {
  return MESSAGES[locale][code];
}
