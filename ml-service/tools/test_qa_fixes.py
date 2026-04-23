#!/usr/bin/env python3
"""
End-to-end QA tests for the two fixes:
  1. "ביצוע הפניית שיחות" no longer over-triggers on agent call transfers
  2. Strong churn signals beat negative closing pleasantries

Runs inside the ml-service Docker image (AlephBERT cached at /app/cache).
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, '/app')
sys.path.insert(0, '/app/src')

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')

from src.services.embedding_service import embedding_service
from src.services.embedding_classifier import create_embedding_classifier

GREEN = '\033[92m'; RED = '\033[91m'; YELLOW = '\033[93m'
DIM = '\033[2m'; BOLD = '\033[1m'; CYAN = '\033[96m'; RESET = '\033[0m'

# ---------------- Classification cases ----------------
# These are the QA summaries that WERE mis-classified as "ביצוע הפניית שיחות".
# After the description rewrite, they should NOT be classified as call-forwarding.
NEGATIVE_SUMMARIES = [
    ("QA1 - bezek referral",
     "הלקוח פנה לנציג שירות הלקוחות של פלאפון, אך לא הצליח לשמוע אותו היטב. "
     "הנציגה הציעה שהלקוח יתקשר לטלפון בזק כדי שישמעו טוב יותר. לאחר מכן, "
     "הנציגה הזדהתה בשם אסנת והלקוח מסר את מספר הטלפון שלו. הפתרון שניתן "
     "הוא שיחה חוזרת מהנציגה."),
    ("QA2 - disconnect internet packages",
     "הלקוח ביקש לנתק את חבילות האינטרנט של ילדיו בארבעת הקווים שלו, והנציג "
     "ביצע זאת. הוא גם הציע להקפיא את החבילות לשלושה חודשים אך ציין שניתן "
     "לחבר אותן מחדש בכל זמן. בנוסף, הנציג הסביר שהשיחות ימשיכו לעבוד גם "
     "אם האינטרנט מנותק."),
    ("QA3 - agent transferred to service",
     "הלקוח ביקש לבדוק חסימת מספרים עבור בנו, והנציג העביר אותו לזיהוי לקוח. "
     "לאחר מכן הועבר לשירות לקוחות כדי לטפל בניתוק של מספר."),
    ("QA4 - network reset troubleshooting",
     "הלקוח פנה לשירות הלקוחות של פלאפון כדי לפתור בעיה עם הטלפון שלו, "
     "שאינו מאפשר שימוש מחוץ לבית. הנציג איתי הציע לאפס את הגדרות הרשת "
     "הסלולרית דרך ההגדרות במכשיר האייפון או הגלקסי."),
    ("QA5 - plan update",
     "הנציג עדכן את חבילות הגלישה והשיחות של הלקוח לשני קווים, כולל עלויות "
     "ותאריכים. בנוסף, הנציג הציע לרכוש חבילת שיחות נוספת עבור אחד מהקווים."),
]

# Same "shouldn't match" principle but for טעינת כרטיס פריפייד over-fires
PREPAID_NEGATIVE_SUMMARIES = [
    ("QA6 - cheaper plan offer (should be מעבר תכנית)",
     "הלקוח רצה לדעת על חבילה זולה יותר, הנציג הציע מסלול לשנתיים ב-49.90 "
     "שח עם 800GB גלישה ודקות שיחה וסמס, או מסלול של 142 שח למנוי אחד עם "
     "500GB גלישה. הלקוח ביקש לעדכן את שני המנויים למסלולים החדשים. "
     "הנציג הבטיח לשלוח אישור במייל.",
     'מעבר תכנית/ מסלול'),
    ("QA7 - device settings (should be תפעול מכשיר)",
     "הלקוחה לא ניצלה את חבילת הגלישה שלה, והנציג הסביר לה כי הבעיה כנראה "
     "נובעת מהגדרות המכשיר ולא מחבילת הגלישה. הנציג הציע ללקוחה לבדוק "
     "בהגדרות המכשיר ולוודא שגיבוי הענן כבוי, וכן לוודא שכל הדפים מכובים.",
     'תפעול מכשיר כללי'),
    ("QA8 - switch to cheaper plan (should be מעבר תכנית)",
     "הלקוח מעוניין לעבור למסלול עליזה יותר, אך לא מרוצה מהחשבונות הגבוהים. "
     "הנציג מציע מסלול לשנתיים ב-45 שח לחודש עם 800 ג'יגה דאטה ו-3 חודשים "
     "נוספים של 2500 דקות שיחה וסמסים, אך הלקוח מעוניין במסלול זול יותר. "
     "הנציג מבטל את הסיסמה ומבטיח לעדכן את המסלול החדש לתוקף החל מ-12 בלילה.",
     'מעבר תכנית/ מסלול'),
]

# Genuine prepaid - must still match
PREPAID_POSITIVE_SUMMARIES = [
    ("TRUE PREPAID 1 - explicit top-up request",
     "הלקוח ביקש להטעין כרטיס פריפייד בסך 50 שקלים. הנציג העביר קוד טעינה."),
    ("TRUE PREPAID 2 - tokman code",
     "הלקוח רכש טוקמן וביקש עזרה בהטענת הכרטיס המקודד."),
]

# These should STILL match "ביצוע הפניית שיחות" — genuine customer requests.
POSITIVE_SUMMARIES = [
    ("TRUE POSITIVE 1 - explicit customer request",
     "הלקוח ביקש להגדיר הפניית שיחות אוטומטית במכשיר שלו למספר אחר כשהוא "
     "לא עונה או תפוס. הנציג הסביר על קוד *72 והדריך את הלקוח."),
    ("TRUE POSITIVE 2 - forwarding service setup",
     "הלקוח מבקש להפעיל שירות הפניית שיחות במכשיר לטלפון הקווי שלו."),
]

# ---------------- Churn end-to-end case ----------------
# This is QA case 4 from the user's report — churn came back 0 before the fix.
CHURN_TRANSCRIPT = (
    "נציג: שלום, איך אפשר לעזור?\n"
    "לקוח: קודם דיברתי עם נציג שלכם, השיחה התנתקה, הוא לא חוזר. "
    "אני כבר היה פנימי. זהו, שאני עובר לחברה אחרת וכבר נמאס לי מאה אחוז.\n"
    "נציג: אני מצטערת, אנסה לעזור. תודה רבה על הסבלנות, יום טוב."
)
CHURN_SUMMARY = (
    "הלקוח פנה לאחר שנותק משיחה קודמת. הוא הביע תסכול "
    "ואמר שהוא מעוניין לעבור לחברה אחרת."
)


async def main() -> int:
    print(f"\n{BOLD}{CYAN}=== Loading AlephBERT ==={RESET}")
    await embedding_service.initialize_model()
    print(f"{GREEN}model loaded{RESET}")

    clf = create_embedding_classifier(embedding_service)
    ok = await clf.initialize(
        classifications_path='/app/config/call-classifications.json',
        keywords_path='/app/config/classification-keywords.json',
    )
    if not ok:
        print(f"{RED}classifier init failed{RESET}")
        return 1

    passed = 0
    failed = 0

    # --- Test 1: call-forwarding negatives ---
    print(f"\n{BOLD}{CYAN}=== Test 1: 'ביצוע הפניית שיחות' should NOT over-trigger ==={RESET}\n")
    for name, text in NEGATIVE_SUMMARIES:
        results = await clf.classify_with_fallback(
            text=text, fallback_category='בירור כללי',
            top_k=2, threshold=0.35,
        )
        top_name = results[0].category_name if results else '<none>'
        top_conf = results[0].confidence if results else 0.0
        cf_in_top = any('הפניית שיחות' in r.category_name for r in results[:2])

        if cf_in_top:
            print(f"[{RED}FAIL{RESET}] {name}")
            failed += 1
        else:
            print(f"[{GREEN}PASS{RESET}] {name}")
            passed += 1
        print(f"       top: {top_name} ({top_conf:.3f})")
        if len(results) > 1:
            print(f"       #2:  {results[1].category_name} ({results[1].confidence:.3f})")
        print()

    # --- Test 2: call-forwarding positives (must still match) ---
    print(f"\n{BOLD}{CYAN}=== Test 2: genuine 'הפניית שיחות' requests must still match ==={RESET}\n")
    for name, text in POSITIVE_SUMMARIES:
        results = await clf.classify_with_fallback(
            text=text, fallback_category='בירור כללי',
            top_k=2, threshold=0.35,
        )
        top_name = results[0].category_name if results else '<none>'
        top_conf = results[0].confidence if results else 0.0
        cf_in_top = any('הפניית שיחות' in r.category_name for r in results[:2])

        if cf_in_top:
            print(f"[{GREEN}PASS{RESET}] {name}")
            passed += 1
        else:
            print(f"[{RED}FAIL{RESET}] {name}")
            failed += 1
        print(f"       top: {top_name} ({top_conf:.3f})")
        if len(results) > 1:
            print(f"       #2:  {results[1].category_name} ({results[1].confidence:.3f})")
        print()

    # --- Test 2b: prepaid false positives ---
    print(f"\n{BOLD}{CYAN}=== Test 2b: 'טעינת כרטיס פריפייד' should NOT over-trigger ==={RESET}\n")
    for name, text, expected in PREPAID_NEGATIVE_SUMMARIES:
        results = await clf.classify_with_fallback(
            text=text, fallback_category='בירור כללי',
            top_k=2, threshold=0.35,
        )
        top_name = results[0].category_name if results else '<none>'
        top_conf = results[0].confidence if results else 0.0
        prepaid_in_top = any('פריפייד' in r.category_name or 'גלובל סים' in r.category_name
                             for r in results[:2])
        expected_matches = (top_name == expected)

        # Must NOT be prepaid AND must match QA's expected category
        if not prepaid_in_top and expected_matches:
            status = f"{GREEN}PASS{RESET}"
            passed += 1
        else:
            status = f"{RED}FAIL{RESET}"
            failed += 1
        expected_marker = f"{GREEN}✓{RESET}" if expected_matches else f"{YELLOW}△{RESET}"
        print(f"[{status}] {name}")
        print(f"       top: {top_name} ({top_conf:.3f})  {expected_marker} expected: {expected}")
        if len(results) > 1:
            print(f"       #2:  {results[1].category_name} ({results[1].confidence:.3f})")
        print()

    # --- Test 2c: prepaid true positives (must still match) ---
    print(f"\n{BOLD}{CYAN}=== Test 2c: genuine prepaid requests must still match ==={RESET}\n")
    for name, text in PREPAID_POSITIVE_SUMMARIES:
        results = await clf.classify_with_fallback(
            text=text, fallback_category='בירור כללי',
            top_k=2, threshold=0.35,
        )
        top_name = results[0].category_name if results else '<none>'
        top_conf = results[0].confidence if results else 0.0
        prepaid_in_top = any('פריפייד' in r.category_name for r in results[:2])

        if prepaid_in_top:
            print(f"[{GREEN}PASS{RESET}] {name}")
            passed += 1
        else:
            print(f"[{RED}FAIL{RESET}] {name}")
            failed += 1
        print(f"       top: {top_name} ({top_conf:.3f})")
        print()

    # --- Test 3: churn end-to-end on both transcript and summary ---
    print(f"\n{BOLD}{CYAN}=== Test 3: QA case 4 churn detection (was 0 before fix) ==={RESET}\n")
    trans_churn = await clf.detect_churn(text=CHURN_TRANSCRIPT)
    summ_churn = await clf.detect_churn(text=CHURN_SUMMARY)
    max_score = max(trans_churn['churn_score'], summ_churn['churn_score'])
    max_is_churn = max_score >= 40

    print(f"{DIM}transcript:{RESET}")
    print(f"  score={trans_churn['churn_score']}  base(embedding)≈{trans_churn['raw_similarity']:.3f}  "
          f"keyword={trans_churn['keyword_match']} ({trans_churn['keyword_boost']:+d})  "
          f"dampening={trans_churn['resolution_dampening']}")
    print(f"{DIM}summary:{RESET}")
    print(f"  score={summ_churn['churn_score']}  base(embedding)≈{summ_churn['raw_similarity']:.3f}  "
          f"keyword={summ_churn['keyword_match']} ({summ_churn['keyword_boost']:+d})  "
          f"dampening={summ_churn['resolution_dampening']}")
    print(f"\nMAX(transcript, summary) = {max_score}  →  "
          f"{GREEN+'CHURN ✓'+RESET if max_is_churn else RED+'NOT CHURN ✗'+RESET}")

    if max_is_churn:
        passed += 1
        print(f"\n[{GREEN}PASS{RESET}] QA case 4 now flagged as churn")
    else:
        failed += 1
        print(f"\n[{RED}FAIL{RESET}] QA case 4 still not flagged")

    # --- Summary ---
    total = passed + failed
    color = GREEN if failed == 0 else RED
    print(f"\n{color}{BOLD}=== {passed}/{total} tests passed ==={RESET}\n")
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
