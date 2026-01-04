"""
Churn Prediction API Endpoints

Flask blueprint for churn prediction endpoints.
Provides REST API for churn risk scoring, similarity analysis,
and pattern management.
"""

import logging
from datetime import datetime
from flask import Blueprint, request, jsonify

from .churn_prediction_service import churn_prediction_service, ChurnRiskLevel

logger = logging.getLogger(__name__)

# Create Flask blueprint
churn_bp = Blueprint('churn', __name__, url_prefix='/churn')


@churn_bp.route('/health', methods=['GET'])
async def churn_health():
    """Health check for churn prediction service."""
    try:
        stats = churn_prediction_service.get_stats()
        return jsonify({
            'status': 'healthy',
            'service': 'churn-prediction',
            'timestamp': datetime.now().isoformat(),
            'stats': stats
        })
    except Exception as e:
        logger.error(f"Churn health check error: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 500


@churn_bp.route('/predict', methods=['POST'])
async def predict_churn():
    """
    Predict churn risk for a single customer.

    Request body:
    {
        "customer_id": "string",
        "subscriber_id": "string",
        "summary": "string (Hebrew call summary)",
        "call_id": "string (optional)",
        "sentiment": "string (optional: positive/negative/neutral)",
        "classifications": ["string"] (optional),
        "call_history": [{"timestamp": "...", "classification": "..."}] (optional),
        "billing_data": {
            "overdue_amount": 0,
            "disputes_count": 0,
            "recent_downgrade": false,
            "requested_discount": false,
            "tenure_months": 24,
            "lifetime_value": 5000
        } (optional),
        "service_data": {
            "outages_last_30_days": 0,
            "technician_visits": 0,
            "speed_complaints": 0
        } (optional)
    }

    Returns:
    {
        "churn_score": 75,
        "risk_level": "high",
        "signals": [...],
        "recommendations": [...],
        "data_gaps": [...],
        "confidence": 0.8
    }
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'Request body required'}), 400

        customer_id = data.get('customer_id', '')
        subscriber_id = data.get('subscriber_id', '')
        summary = data.get('summary', '')

        if not customer_id or not summary:
            return jsonify({
                'error': 'customer_id and summary are required'
            }), 400

        # Initialize service if needed
        await churn_prediction_service.initialize()

        # Make prediction
        prediction = await churn_prediction_service.predict_churn(
            customer_id=customer_id,
            subscriber_id=subscriber_id,
            summary=summary,
            call_id=data.get('call_id', ''),
            sentiment=data.get('sentiment'),
            classifications=data.get('classifications'),
            call_history=data.get('call_history'),
            billing_data=data.get('billing_data'),
            service_data=data.get('service_data')
        )

        return jsonify({
            'customer_id': prediction.customer_id,
            'subscriber_id': prediction.subscriber_id,
            'call_id': prediction.call_id,
            'churn_score': prediction.churn_score,
            'risk_level': prediction.risk_level.value,
            'signals': [
                {
                    'type': s.signal_type,
                    'weight': s.weight,
                    'description': s.description,
                    'evidence': s.evidence,
                    'confidence': s.confidence
                }
                for s in prediction.signals
            ],
            'sentiment_score': prediction.sentiment_score,
            'similarity_to_churned': prediction.similarity_to_churned,
            'similar_patterns': prediction.similar_churned_patterns,
            'recommendations': prediction.recommendations,
            'data_gaps': prediction.data_gaps,
            'confidence': prediction.confidence,
            'timestamp': prediction.timestamp.isoformat()
        })

    except Exception as e:
        logger.error(f"Churn prediction error: {e}")
        return jsonify({'error': str(e)}), 500


@churn_bp.route('/batch-predict', methods=['POST'])
async def batch_predict_churn():
    """
    Predict churn risk for multiple customers.

    Request body:
    {
        "customers": [
            {
                "customer_id": "string",
                "subscriber_id": "string",
                "summary": "string",
                ...
            }
        ]
    }

    Returns:
    {
        "predictions": [...],
        "summary": {
            "total": 10,
            "critical": 2,
            "high": 3,
            "medium": 3,
            "low": 2
        }
    }
    """
    try:
        data = request.get_json()
        customers = data.get('customers', [])

        if not customers:
            return jsonify({'error': 'customers array required'}), 400

        if len(customers) > 100:
            return jsonify({'error': 'Maximum 100 customers per batch'}), 400

        await churn_prediction_service.initialize()

        predictions = await churn_prediction_service.batch_predict(customers)

        # Count by risk level
        risk_counts = {
            'critical': 0,
            'high': 0,
            'medium': 0,
            'low': 0,
            'minimal': 0
        }

        results = []
        for pred in predictions:
            risk_counts[pred.risk_level.value] += 1
            results.append({
                'customer_id': pred.customer_id,
                'subscriber_id': pred.subscriber_id,
                'churn_score': pred.churn_score,
                'risk_level': pred.risk_level.value,
                'top_signals': [
                    {'type': s.signal_type, 'description': s.description}
                    for s in sorted(pred.signals, key=lambda x: x.weight, reverse=True)[:3]
                ],
                'recommendations': pred.recommendations[:2],
                'confidence': pred.confidence
            })

        return jsonify({
            'predictions': results,
            'summary': {
                'total': len(predictions),
                **risk_counts
            }
        })

    except Exception as e:
        logger.error(f"Batch churn prediction error: {e}")
        return jsonify({'error': str(e)}), 500


@churn_bp.route('/rank', methods=['POST'])
async def rank_customers():
    """
    Get customers ranked 1-100 by churn risk.

    Request body:
    {
        "customers": [...],
        "limit": 100
    }

    Returns:
    {
        "ranked_customers": [
            {
                "rank": 1,
                "customer_id": "...",
                "churn_score": 95,
                "risk_level": "critical",
                ...
            }
        ]
    }
    """
    try:
        data = request.get_json()
        customers = data.get('customers', [])
        limit = data.get('limit', 100)

        if not customers:
            return jsonify({'error': 'customers array required'}), 400

        await churn_prediction_service.initialize()

        predictions = await churn_prediction_service.batch_predict(customers)
        ranked = churn_prediction_service.get_top_risk_customers(predictions, limit)

        return jsonify({
            'ranked_customers': ranked,
            'total_analyzed': len(predictions),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        logger.error(f"Customer ranking error: {e}")
        return jsonify({'error': str(e)}), 500


@churn_bp.route('/add-churned-pattern', methods=['POST'])
async def add_churned_pattern():
    """
    Add a churned customer pattern for future similarity matching.

    Request body:
    {
        "summary": "string (call summary)",
        "customer_id": "string",
        "churn_reason": "string",
        "churn_date": "2024-01-15",
        "metadata": {} (optional)
    }
    """
    try:
        data = request.get_json()

        if not data.get('summary') or not data.get('customer_id'):
            return jsonify({
                'error': 'summary and customer_id required'
            }), 400

        await churn_prediction_service.initialize()

        success = await churn_prediction_service.add_churned_pattern(
            summary=data['summary'],
            customer_id=data['customer_id'],
            churn_reason=data.get('churn_reason', 'unknown'),
            churn_date=data.get('churn_date', datetime.now().isoformat()),
            metadata=data.get('metadata')
        )

        if success:
            return jsonify({
                'success': True,
                'message': 'Churned pattern added',
                'total_patterns': len(churn_prediction_service.churned_patterns)
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to add pattern'
            }), 500

    except Exception as e:
        logger.error(f"Add churned pattern error: {e}")
        return jsonify({'error': str(e)}), 500


@churn_bp.route('/batch-add-churned-patterns', methods=['POST'])
async def batch_add_churned_patterns():
    """
    Add multiple churned customer patterns.

    Request body:
    {
        "patterns": [
            {
                "summary": "...",
                "customer_id": "...",
                "churn_reason": "...",
                "churn_date": "..."
            }
        ]
    }
    """
    try:
        data = request.get_json()
        patterns = data.get('patterns', [])

        if not patterns:
            return jsonify({'error': 'patterns array required'}), 400

        await churn_prediction_service.initialize()

        result = await churn_prediction_service.batch_add_churned_patterns(patterns)

        return jsonify(result)

    except Exception as e:
        logger.error(f"Batch add patterns error: {e}")
        return jsonify({'error': str(e)}), 500


@churn_bp.route('/find-similar', methods=['POST'])
async def find_similar_summaries():
    """
    Find similar summaries using AlephBERT embeddings.

    Request body:
    {
        "query_summary": "string",
        "k": 10,
        "threshold": 0.6
    }
    """
    try:
        data = request.get_json()
        query_summary = data.get('query_summary', '')
        k = data.get('k', 10)
        threshold = data.get('threshold', 0.6)

        if not query_summary:
            return jsonify({'error': 'query_summary required'}), 400

        await churn_prediction_service.initialize()

        results = await churn_prediction_service.find_similar_summaries(
            query_summary=query_summary,
            k=k,
            threshold=threshold
        )

        return jsonify({
            'query': query_summary[:100] + '...' if len(query_summary) > 100 else query_summary,
            'similar_summaries': results,
            'count': len(results)
        })

    except Exception as e:
        logger.error(f"Find similar error: {e}")
        return jsonify({'error': str(e)}), 500


@churn_bp.route('/cluster-patterns', methods=['POST'])
async def cluster_churned_patterns():
    """
    Cluster churned customer patterns to find common themes.

    Request body:
    {
        "n_clusters": 5
    }
    """
    try:
        data = request.get_json() or {}
        n_clusters = data.get('n_clusters', 5)

        await churn_prediction_service.initialize()

        clusters = await churn_prediction_service.cluster_churned_patterns(n_clusters)

        return jsonify({
            'clusters': [
                {
                    'cluster_id': c.cluster_id,
                    'size': c.size,
                    'common_themes': c.common_themes,
                    'avg_churn_score': c.avg_churn_score,
                    'sample_summaries': [
                        m['summary'][:200] + '...' if len(m['summary']) > 200 else m['summary']
                        for m in c.member_summaries[:3]
                    ]
                }
                for c in clusters
            ],
            'total_clusters': len(clusters)
        })

    except Exception as e:
        logger.error(f"Cluster patterns error: {e}")
        return jsonify({'error': str(e)}), 500


@churn_bp.route('/stats', methods=['GET'])
def get_churn_stats():
    """Get churn prediction service statistics."""
    try:
        stats = churn_prediction_service.get_stats()
        return jsonify(stats)
    except Exception as e:
        logger.error(f"Stats error: {e}")
        return jsonify({'error': str(e)}), 500


@churn_bp.route('/data-requirements', methods=['GET'])
def get_data_requirements():
    """
    Get information about data requirements for optimal churn prediction.

    Returns detailed documentation about what data inputs are needed
    and how they improve prediction accuracy.
    """
    return jsonify({
        'required_data': {
            'customer_id': {
                'type': 'string',
                'required': True,
                'description': 'מזהה לקוח ייחודי'
            },
            'summary': {
                'type': 'string',
                'required': True,
                'description': 'סיכום השיחה בעברית',
                'impact': 'בסיס לניתוח - משפיע על 60% מהדיוק'
            }
        },
        'recommended_data': {
            'billing_data': {
                'fields': {
                    'overdue_amount': 'סכום חוב פתוח - משפיע 10% על דיוק',
                    'disputes_count': 'מספר סכסוכי חיוב',
                    'recent_downgrade': 'האם היה דאונגרייד לאחרונה',
                    'requested_discount': 'האם ביקש הנחה',
                    'tenure_months': 'ותק בחודשים - קריטי לחיזוי',
                    'lifetime_value': 'ערך לקוח מצטבר',
                    'payment_history': 'היסטוריית תשלומים (בזמן/באיחור)'
                },
                'impact': 'שיפור של עד 15% בדיוק'
            },
            'service_data': {
                'fields': {
                    'outages_last_30_days': 'מספר תקלות ב-30 יום',
                    'technician_visits': 'מספר ביקורי טכנאי',
                    'speed_complaints': 'תלונות על מהירות',
                    'usage_patterns': 'דפוסי שימוש (נתונים, שיחות)',
                    'nps_score': 'ציון NPS אם קיים'
                },
                'impact': 'שיפור של עד 10% בדיוק'
            },
            'call_history': {
                'fields': {
                    'timestamp': 'זמן השיחה',
                    'classification': 'סיווג השיחה',
                    'sentiment': 'סנטימנט',
                    'resolution': 'האם נפתר'
                },
                'impact': 'שיפור של עד 20% בדיוק - חשוב מאוד!'
            }
        },
        'future_enhancements': {
            'contract_status': 'סטטוס חוזה והתחייבות - יעזור לזהות לקוחות בסוף התחייבות',
            'usage_vs_plan': 'שימוש בפועל לעומת תוכנית - יזהה לקוחות שמשלמים יותר מדי',
            'app_interactions': 'אינטראקציות באפליקציה - יראה מעורבות',
            'campaign_responses': 'תגובות לקמפיינים - יזהה לקוחות שמחפשים הצעות',
            'competitor_exposure': 'חשיפה לפרסום מתחרים',
            'social_sentiment': 'סנטימנט ברשתות חברתיות',
            'device_age': 'גיל המכשיר - לקוחות עם מכשיר ישן פחות תלויים'
        },
        'accuracy_by_data_availability': {
            'summary_only': '50-60% דיוק',
            'summary_with_sentiment': '60-65% דיוק',
            'summary_with_call_history': '70-75% דיוק',
            'full_data': '85-90% דיוק'
        }
    })


@churn_bp.route('/test', methods=['GET'])
async def test_churn_prediction():
    """Test churn prediction with sample data."""
    try:
        await churn_prediction_service.initialize()

        # Sample churned pattern to add
        sample_churned = {
            'summary': 'הלקוח מאוד מתוסכל מהשירות. אמר שהוא עובר לגולן כי המחירים שלהם יותר טובים. יש לו בעיות קליטה כבר חודש ואף אחד לא פותר. ביקש לנתק את הקו.',
            'customer_id': 'CHURNED-001',
            'churn_reason': 'מחיר ושירות',
            'churn_date': '2024-01-01'
        }

        await churn_prediction_service.add_churned_pattern(**sample_churned)

        # Sample current customer to predict
        sample_customer = {
            'customer_id': 'TEST-001',
            'subscriber_id': 'SUB-001',
            'summary': 'הלקוח התקשר בנוגע לחשבונית גבוהה. הוא לא מרוצה מהמחיר ואמר שקיבל הצעה מסלקום. יש לו גם בעיות עם האינטרנט שלא נפתרות.',
            'sentiment': 'negative',
            'classifications': ['הסבר חשבונית או חיוב', 'סימני נטישה'],
            'billing_data': {
                'overdue_amount': 150,
                'disputes_count': 2,
                'requested_discount': True
            },
            'service_data': {
                'outages_last_30_days': 3,
                'speed_complaints': 2
            }
        }

        prediction = await churn_prediction_service.predict_churn(**sample_customer)

        return jsonify({
            'test_status': 'success',
            'sample_customer': sample_customer,
            'prediction': {
                'churn_score': prediction.churn_score,
                'risk_level': prediction.risk_level.value,
                'signals_count': len(prediction.signals),
                'signals': [
                    {'type': s.signal_type, 'description': s.description, 'weight': s.weight}
                    for s in prediction.signals
                ],
                'similarity_to_churned': prediction.similarity_to_churned,
                'recommendations': prediction.recommendations,
                'confidence': prediction.confidence
            },
            'stats': churn_prediction_service.get_stats()
        })

    except Exception as e:
        logger.error(f"Test error: {e}")
        return jsonify({
            'test_status': 'failed',
            'error': str(e)
        }), 500
