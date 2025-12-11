"""
Call Direction Detection for DictaLM Prompts

This module provides lightweight call direction detection to add context to DictaLM prompts.
Keyword-based classification filtering has been REMOVED - we now trust DictaLM's Hebrew
understanding to handle all 69 classifications directly.

Philosophy: DictaLM was trained on 200B Hebrew tokens and understands context better
than rule-based keyword matching. The model can distinguish between:
- "עזבתי" (past tense - customer already left)
- "אני עוזב" (present tense - customer wants to leave now)

This nuance is better handled by the LLM than by keyword matching.
"""

import logging

logger = logging.getLogger(__name__)


def detect_call_direction(conversation_text: str) -> str:
    """
    Detect if the call was agent-initiated (outbound) or customer-initiated (inbound).
    Also detects winback calls (agent calling customer who already left).

    Args:
        conversation_text: The Hebrew conversation text

    Returns:
        "outbound_marketing" - agent initiated to offer something
        "winback" - agent calling customer who already left
        "inbound_service" - customer initiated
        "unknown" - unclear
    """
    if not conversation_text:
        return "unknown"

    # Normalize text
    normalized_text = conversation_text.lower()

    # Winback indicators (agent calling customer who left)
    winback_phrases = [
        "אני רואה שעברת", "עזבת אותנו", "היית לקוח",
        "לחזור לפלאפון", "להחזיר אותך", "מה הסיבה שעזבת",
        "עברת לחברה אחרת", "לקוח לשעבר", "חזרת מהחברה",
        "ניתקת את הקו", "סגרת את הקו לפני"
    ]

    # Agent-initiated marketing indicators
    agent_initiated_phrases = [
        "מתקשרת אליך", "מתקשר אליך",
        "אני מפלאפון", "מחברת פלאפון",
        "רציתי להציע", "יש לנו הצעה",
        "הצעה מיוחדת", "מבצע חדש",
        "להציע לך", "רציתי לעדכן"
    ]

    # Customer-initiated service indicators
    customer_initiated_phrases = [
        "אני רוצה לברר", "אני צריך עזרה",
        "יש לי בעיה", "יש לי תקלה",
        "לא עובד לי", "אני רוצה לבטל",
        "אני רוצה לקנות", "אני רוצה להזמין",
        "כמה אני משלם", "למה חייבתם"
    ]

    # Check for winback first (specific type of outbound)
    winback_score = sum(1 for phrase in winback_phrases if phrase in normalized_text)
    if winback_score >= 1:
        logger.debug(f"Detected winback call (score: {winback_score})")
        return "winback"

    # Count other indicators
    agent_score = sum(1 for phrase in agent_initiated_phrases if phrase in normalized_text)
    customer_score = sum(1 for phrase in customer_initiated_phrases if phrase in normalized_text)

    logger.debug(f"Call direction scores - agent: {agent_score}, customer: {customer_score}")

    if agent_score > customer_score:
        return "outbound_marketing"
    elif customer_score > agent_score:
        return "inbound_service"
    else:
        return "unknown"


# ============================================================================
# REMOVED: Keyword-based classification filtering
# ============================================================================
# The following functions and data structures have been intentionally removed:
#
# - CLASSIFICATION_KEYWORDS: 500+ keyword mappings for 69 classifications
# - FALLBACK_CLASSIFICATIONS: Default classifications when no keywords match
# - get_relevant_classifications(): Filter 69 → 15 classifications by keywords
# - get_classification_keywords_for_logging(): Get keywords for a classification
#
# Reason: DictaLM's Hebrew understanding is better than rule-based keyword
# matching. The model can:
# 1. Understand context and semantic meaning
# 2. Distinguish between similar phrases with different intents
# 3. Handle edge cases that keywords miss
#
# Now we send ALL 69 classifications to DictaLM and let it choose.
# ============================================================================
