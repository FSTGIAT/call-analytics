#!/usr/bin/env python3
"""
Unit tests for churn keyword precedence fix.

Verifies that STRONG churn signals ("עובר לחברה אחרת") beat
NEGATIVE closing pleasantries ("תודה רבה", "הכל בסדר").
"""

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ML_SERVICE_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(ML_SERVICE_DIR))

from src.services.embedding_classifier import EmbeddingClassifier


GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
DIM = '\033[2m'
BOLD = '\033[1m'
RESET = '\033[0m'


def load_classifier() -> EmbeddingClassifier:
    keywords_path = ML_SERVICE_DIR / 'config' / 'classification-keywords.json'
    with open(keywords_path, 'r', encoding='utf-8') as f:
        kdata = json.load(f)

    clf = EmbeddingClassifier(embedding_service=None)
    ck = kdata.get('churn_keywords', {})
    clf.churn_keywords = {
        'strong': ck.get('strong', []),
        'medium': ck.get('medium', []),
        'weak': ck.get('weak', []),
        'negative': ck.get('negative', []),
    }
    clf.churn_scoring.update(kdata.get('churn_scoring', {}))
    return clf


CASES = [
    # (name, text, expected_level, expected_boost_sign)
    (
        "QA case 4: explicit churn + polite closing",
        "קודם דיברתי עם נציג שלכם הפתיחה התנתקה הוא לא חוזר "
        "אני כבר היה פנימי זהו שאני עובר לחברה אחרת וכבר נמאס לי מאה אחוז. "
        "הנציג: תודה רבה על הפנייה, יום טוב.",
        'strong', 'positive',
    ),
    (
        "Strong alone",
        "הלקוח רוצה לעזוב ולעבור לגולן",
        'strong', 'positive',
    ),
    (
        "Strong + agent closing 'הכל בסדר'",
        "הלקוח אמר שהוא עובר לחברה אחרת. הנציג הודה, הכל בסדר, יום טוב.",
        'strong', 'positive',
    ),
    (
        "Customer joining Pelephone (true negative)",
        "הלקוח מעוניין לעבור לפלאפון מסלקום",
        'negative', 'negative',
    ),
    (
        "Happy customer - resolved",
        "הלקוח שבע רצון, הבעיה נפתרה, תודה רבה",
        'negative', 'negative',
    ),
    (
        "Only weak dissatisfaction",
        "הלקוח לא מרוצה מהמחיר אבל לא אמר שהוא עוזב",
        'weak', 'positive',
    ),
    (
        "Medium needs 2 matches (single match → weak)",
        "הלקוח אמר שהמחיר יקר מדי",
        'weak', 'positive',
    ),
    (
        "Medium with 2 matches",
        "הלקוח מתלונן שיקר מדי ושהוא משלם יותר מדי",
        'medium', 'positive',
    ),
    (
        "Neutral / unrelated",
        "הלקוח ביקש פירוט חשבונית והנציגה שלחה לו למייל",
        'none', 'zero',
    ),
]


def sign(boost: float) -> str:
    if boost > 0:
        return 'positive'
    if boost < 0:
        return 'negative'
    return 'zero'


def run() -> int:
    clf = load_classifier()
    print(f"\n{BOLD}Churn Keyword Precedence Tests{RESET}")
    print(f"{DIM}Loaded {sum(len(v) for v in clf.churn_keywords.values())} keywords "
          f"(strong={len(clf.churn_keywords['strong'])}, "
          f"medium={len(clf.churn_keywords['medium'])}, "
          f"weak={len(clf.churn_keywords['weak'])}, "
          f"negative={len(clf.churn_keywords['negative'])}){RESET}\n")
    print(f"{DIM}Scoring: {clf.churn_scoring}{RESET}\n")

    passed = 0
    failed = 0

    for name, text, expected_level, expected_sign in CASES:
        boost, level = clf._calculate_churn_keyword_boost(text)
        actual_sign = sign(boost)
        ok = level == expected_level and actual_sign == expected_sign

        marker = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        print(f"[{marker}] {name}")
        print(f"       expected: level={expected_level}, boost_sign={expected_sign}")
        print(f"       actual:   level={level}, boost={boost:+.0f} ({actual_sign})")
        snippet = text if len(text) <= 90 else text[:87] + '...'
        print(f"       {DIM}text: {snippet}{RESET}\n")

        if ok:
            passed += 1
        else:
            failed += 1

    total = passed + failed
    color = GREEN if failed == 0 else RED
    print(f"{color}{BOLD}Result: {passed}/{total} passed{RESET}\n")
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(run())
