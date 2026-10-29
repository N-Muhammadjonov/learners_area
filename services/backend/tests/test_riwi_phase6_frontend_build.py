from __future__ import annotations

from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_DIR = REPO_ROOT / "frontend" / "vanilla"


class RiwiPhase6FrontendBuildTest(unittest.TestCase):
    def test_frontend_modules_exist_and_expose_routes(self) -> None:
        required_files = [
            FRONTEND_DIR / "js" / "i18n" / "riwi_i18n.js",
            FRONTEND_DIR / "js" / "adapters" / "riwi.js",
            FRONTEND_DIR / "modules" / "riwi" / "index.js",
            FRONTEND_DIR / "modules" / "riwi" / "objective-explanation.js",
            FRONTEND_DIR / "modules" / "staff-final30" / "owner-riwi.js",
            FRONTEND_DIR / "css" / "riwi.css",
        ]
        for f in required_files:
            self.assertTrue(f.exists(), f"Missing frontend file {f}")

        workspace_js = (FRONTEND_DIR / "modules" / "riwi" / "index.js").read_text(encoding="utf-8")
        owner_js = (FRONTEND_DIR / "modules" / "staff-final30" / "owner-riwi.js").read_text(encoding="utf-8")
        self.assertIn('"/app/riwi"', workspace_js)
        self.assertIn('"/app/owner/riwi"', owner_js)
        self.assertIn("escapeHtml", workspace_js)

    def test_en_and_uz_i18n_keys_have_exact_parity(self) -> None:
        i18n_text = (FRONTEND_DIR / "js" / "i18n" / "riwi_i18n.js").read_text(encoding="utf-8")
        en_block = i18n_text.split("en: {")[1].split("},")[0]
        uz_block = i18n_text.split("uz: {")[1].split("}")[0]
        en_keys = set(re.findall(r'"(riwi\.[^"]+)"\s*:', en_block))
        uz_keys = set(re.findall(r'"(riwi\.[^"]+)"\s*:', uz_block))
        self.assertGreaterEqual(len(en_keys), 25)
        self.assertEqual(en_keys, uz_keys)

    def test_day_and_night_theme_tokens_and_responsive_layout_present(self) -> None:
        css_text = (FRONTEND_DIR / "css" / "riwi.css").read_text(encoding="utf-8")
        self.assertIn('[data-theme="day"]', css_text)
        self.assertIn('[data-theme="night"]', css_text)
        self.assertIn("@media (max-width: 768px)", css_text)


if __name__ == "__main__":
    unittest.main()
