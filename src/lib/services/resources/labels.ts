import type { Dictionary } from "@/lib/i18n/en";
import type { ResourceOwnerType } from "@/lib/services/resources/owners";

/**
 * The eight content kinds, named once, in the order an administrator thinks about
 * them. The key is the same string `resource_blocks.owner_type` stores — there is
 * no second naming scheme to keep in sync, and a ninth kind would be one entry
 * here plus one in the registry.
 *
 * It lives in `lib`, not in a page file: a page may only export the things Next.js
 * knows about, and a label map is not one of them.
 */
export function kindLabel(dict: Dictionary, type: ResourceOwnerType): string {
  switch (type) {
    case "lesson":
      return dict.admin.materialsKindLesson;
    case "reading":
      return dict.admin.materialsKindReading;
    case "listening":
      return dict.admin.materialsKindListening;
    case "writing":
      return dict.admin.materialsKindWriting;
    case "speaking":
      return dict.admin.materialsKindSpeaking;
    case "grammar":
      return dict.admin.materialsKindGrammar;
    case "assignment":
      return dict.admin.materialsKindAssignment;
    case "live_class":
      return dict.admin.materialsKindLiveClass;
  }
}
