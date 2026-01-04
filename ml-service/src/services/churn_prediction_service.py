"""
Churn Prediction Service with AlephBERT Similarity Analysis

This service provides:
1. Churn risk scoring (1-100) based on multiple factors
2. Sentiment-based summary clustering using AlephBERT embeddings
3. Pattern detection from churned customer summaries
4. Data enrichment recommendations for improved prediction

Architecture:
- Uses existing AlephBERT embeddings (768-dim) for semantic similarity
- Combines keyword detection, sentiment analysis, and embedding similarity
- Clusters similar churned customer patterns for trend analysis
"""

import os
import json
import logging
import asyncio
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict

# Import embedding service for AlephBERT
try:
    from .embedding_service import embedding_service
except ImportError:
    from src.services.embedding_service import embedding_service

logger = logging.getLogger(__name__)


class ChurnRiskLevel(Enum):
    """Churn risk level categories"""
    CRITICAL = "critical"      # 80-100
    HIGH = "high"              # 60-79
    MEDIUM = "medium"          # 40-59
    LOW = "low"                # 20-39
    MINIMAL = "minimal"        # 1-19


@dataclass
class ChurnSignal:
    """Individual churn signal detected in a conversation"""
    signal_type: str
    weight: float
    description: str
    evidence: str
    confidence: float


@dataclass
class ChurnPrediction:
    """Complete churn prediction result for a customer"""
    customer_id: str
    subscriber_id: str
    churn_score: int  # 1-100
    risk_level: ChurnRiskLevel
    signals: List[ChurnSignal]
    sentiment_score: float  # -1 to 1
    similarity_to_churned: float  # 0 to 1
    similar_churned_patterns: List[Dict]
    recommendations: List[str]
    data_gaps: List[str]  # Missing data that could improve prediction
    timestamp: datetime
    confidence: float
    call_id: str = ""


@dataclass
class ChurnCluster:
    """Cluster of similar churned customer summaries"""
    cluster_id: str
    centroid_embedding: np.ndarray
    member_summaries: List[Dict]
    common_themes: List[str]
    avg_churn_score: float
    size: int


class ChurnPredictionService:
    """
    Advanced churn prediction service using multi-factor analysis
    and AlephBERT semantic similarity.
    """

    def __init__(self):
        # Configuration
        self.config = {
            'embedding_dimension': 768,
            'similarity_threshold': 0.7,
            'max_similar_patterns': 10,
            'cluster_min_size': 3,
            'cache_ttl_hours': 24,
        }

        # Churn signal weights (sum to 100)
        self.signal_weights = {
            'explicit_churn_keywords': 25,      # Direct churn mentions
            'competitor_mentions': 15,          # Mentions of competitors
            'negative_sentiment': 20,           # Overall negative sentiment
            'billing_complaints': 15,           # Billing/price issues
            'service_issues': 10,               # Technical problems
            'unresolved_problems': 10,          # Repeated issues
            'similarity_to_churned': 5,         # Similar to churned patterns
        }

        # Hebrew churn keywords with weights
        self.churn_keywords = {
            'explicit': {
                'keywords': [
                    'לעזוב', 'עוזב', 'עובר לחברה', 'סוגר קו', 'עובר לגולן',
                    'עובר להוט', 'עובר לסלקום', 'עובר לפרטנר', 'רוצה לעזוב',
                    'רוצה לנתק', 'מבטל', 'לבטל', 'לסיים', 'לסגור חשבון',
                    'ניתוק', 'ניוד', 'לנייד מספר'
                ],
                'weight': 3.0
            },
            'competitor': {
                'keywords': [
                    'גולן', 'הוט', 'סלקום', 'פרטנר', 'אורנג\'', 'פלאפון',
                    'יס', 'בזק', '012', '013', '019', 'רמי לוי',
                    'חברה אחרת', 'הצעה מחברה', 'קיבלתי הצעה'
                ],
                'weight': 2.0
            },
            'billing': {
                'keywords': [
                    'יקר', 'מחיר גבוה', 'חיוב לא נכון', 'טעות בחיוב',
                    'למה חייבתם', 'חויבתי פעמיים', 'גזל', 'גונבים',
                    'לא שילמתי על זה', 'להחזיר כסף', 'זיכוי', 'פיצוי',
                    'מחיר מופרז', 'התחייבות', 'שברו לי', 'לא סיכמנו'
                ],
                'weight': 1.5
            },
            'frustration': {
                'keywords': [
                    'לא מרוצה', 'מאוכזב', 'כועס', 'עצבני', 'התעללות',
                    'שירות גרוע', 'לא מקובל', 'חוצפה', 'מתעלמים',
                    'לא עונים', 'ממתין שעות', 'פעם עשירית', 'כל פעם',
                    'בזבוז זמן', 'לא נותנים', 'מסרבים', 'לא פותרים'
                ],
                'weight': 1.0
            },
            'service_issues': {
                'keywords': [
                    'לא עובד', 'תקלה', 'ניתוקים', 'אין שירות', 'איטי',
                    'גרוע', 'נפל', 'קורס', 'לא מתחבר', 'בעיה טכנית',
                    'כבר שבוע', 'כבר חודש', 'כל הזמן', 'שוב ושוב'
                ],
                'weight': 1.0
            }
        }

        # Sentiment keywords for quick analysis
        self.sentiment_keywords = {
            'negative': [
                'גרוע', 'נורא', 'לא טוב', 'מאוכזב', 'כועס', 'עצבני',
                'מתוסכל', 'נמאס', 'לא מקובל', 'חוצפה', 'גזל', 'שקר'
            ],
            'positive': [
                'מצוין', 'טוב', 'מרוצה', 'תודה', 'מעולה', 'נפלא',
                'עזרת', 'פתרת', 'מקצועי', 'אדיב', 'יעיל'
            ]
        }

        # Storage for churned customer patterns
        self.churned_patterns: List[Dict] = []
        self.churned_embeddings: Optional[np.ndarray] = None
        self.churned_clusters: List[ChurnCluster] = []

        # Cache for predictions
        self.prediction_cache: Dict[str, Tuple[ChurnPrediction, datetime]] = {}

        # Statistics
        self.stats = {
            'predictions_made': 0,
            'high_risk_detected': 0,
            'patterns_matched': 0,
            'avg_prediction_time': 0.0,
            'cache_hits': 0
        }

        logger.info("ChurnPredictionService initialized")

    async def initialize(self) -> bool:
        """Initialize the service and load models."""
        try:
            # Ensure embedding service is initialized
            await embedding_service.initialize_model()
            logger.info("ChurnPredictionService embedding model initialized")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize ChurnPredictionService: {e}")
            return False

    async def predict_churn(
        self,
        customer_id: str,
        subscriber_id: str,
        summary: str,
        call_id: str = "",
        sentiment: Optional[str] = None,
        classifications: Optional[List[str]] = None,
        call_history: Optional[List[Dict]] = None,
        billing_data: Optional[Dict] = None,
        service_data: Optional[Dict] = None
    ) -> ChurnPrediction:
        """
        Predict churn risk for a customer based on call summary and available data.

        Args:
            customer_id: Customer identifier
            subscriber_id: Subscriber/phone line identifier
            summary: Call summary text (Hebrew)
            call_id: Optional call identifier
            sentiment: Optional pre-analyzed sentiment
            classifications: Optional pre-assigned classifications
            call_history: Optional list of previous calls
            billing_data: Optional billing information
            service_data: Optional service/technical data

        Returns:
            ChurnPrediction with score, signals, and recommendations
        """
        start_time = datetime.now()

        try:
            # Check cache
            cache_key = f"{customer_id}:{subscriber_id}:{hash(summary)}"
            if cache_key in self.prediction_cache:
                cached, cache_time = self.prediction_cache[cache_key]
                if datetime.now() - cache_time < timedelta(hours=self.config['cache_ttl_hours']):
                    self.stats['cache_hits'] += 1
                    return cached

            signals = []

            # 1. Analyze explicit churn keywords
            keyword_signals = self._analyze_keywords(summary)
            signals.extend(keyword_signals)

            # 2. Analyze sentiment
            sentiment_score, sentiment_signals = self._analyze_sentiment(summary, sentiment)
            signals.extend(sentiment_signals)

            # 3. Check classifications for churn indicators
            if classifications:
                classification_signals = self._analyze_classifications(classifications)
                signals.extend(classification_signals)

            # 4. Analyze call history patterns
            if call_history:
                history_signals = self._analyze_call_history(call_history)
                signals.extend(history_signals)

            # 5. Analyze billing data
            if billing_data:
                billing_signals = self._analyze_billing(billing_data)
                signals.extend(billing_signals)

            # 6. Analyze service issues
            if service_data:
                service_signals = self._analyze_service_data(service_data)
                signals.extend(service_signals)

            # 7. Find similarity to churned customer patterns
            similarity_score, similar_patterns = await self._find_similar_churned(summary)
            if similarity_score > 0.5:
                signals.append(ChurnSignal(
                    signal_type='similarity_to_churned',
                    weight=similarity_score * self.signal_weights['similarity_to_churned'],
                    description='דפוס דומה ללקוחות שעזבו',
                    evidence=f'דמיון של {similarity_score:.1%} לדפוסי נטישה קודמים',
                    confidence=similarity_score
                ))

            # Calculate total churn score (1-100)
            churn_score = self._calculate_churn_score(signals)

            # Determine risk level
            risk_level = self._get_risk_level(churn_score)

            # Generate recommendations
            recommendations = self._generate_recommendations(signals, churn_score, billing_data)

            # Identify data gaps
            data_gaps = self._identify_data_gaps(billing_data, service_data, call_history)

            # Calculate confidence
            confidence = self._calculate_confidence(signals, data_gaps)

            # Create prediction
            prediction = ChurnPrediction(
                customer_id=customer_id,
                subscriber_id=subscriber_id,
                churn_score=churn_score,
                risk_level=risk_level,
                signals=signals,
                sentiment_score=sentiment_score,
                similarity_to_churned=similarity_score,
                similar_churned_patterns=similar_patterns[:5],  # Top 5
                recommendations=recommendations,
                data_gaps=data_gaps,
                timestamp=datetime.now(),
                confidence=confidence,
                call_id=call_id
            )

            # Cache prediction
            self.prediction_cache[cache_key] = (prediction, datetime.now())

            # Update statistics
            self.stats['predictions_made'] += 1
            if risk_level in [ChurnRiskLevel.HIGH, ChurnRiskLevel.CRITICAL]:
                self.stats['high_risk_detected'] += 1
            if similar_patterns:
                self.stats['patterns_matched'] += 1

            processing_time = (datetime.now() - start_time).total_seconds()
            self.stats['avg_prediction_time'] = (
                (self.stats['avg_prediction_time'] * (self.stats['predictions_made'] - 1) + processing_time)
                / self.stats['predictions_made']
            )

            logger.info(
                f"Churn prediction for {customer_id}: score={churn_score}, "
                f"risk={risk_level.value}, signals={len(signals)}"
            )

            return prediction

        except Exception as e:
            logger.error(f"Error predicting churn: {e}")
            # Return minimal prediction on error
            return ChurnPrediction(
                customer_id=customer_id,
                subscriber_id=subscriber_id,
                churn_score=50,  # Neutral score on error
                risk_level=ChurnRiskLevel.MEDIUM,
                signals=[],
                sentiment_score=0.0,
                similarity_to_churned=0.0,
                similar_churned_patterns=[],
                recommendations=["נדרשת בדיקה ידנית"],
                data_gaps=["שגיאה בניתוח"],
                timestamp=datetime.now(),
                confidence=0.0,
                call_id=call_id
            )

    def _analyze_keywords(self, text: str) -> List[ChurnSignal]:
        """Analyze text for churn-related keywords."""
        signals = []
        text_lower = text.lower()

        for category, config in self.churn_keywords.items():
            matches = []
            for keyword in config['keywords']:
                if keyword in text_lower:
                    matches.append(keyword)

            if matches:
                weight_key = {
                    'explicit': 'explicit_churn_keywords',
                    'competitor': 'competitor_mentions',
                    'billing': 'billing_complaints',
                    'frustration': 'negative_sentiment',
                    'service_issues': 'service_issues'
                }.get(category, 'explicit_churn_keywords')

                signal_weight = len(matches) * config['weight']
                max_weight = self.signal_weights[weight_key]

                signals.append(ChurnSignal(
                    signal_type=category,
                    weight=min(signal_weight, max_weight),
                    description=self._get_category_description(category),
                    evidence=', '.join(matches[:5]),
                    confidence=min(1.0, len(matches) * 0.3)
                ))

        return signals

    def _get_category_description(self, category: str) -> str:
        """Get Hebrew description for signal category."""
        descriptions = {
            'explicit': 'ביטויי נטישה מפורשים',
            'competitor': 'אזכור מתחרים',
            'billing': 'תלונות על חיוב/מחיר',
            'frustration': 'ביטויי תסכול',
            'service_issues': 'בעיות שירות/טכניות'
        }
        return descriptions.get(category, category)

    def _analyze_sentiment(
        self,
        text: str,
        pre_sentiment: Optional[str]
    ) -> Tuple[float, List[ChurnSignal]]:
        """Analyze sentiment and return score (-1 to 1) and signals."""
        signals = []

        # Quick keyword-based sentiment if no pre-analysis
        if pre_sentiment:
            sentiment_score = {
                'positive': 0.5,
                'neutral': 0.0,
                'negative': -0.5,
                'חיובי': 0.5,
                'ניטרלי': 0.0,
                'שלילי': -0.5
            }.get(pre_sentiment.lower(), 0.0)
        else:
            # Calculate from keywords
            text_lower = text.lower()
            negative_count = sum(1 for kw in self.sentiment_keywords['negative'] if kw in text_lower)
            positive_count = sum(1 for kw in self.sentiment_keywords['positive'] if kw in text_lower)

            total = negative_count + positive_count
            if total > 0:
                sentiment_score = (positive_count - negative_count) / total
            else:
                sentiment_score = 0.0

        # Create signal if negative
        if sentiment_score < -0.2:
            weight = abs(sentiment_score) * self.signal_weights['negative_sentiment']
            signals.append(ChurnSignal(
                signal_type='negative_sentiment',
                weight=weight,
                description='סנטימנט שלילי בשיחה',
                evidence=f'ציון סנטימנט: {sentiment_score:.2f}',
                confidence=abs(sentiment_score)
            ))

        return sentiment_score, signals

    def _analyze_classifications(self, classifications: List[str]) -> List[ChurnSignal]:
        """Analyze pre-assigned classifications for churn indicators."""
        signals = []

        churn_classifications = [
            'סימני נטישה', 'נטישה', 'איום לעזוב', 'סיום התקשרות',
            'ניתוק', 'ניוד', 'עזיבה'
        ]

        for classification in classifications:
            if any(churn in classification.lower() for churn in churn_classifications):
                signals.append(ChurnSignal(
                    signal_type='classification_churn',
                    weight=self.signal_weights['explicit_churn_keywords'] * 0.8,
                    description='סיווג נטישה זוהה',
                    evidence=classification,
                    confidence=0.9
                ))

        return signals

    def _analyze_call_history(self, call_history: List[Dict]) -> List[ChurnSignal]:
        """Analyze call history patterns for churn indicators."""
        signals = []

        if not call_history:
            return signals

        # Count recent calls (last 30 days)
        now = datetime.now()
        recent_calls = [
            c for c in call_history
            if c.get('timestamp') and
            (now - datetime.fromisoformat(c['timestamp'].replace('Z', '+00:00'))).days <= 30
        ]

        # High call frequency = potential issue
        if len(recent_calls) >= 5:
            signals.append(ChurnSignal(
                signal_type='high_call_frequency',
                weight=self.signal_weights['unresolved_problems'] * 0.5,
                description='תדירות שיחות גבוהה',
                evidence=f'{len(recent_calls)} שיחות ב-30 יום אחרונים',
                confidence=min(1.0, len(recent_calls) / 10)
            ))

        # Check for repeated issues
        issues = [c.get('classification', '') for c in recent_calls]
        issue_counts = defaultdict(int)
        for issue in issues:
            if issue:
                issue_counts[issue] += 1

        repeated = [(issue, count) for issue, count in issue_counts.items() if count >= 2]
        if repeated:
            signals.append(ChurnSignal(
                signal_type='repeated_issues',
                weight=self.signal_weights['unresolved_problems'],
                description='בעיות חוזרות',
                evidence=', '.join([f'{issue} ({count}x)' for issue, count in repeated[:3]]),
                confidence=min(1.0, sum(c for _, c in repeated) / 5)
            ))

        return signals

    def _analyze_billing(self, billing_data: Dict) -> List[ChurnSignal]:
        """Analyze billing data for churn indicators."""
        signals = []

        # Check for overdue payments
        if billing_data.get('overdue_amount', 0) > 0:
            signals.append(ChurnSignal(
                signal_type='overdue_payment',
                weight=self.signal_weights['billing_complaints'] * 0.5,
                description='חוב פתוח',
                evidence=f"₪{billing_data['overdue_amount']}",
                confidence=0.7
            ))

        # Check for billing disputes
        if billing_data.get('disputes_count', 0) > 0:
            signals.append(ChurnSignal(
                signal_type='billing_disputes',
                weight=self.signal_weights['billing_complaints'],
                description='סכסוכי חיוב',
                evidence=f"{billing_data['disputes_count']} סכסוכים",
                confidence=0.8
            ))

        # Check for plan changes (downgrade = risk)
        if billing_data.get('recent_downgrade'):
            signals.append(ChurnSignal(
                signal_type='plan_downgrade',
                weight=self.signal_weights['billing_complaints'] * 0.7,
                description='שדרוג לאחור (דאונגרייד)',
                evidence='שינוי מסלול למסלול זול יותר',
                confidence=0.6
            ))

        # Check for price sensitivity
        if billing_data.get('requested_discount'):
            signals.append(ChurnSignal(
                signal_type='price_sensitivity',
                weight=self.signal_weights['billing_complaints'] * 0.4,
                description='רגישות למחיר',
                evidence='בקשת הנחה',
                confidence=0.5
            ))

        return signals

    def _analyze_service_data(self, service_data: Dict) -> List[ChurnSignal]:
        """Analyze service/technical data for churn indicators."""
        signals = []

        # Check for outages
        outages = service_data.get('outages_last_30_days', 0)
        if outages >= 2:
            signals.append(ChurnSignal(
                signal_type='service_outages',
                weight=self.signal_weights['service_issues'],
                description='תקלות שירות',
                evidence=f'{outages} תקלות ב-30 יום',
                confidence=min(1.0, outages / 5)
            ))

        # Check for technician visits
        if service_data.get('technician_visits', 0) >= 2:
            signals.append(ChurnSignal(
                signal_type='multiple_technician_visits',
                weight=self.signal_weights['service_issues'] * 0.8,
                description='ביקורי טכנאי חוזרים',
                evidence=f"{service_data['technician_visits']} ביקורים",
                confidence=0.7
            ))

        # Check for speed/quality complaints
        if service_data.get('speed_complaints', 0) > 0:
            signals.append(ChurnSignal(
                signal_type='speed_complaints',
                weight=self.signal_weights['service_issues'] * 0.6,
                description='תלונות על מהירות/איכות',
                evidence='תלונות על ביצועים',
                confidence=0.6
            ))

        return signals

    async def _find_similar_churned(
        self,
        summary: str
    ) -> Tuple[float, List[Dict]]:
        """Find similar patterns from churned customers using AlephBERT."""
        if not self.churned_embeddings or len(self.churned_patterns) == 0:
            return 0.0, []

        try:
            # Generate embedding for current summary
            result = await embedding_service.generate_embedding(summary)
            current_embedding = result.embedding

            # Calculate similarity to all churned patterns
            similarities = np.dot(self.churned_embeddings, current_embedding)

            # Get top similar patterns
            top_indices = np.argsort(similarities)[-self.config['max_similar_patterns']:][::-1]

            similar_patterns = []
            for idx in top_indices:
                if similarities[idx] >= self.config['similarity_threshold']:
                    pattern = self.churned_patterns[idx].copy()
                    pattern['similarity'] = float(similarities[idx])
                    similar_patterns.append(pattern)

            # Calculate average similarity to top matches
            if similar_patterns:
                avg_similarity = np.mean([p['similarity'] for p in similar_patterns])
            else:
                avg_similarity = 0.0

            return avg_similarity, similar_patterns

        except Exception as e:
            logger.error(f"Error finding similar churned patterns: {e}")
            return 0.0, []

    def _calculate_churn_score(self, signals: List[ChurnSignal]) -> int:
        """Calculate total churn score (1-100) from signals."""
        if not signals:
            return 10  # Minimal base score

        # Sum weighted signals
        total_weight = sum(signal.weight for signal in signals)

        # Normalize to 1-100 range
        # Max possible weight is sum of all signal_weights
        max_weight = sum(self.signal_weights.values())

        # Apply sigmoid-like scaling for better distribution
        normalized = (total_weight / max_weight) * 100

        # Clamp to 1-100
        score = max(1, min(100, int(normalized)))

        # Boost for explicit churn signals
        has_explicit_churn = any(
            s.signal_type in ['explicit', 'classification_churn']
            for s in signals
        )
        if has_explicit_churn:
            score = max(score, 60)  # At least high-medium

        return score

    def _get_risk_level(self, score: int) -> ChurnRiskLevel:
        """Convert score to risk level."""
        if score >= 80:
            return ChurnRiskLevel.CRITICAL
        elif score >= 60:
            return ChurnRiskLevel.HIGH
        elif score >= 40:
            return ChurnRiskLevel.MEDIUM
        elif score >= 20:
            return ChurnRiskLevel.LOW
        else:
            return ChurnRiskLevel.MINIMAL

    def _generate_recommendations(
        self,
        signals: List[ChurnSignal],
        score: int,
        billing_data: Optional[Dict]
    ) -> List[str]:
        """Generate retention recommendations based on signals."""
        recommendations = []

        signal_types = [s.signal_type for s in signals]

        if score >= 80:
            recommendations.append("🚨 נדרשת התערבות מיידית - שיחת שימור דחופה")

        if 'explicit' in signal_types or 'classification_churn' in signal_types:
            recommendations.append("להציע תוכנית שימור אישית")
            recommendations.append("לבדוק אפשרות להנחה/הטבה מיוחדת")

        if 'competitor' in signal_types:
            recommendations.append("להשוות הצעות מתחרים ולהתאים")
            recommendations.append("להדגיש יתרונות ייחודיים של החברה")

        if 'billing' in signal_types:
            if billing_data and billing_data.get('overdue_amount', 0) > 0:
                recommendations.append("להציע הסדר תשלומים")
            recommendations.append("לבדוק אפשרות לזיכוי/פיצוי")
            recommendations.append("להסביר חיובים בצורה ברורה")

        if 'service_issues' in signal_types or 'repeated_issues' in signal_types:
            recommendations.append("לתזמן ביקור טכנאי בכיר")
            recommendations.append("להציע פיצוי על אי-נוחות")
            recommendations.append("לוודא פתרון שורש הבעיה")

        if 'negative_sentiment' in signal_types:
            recommendations.append("להקשיב באופן פעיל לתלונות")
            recommendations.append("להפגין אמפתיה ורצון לעזור")

        if not recommendations:
            recommendations.append("להמשיך מעקב שוטף")

        return recommendations

    def _identify_data_gaps(
        self,
        billing_data: Optional[Dict],
        service_data: Optional[Dict],
        call_history: Optional[List[Dict]]
    ) -> List[str]:
        """Identify missing data that could improve prediction."""
        gaps = []

        if not billing_data:
            gaps.append("נתוני חיוב חסרים - יכולים לשפר דיוק ב-15%")
        else:
            if 'tenure_months' not in billing_data:
                gaps.append("ותק לקוח חסר")
            if 'lifetime_value' not in billing_data:
                gaps.append("ערך לקוח (LTV) חסר")
            if 'payment_history' not in billing_data:
                gaps.append("היסטוריית תשלומים חסרה")

        if not service_data:
            gaps.append("נתוני שירות חסרים - יכולים לשפר דיוק ב-10%")
        else:
            if 'usage_patterns' not in service_data:
                gaps.append("דפוסי שימוש חסרים")
            if 'nps_score' not in service_data:
                gaps.append("ציון NPS חסר")

        if not call_history:
            gaps.append("היסטוריית שיחות חסרה - יכולה לשפר דיוק ב-20%")

        # Additional data that could help
        gaps.append("💡 נתונים נוספים שיכולים לעזור:")
        gaps.append("- סטטוס חוזה והתחייבות")
        gaps.append("- שימוש בנתונים vs תוכנית")
        gaps.append("- אינטראקציות באפליקציה/אתר")
        gaps.append("- תגובות לקמפיינים")

        return gaps

    def _calculate_confidence(
        self,
        signals: List[ChurnSignal],
        data_gaps: List[str]
    ) -> float:
        """Calculate prediction confidence based on available data."""
        base_confidence = 0.5

        # More signals = higher confidence
        if len(signals) >= 5:
            base_confidence += 0.2
        elif len(signals) >= 3:
            base_confidence += 0.1

        # Average signal confidence
        if signals:
            avg_signal_confidence = np.mean([s.confidence for s in signals])
            base_confidence += avg_signal_confidence * 0.2

        # Fewer data gaps = higher confidence
        critical_gaps = sum(1 for g in data_gaps if 'חסר' in g)
        base_confidence -= critical_gaps * 0.05

        return max(0.1, min(1.0, base_confidence))

    async def add_churned_pattern(
        self,
        summary: str,
        customer_id: str,
        churn_reason: str,
        churn_date: str,
        metadata: Optional[Dict] = None
    ) -> bool:
        """Add a churned customer pattern for future similarity matching."""
        try:
            # Generate embedding
            result = await embedding_service.generate_embedding(summary)
            embedding = result.embedding

            # Add to patterns
            pattern = {
                'summary': summary,
                'customer_id': customer_id,
                'churn_reason': churn_reason,
                'churn_date': churn_date,
                'metadata': metadata or {},
                'added_at': datetime.now().isoformat()
            }
            self.churned_patterns.append(pattern)

            # Update embeddings matrix
            if self.churned_embeddings is None:
                self.churned_embeddings = embedding.reshape(1, -1)
            else:
                self.churned_embeddings = np.vstack([
                    self.churned_embeddings,
                    embedding.reshape(1, -1)
                ])

            logger.info(f"Added churned pattern for customer {customer_id}")
            return True

        except Exception as e:
            logger.error(f"Error adding churned pattern: {e}")
            return False

    async def batch_add_churned_patterns(
        self,
        patterns: List[Dict]
    ) -> Dict:
        """Add multiple churned patterns in batch."""
        success_count = 0
        error_count = 0

        for pattern in patterns:
            try:
                success = await self.add_churned_pattern(
                    summary=pattern['summary'],
                    customer_id=pattern['customer_id'],
                    churn_reason=pattern.get('churn_reason', 'unknown'),
                    churn_date=pattern.get('churn_date', datetime.now().isoformat()),
                    metadata=pattern.get('metadata')
                )
                if success:
                    success_count += 1
                else:
                    error_count += 1
            except Exception as e:
                logger.error(f"Error in batch add: {e}")
                error_count += 1

        return {
            'success': success_count,
            'errors': error_count,
            'total_patterns': len(self.churned_patterns)
        }

    async def cluster_churned_patterns(
        self,
        n_clusters: int = 5
    ) -> List[ChurnCluster]:
        """Cluster churned patterns to find common themes."""
        if self.churned_embeddings is None or len(self.churned_patterns) < n_clusters:
            logger.warning("Not enough patterns for clustering")
            return []

        try:
            from sklearn.cluster import KMeans

            # Perform clustering
            kmeans = KMeans(n_clusters=n_clusters, random_state=42)
            labels = kmeans.fit_predict(self.churned_embeddings)

            clusters = []
            for i in range(n_clusters):
                mask = labels == i
                cluster_indices = np.where(mask)[0]

                if len(cluster_indices) < self.config['cluster_min_size']:
                    continue

                cluster_patterns = [self.churned_patterns[j] for j in cluster_indices]
                cluster_embeddings = self.churned_embeddings[mask]
                centroid = kmeans.cluster_centers_[i]

                # Extract common themes from summaries
                all_words = ' '.join([p['summary'] for p in cluster_patterns])
                common_themes = self._extract_common_themes(all_words)

                clusters.append(ChurnCluster(
                    cluster_id=f"cluster_{i}",
                    centroid_embedding=centroid,
                    member_summaries=cluster_patterns,
                    common_themes=common_themes,
                    avg_churn_score=0.0,  # Could be calculated if we store scores
                    size=len(cluster_patterns)
                ))

            self.churned_clusters = clusters
            logger.info(f"Created {len(clusters)} churn pattern clusters")

            return clusters

        except ImportError:
            logger.warning("sklearn not available for clustering")
            return []
        except Exception as e:
            logger.error(f"Error clustering patterns: {e}")
            return []

    def _extract_common_themes(self, text: str) -> List[str]:
        """Extract common themes from text (simplified)."""
        themes = []
        text_lower = text.lower()

        theme_keywords = {
            'בעיות מחיר': ['יקר', 'מחיר', 'חיוב', 'כסף', 'תשלום'],
            'בעיות שירות': ['תקלה', 'לא עובד', 'בעיה', 'איטי'],
            'מעבר למתחרה': ['גולן', 'הוט', 'סלקום', 'פרטנר', 'חברה אחרת'],
            'שירות לקוחות': ['נציג', 'שירות', 'תמיכה', 'המתנה'],
            'תקשורת': ['קליטה', 'רשת', 'אינטרנט', 'חיבור']
        }

        for theme, keywords in theme_keywords.items():
            if any(kw in text_lower for kw in keywords):
                themes.append(theme)

        return themes

    async def find_similar_summaries(
        self,
        query_summary: str,
        k: int = 10,
        threshold: float = 0.6
    ) -> List[Dict]:
        """Find similar summaries using AlephBERT embeddings."""
        try:
            results = await embedding_service.search_similar(
                query_text=query_summary,
                k=k,
                threshold=threshold
            )
            return results
        except Exception as e:
            logger.error(f"Error finding similar summaries: {e}")
            return []

    async def batch_predict(
        self,
        customers: List[Dict]
    ) -> List[ChurnPrediction]:
        """Batch predict churn for multiple customers."""
        predictions = []

        for customer in customers:
            prediction = await self.predict_churn(
                customer_id=customer['customer_id'],
                subscriber_id=customer.get('subscriber_id', ''),
                summary=customer['summary'],
                call_id=customer.get('call_id', ''),
                sentiment=customer.get('sentiment'),
                classifications=customer.get('classifications'),
                call_history=customer.get('call_history'),
                billing_data=customer.get('billing_data'),
                service_data=customer.get('service_data')
            )
            predictions.append(prediction)

        return predictions

    def get_stats(self) -> Dict:
        """Get service statistics."""
        return {
            **self.stats,
            'churned_patterns_count': len(self.churned_patterns),
            'clusters_count': len(self.churned_clusters),
            'cache_size': len(self.prediction_cache)
        }

    def get_top_risk_customers(
        self,
        predictions: List[ChurnPrediction],
        limit: int = 100
    ) -> List[Dict]:
        """Get top risk customers sorted by churn score (1-100 ranking)."""
        sorted_predictions = sorted(
            predictions,
            key=lambda p: p.churn_score,
            reverse=True
        )

        result = []
        for rank, pred in enumerate(sorted_predictions[:limit], 1):
            result.append({
                'rank': rank,
                'customer_id': pred.customer_id,
                'subscriber_id': pred.subscriber_id,
                'churn_score': pred.churn_score,
                'risk_level': pred.risk_level.value,
                'top_signals': [
                    {'type': s.signal_type, 'description': s.description}
                    for s in sorted(pred.signals, key=lambda x: x.weight, reverse=True)[:3]
                ],
                'recommendations': pred.recommendations[:2],
                'confidence': pred.confidence,
                'call_id': pred.call_id
            })

        return result

    def export_predictions_for_analysis(
        self,
        predictions: List[ChurnPrediction]
    ) -> List[Dict]:
        """Export predictions in format suitable for further analysis."""
        return [
            {
                'customer_id': p.customer_id,
                'subscriber_id': p.subscriber_id,
                'call_id': p.call_id,
                'churn_score': p.churn_score,
                'risk_level': p.risk_level.value,
                'sentiment_score': p.sentiment_score,
                'similarity_to_churned': p.similarity_to_churned,
                'signal_count': len(p.signals),
                'signals': [
                    {
                        'type': s.signal_type,
                        'weight': s.weight,
                        'confidence': s.confidence
                    }
                    for s in p.signals
                ],
                'data_gaps_count': len([g for g in p.data_gaps if 'חסר' in g]),
                'confidence': p.confidence,
                'timestamp': p.timestamp.isoformat()
            }
            for p in predictions
        ]


# Singleton instance
churn_prediction_service = ChurnPredictionService()
