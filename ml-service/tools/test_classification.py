"""
Test classification tool - runs sample summaries through AlephBERT embedding classifier.
Usage:
  python tools/test_classification.py
  docker run --rm pelephone/call-analytic/ml-service:latest python /app/tools/test_classification.py
"""

import asyncio
import json
import os
import sys
import numpy as np
from datetime import datetime

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.services.embedding_service import EmbeddingService
from src.services.embedding_classifier import EmbeddingClassifier


# Sample summaries from production QA failures
TEST_CASES = [
    {
        "summary": "הלקוחה התלוננה על כך שנגמרה לה חבילת הגלישה, למרות שהיא משתמשת בראוטר של פלאפון כבר שנה. נציג השירות הסביר כי הראוטר יכול לצרוך ג'יגה בייטים רבים, וכי ייתכן והשימוש גדל בגלל המלחמה שגרמה לטלוויזיה להיות דלוקה יותר מהרגיל. הנציג הציע להגדיל את חבילת הגלישה, אך הלקוחה טענה שכבר הגדילה אותה לפני כמה ימים.",
        "expected": "בירור פרטי תכנית / תקלת גלישה בארץ"
    },
    {
        "summary": "הלקוחה פנתה לשירות הלקוחות של חברת פלאפון בטענה שהם ניתקו אותה למרות שלא עשתה זאת. היא ביקשה לבדוק מדוע המספר שלה עדיין מופיע כפעיל, והנציג הסביר שמספר אפס חמש שתיים שלוש שתיים שתיים אפס שבע תשע ארבע הוא קו פעיל ולא מנותק.",
        "expected": "בירור מצב חשבון"
    },
    {
        "summary": "הלקוחה פנתה בנוגע למספר טלפון 4567, שנגמרו בו הדקות. הנציג בדק ומצא שהיא קיבלה דקות לחודש החודש, אך ניצלה את כולן. היא קיבלה אלפיים מאתיים ומשהו דקות, והנציג הציע להוסיף חמש מאות דקות בתשלום של 19.90 שח.",
        "expected": "בירור פרטי תכנית / מעבר תכנית"
    },
    {
        "summary": "הלקוח עבר לפלאפון, אך לא קיבל קליטה באזור קריית ארבע. הנציג ביצע פעולה לשינוי הגדרות הקו והסביר כי הקליטה תלויה בתשתית האזורית. הלקוח ביקש סיוע בהגדרת קבלת הודעות סמס מהאפליקציה של אפל, אך הנציג הסביר שזה לא קשור לסמסים רגילים.",
        "expected": "תקלת קליטה / תפעול מכשיר כללי"
    },
    {
        "summary": "הלקוחה פנתה לשירות הלקוחות של חברת פלאפון כדי לבדוק את מצב חבילת הגלישה שלה בחול. הנציג הסביר שהחבילה מיועדת למדינות מסוימות, אך לא נפתחה אוטומטית עקב הסכמים בישראל. לאחר ביצוע מספר פעולות, החבילה הופעלה והלקוחה קיבלה הדרכה כיצד להפעיל את נדידת הנתונים במכשיר שלה.",
        "expected": "חבילת חול / תפעול מכשיר כללי"
    },
    {
        "summary": "הלקוח פנה לגבי מספר טלפון ברכב שלא עובד עם GPS כבר כמה חודשים. הנציג בדק את תעודת הזהות והמספר, אך הבין שהבעיה היא במספר הטלפון הספציפי לרכב. הלקוח אישר שזה תמיד עבד בעבר. הנציג העביר אותו לתמיכה טכנית כדי לבדוק לעומק.",
        "expected": "תפעול מכשיר כללי"
    },
    {
        "summary": "הלקוחה פנתה לשירות הלקוחות של חברת פלאפון כדי לפתור בעיה בקו הטלפון של אישתו, אשר לא הצליחה להוציא או לקבל שיחות באופן תקין. הנציג הציע לבדוק את הגדרות המכשיר (אייפון) ולבצע איפוס רשת. הלקוחה ציינה כי עשו זאת בעבר ללא הצלחה, והנציג הסכים שהבעיה כנראה במכשיר עצמו.",
        "expected": "תקלת שיחות בארץ / תפעול מכשיר כללי"
    },
    {
        "summary": "הלקוח לא קיבל מכתב, אך הובטח לו שיטופל. הנציג הציע פתרון לבעיית השיחות הממתינות באייפון 17 פרו מקס של הלקוח, והסביר כיצד לפתור את הבעיה בהגדרות הטלפון. אם לא יסתדר, הנציג הבטיח לעשות רענון ולבדוק שוב לאחר חצי שעה.",
        "expected": "תפעול מכשיר כללי"
    },
    {
        "summary": "הלקוח מתלונן על קליטת אינטרנט חלשה בבית, וטוען שדיבר עם נציג שירות מספר פעמים ללא פתרון. הנציג בודק את מיקום הבית במושב מבצעים וממליץ על רענון או איפוס מלא של הראוטר.",
        "expected": "תקלת גלישה בארץ / תקלת קליטה"
    },
    {
        "summary": "הלקוח ביקש לשלוח לו קוד QR כדי להעביר את הטלפון שלו עם סים חדש. הנציגה ביקשה מספר תעודת זהות, ארבע ספרות אחרונות של אמצעי תשלום ותמונה של תעודת הזהות.",
        "expected": "ESIM בארץ / החלפת סים"
    },
    {
        "summary": "הלקוח מתלונן על בעיות קליטה באזור מגוריו, הנציג מאשר שיש בעיית כיסוי ומציע לעדכן תאריכים בהם הקליטה הייתה טובה יותר. הבעיה לא נפתרה והנציג מבטיח לבדוק את הנושא ולעדכן את הלקוח מחר.",
        "expected": "תקלת קליטה"
    },
    {
        "summary": "אני מתקשרת מחברת פלאפון כי ראינו שהתעניינת אצלנו. יש לנו הצעה מיוחדת לחבילה עם גלישה ללא הגבלה.",
        "expected": "שיחת שיווק/הצעה"
    },
    {
        "summary": "הלקוחה קיבלה חשבון פלאפון גבוה מהצפוי, בגלל חיוב על שיחות שביצעה בזמן שהייתה בחול. היא מבקשת לבדוק את הנושא ולקבל החזר כספי.",
        "expected": "הסבר חשבונית או חיוב"
    },
    {
        "summary": "הלקוחה פלאפון מבקשת לשלוח לה חשבוניות אחרונות כדי לנייד קו נוסף לחברת הוט מובייל",
        "expected": "שליחת העתקי חשבונית / ניוד קו"
    },
]


async def run_test():
    print("=" * 80)
    print("  AlephBERT Classification Test Tool")
    print("=" * 80)

    # Initialize embedding service
    print("\n[1/3] Loading AlephBERT model...")
    embedding_svc = EmbeddingService()
    await embedding_svc.initialize_model()
    print(f"  Model loaded: {embedding_svc.config.model_name}")

    # Initialize classifier
    print("[2/3] Loading classifications and keywords...")
    classifier = EmbeddingClassifier(embedding_svc)

    config_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config')
    classifications_path = os.path.join(config_dir, 'call-classifications.json')
    keywords_path = os.path.join(config_dir, 'classification-keywords.json')

    success = await classifier.initialize(classifications_path, keywords_path)
    if not success:
        print("  FAILED to initialize classifier!")
        return

    print(f"  Loaded {len(classifier.categories)} categories, {len(classifier.keywords)} keyword sets")
    print(f"  Threshold: {classifier.default_threshold}, Gap: {os.getenv('CLASSIFICATION_MIN_GAP', '0.08')}")

    # Run tests
    print(f"\n[3/3] Running {len(TEST_CASES)} test cases...\n")
    print("-" * 80)

    correct = 0
    total = len(TEST_CASES)

    for i, test in enumerate(TEST_CASES, 1):
        summary = test['summary']
        expected = test['expected']

        # Classify
        results = await classifier.classify(summary, top_k=5, threshold=0.30)

        # Churn
        churn = await classifier.detect_churn(summary)

        # Top result
        top1 = results[0] if results else None
        top2 = results[1] if len(results) > 1 else None

        # Gap check
        gap = (top1.confidence - top2.confidence) if (top1 and top2) else 999
        gap_pass = gap <= 0.08

        print(f"Test {i}/{total}")
        print(f"  Summary: {summary[:80]}...")
        print(f"  Expected: {expected}")
        print()

        # Show top 5 scores
        for j, r in enumerate(results[:5]):
            marker = ">>>" if j == 0 else ("  >" if j == 1 and gap_pass else "   ")
            boost_str = f" +kw={r.keyword_boost:.2f}" if r.keyword_boost > 0 else ""
            print(f"  {marker} [{r.confidence:.4f}{boost_str}] {r.category_name}")

        if top2 and not gap_pass:
            print(f"  --- 2nd dropped (gap={gap:.4f} > 0.08) ---")

        # Churn info
        churn_icon = "🚨" if churn['is_churn'] else "✅"
        print(f"\n  Churn: {churn_icon} score={churn['churn_score']}, "
              f"raw_sim={churn['raw_similarity']:.3f}, "
              f"keyword={churn['keyword_match']}({churn['keyword_boost']}), "
              f"resolution={churn.get('resolution_dampening', 0)}")

        # Final classification output
        final_cats = [top1.category_name] if top1 else []
        if top2 and gap_pass:
            final_cats.append(top2.category_name)

        print(f"\n  FINAL: {' / '.join(final_cats)}")
        print("-" * 80)

    # Summary stats
    stats = classifier.get_stats()
    print(f"\nStats: {stats['classifications_performed']} classifications, "
          f"avg {stats['avg_classification_time_ms']:.1f}ms, "
          f"{stats['keyword_boosts_applied']} keyword boosts applied")


if __name__ == '__main__':
    asyncio.run(run_test())
