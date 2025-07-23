import { Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { mcpClientService } from '../services/mcp-client.service';




// Validation schema for chat messages
export const chatSchema = Joi.object({
  message: Joi.string().required().min(1).max(1000),
  conversationId: Joi.string().optional()
});

export class AIController {
  static async chat(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now(); // Track request time
      const { message, conversationId } = req.body;
      const user = (req as any).user;

      logger.info('AI Chat request', {
        userId: user.userId,
        message: message.substring(0, 100),
        conversationId
      });


      // Process AI request through MCP Client → Vector → ML → Mistral → Claude fallback
      let aiResponse = '';

      try {
        // Import required services
        const { MCPClientService } = require('../services/mcp-client.service');
        const { vectorStorageService } = require('../services/vector-storage.service');
        const { mlService } = require('../services/ml.service');
        

        // Create customer context from user
        // For admin users, don't filter by customerId to allow searching across all data
        let customerContext = {
          customerId: user.role === 'admin' ? null : (user.customerId || user.userId),
          tier: user.tier || 'standard',
          language: user.language || 'he',
          preferences: user.preferences || {}
        };

        // Extract specific customer ID from query if mentioned (for admin users)
        if (user.role === 'admin') {
          // Try CUSTOMER_XXXX format first
          const customerIdMatch = message.match(/CUSTOMER[_\-\s]*([A-Z0-9_\-]+)/i);
          // Try BAN format (for Verint data)
          const banMatch = message.match(/BAN\s*(\d+)/i);
          // Try bare customer numbers (like "לקוח 3867088", "customer 3867088", or just numbers in Hebrew context)
          const bareNumberMatch = message.match(/לקוח\s*(\d+)|customer\s*(\d+)|\b(\d{7,})\b/i);
          
          if (customerIdMatch) {
            const extractedCustomerId = customerIdMatch[1]; // Use direct number for production
            customerContext = {
              ...customerContext,
              customerId: extractedCustomerId
            };
            logger.info('Extracted customer ID from query', {
              originalQuery: message.substring(0, 50),
              extractedCustomerId
            });
          } else if (banMatch) {
            const extractedBan = banMatch[1];
            // Use BAN directly as customer ID
            customerContext = {
              ...customerContext,
              customerId: extractedBan
            };
            logger.info('Extracted BAN from query', {
              originalQuery: message.substring(0, 50),
              extractedBan
            });
          } else if (bareNumberMatch) {
            const extractedNumber = bareNumberMatch[1] || bareNumberMatch[2] || bareNumberMatch[3];
            // Use number directly as customer ID for production BAN format
            customerContext = {
              ...customerContext,
              customerId: extractedNumber
            };
            logger.info('Extracted customer number from query', {
              originalQuery: message.substring(0, 50),
              extractedNumber,
              matchedPattern: bareNumberMatch[0]
            });
          }
        }

        // Step 1: Skip embedding generation for faster response - use keyword search only
        let embedding = null;
        
        // Skip Hebrew embedding completely for speed - rely on OpenSearch multilingual support
        logger.info('Skipping embedding generation for faster response - using keyword search only');
        
        // Step 2: Hybrid Search for 10TB scalability (OpenSearch + Weaviate)
        let searchResults = [];
        
        // Use consistent customer context for both OpenSearch and Weaviate  
        let searchContext = customerContext;
        
        logger.debug('Search context for hybrid search', {
          customerId: searchContext.customerId,
          isAdmin: user.role === 'admin',
          searchingAllData: !searchContext.customerId
        });
        
        try {
          logger.info('Starting hybrid search for 10TB scalability');
          
          // Standard context limit for all queries
          const contextLimit = 100;

          // Import search services
          const { openSearchService } = await import('../services/opensearch.service');
          
          // SIMPLIFIED: Direct OpenSearch only - no hybrid complexity
          logger.info('Starting OpenSearch for direct data access');
          
          // Prepare OpenSearch query
          const opensearchQuery = searchContext.customerId ? {
            query: '*', // Get all conversations for this customer
            size: contextLimit, 
            sort: [{ callDate: 'desc' as const }] // Most recent first
          } : {
            query: message, // For general queries, search by message content
            size: contextLimit, 
            minimum_should_match: '60%'
          };
          
          // Direct OpenSearch call - no hybrid merging
          const searchResponse = await openSearchService.search(
            searchContext, 
            'transcriptions', 
            opensearchQuery
          );
          
          searchResults = searchResponse.results || [];
          
          logger.info('OpenSearch completed - DIRECT RESULTS', { 
            searchResultsCount: searchResults.length,
            searchContext: JSON.stringify(searchContext),
            queryUsed: opensearchQuery.query,
            firstResultPreview: searchResults.length > 0 ? {
              callId: searchResults[0].callId,
              customerId: searchResults[0].customerId,
              transcriptionTextLength: searchResults[0].transcriptionText?.length,
              transcriptionPreview: searchResults[0].transcriptionText?.substring(0, 300),
              sentiment: searchResults[0].sentiment,
              callDate: searchResults[0].callDate
            } : null,
            allCallIds: searchResults.map(r => r.callId).slice(0, 10),
            uniqueCustomers: [...new Set(searchResults.map(r => r.customerId))],
            hasTranscriptionText: searchResults.filter(r => r.transcriptionText && r.transcriptionText.length > 50).length
          });

        } catch (searchError) {
          logger.error('OpenSearch failed:', {
            error: searchError instanceof Error ? searchError.message : String(searchError),
            customerContext
          });
          // Continue without search results
        }
        
        // Step 3: Let LLM handle all query analysis dynamically - no hardcoded conditions
        
        // Step 4: ALWAYS get full dataset analytics for accurate counts
        let fullDatasetAnalytics = null;
        
        // Always fetch analytics regardless of search results
        try {
          logger.info('Getting full dataset analytics for accurate counts');
          
          // Import openSearchService at the right scope
          const { openSearchService } = await import('../services/opensearch.service');
          
          // Get full dataset analytics from OpenSearch (fast aggregations only)
          const analyticsQuery: any = {
            query: '*',
            size: 0,  // Don't return documents, just aggregations
            aggs: {
              total_calls: { cardinality: { field: 'callId' } },
              sentiment_breakdown: {
                terms: { 
                  field: 'sentiment', 
                  size: 5 
                },
                aggs: {
                  unique_calls: { cardinality: { field: 'callId' } }
                }
              }
            }
          };
          
          // Add customer activity aggregation for admin users
          if (user.role === 'admin') {
            analyticsQuery.aggs.customer_activity = {
              terms: {
                field: 'customerId',
                size: 50,  // Get top 50 customers
                order: { 'unique_calls': 'desc' }  // Order by unique call count, not document count
              },
              aggs: {
                unique_calls: { 
                  cardinality: { field: 'callId' }  // Count unique calls per customer
                }
              }
            };
            analyticsQuery.aggs.unique_customers = {
              cardinality: { field: 'customerId' }
            };
          }
          
          // Use extracted customer context if specific customer mentioned, otherwise admin gets all data
          // For regular users, always use their customer context
          const analyticsContext = user.role === 'admin' ? 
            (customerContext.customerId ? customerContext : { customerId: null, role: 'admin' }) : 
            customerContext;
          
          // Add timeout to prevent slow aggregations
          const fullAnalyticsResponse = await Promise.race([
            openSearchService.search(analyticsContext, 'transcriptions', analyticsQuery),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Aggregations timeout')), 2000)
            )
          ]) as any;
          
          logger.info('Full analytics response received', {
            hasResponse: !!fullAnalyticsResponse,
            hasAggregations: !!(fullAnalyticsResponse && fullAnalyticsResponse.aggregations),
            aggregationKeys: fullAnalyticsResponse?.aggregations ? Object.keys(fullAnalyticsResponse.aggregations) : [],
            totalHits: fullAnalyticsResponse?.hits?.total?.value || 0,
            userRole: user.role
          });

          if (fullAnalyticsResponse && fullAnalyticsResponse.aggregations) {
            const aggs = fullAnalyticsResponse.aggregations;
            const totalCalls = aggs.total_calls?.value || 0;
            const sentimentBuckets = aggs.sentiment_breakdown?.buckets || [];
            
            // Calculate total sentiment calls using unique call counts (not document counts)
            const totalSentimentCalls = sentimentBuckets.reduce((sum, bucket) => sum + (bucket.unique_calls?.value || 0), 0);
            
            // Handle both Hebrew and English sentiment values - use unique call counts
            const positiveCount = (sentimentBuckets.find(b => b.key === 'positive')?.unique_calls?.value || 0) +
                                 (sentimentBuckets.find(b => b.key === 'חיובי')?.unique_calls?.value || 0);
            const negativeCount = (sentimentBuckets.find(b => b.key === 'negative')?.unique_calls?.value || 0) +
                                 (sentimentBuckets.find(b => b.key === 'שלילי')?.unique_calls?.value || 0);
            const neutralCount = (sentimentBuckets.find(b => b.key === 'neutral')?.unique_calls?.value || 0) +
                                (sentimentBuckets.find(b => b.key === 'נייטרלי')?.unique_calls?.value || 0);
            
            fullDatasetAnalytics = {
              total: totalCalls,
              totalSentimentCalls: totalSentimentCalls,
              sentimentBreakdown: {
                positive: positiveCount,
                negative: negativeCount,
                neutral: neutralCount
              }
            };
            
            // Process customer activity for admin users
            if (user.role === 'admin' && aggs.customer_activity && aggs.unique_customers) {
              fullDatasetAnalytics.uniqueCustomers = aggs.unique_customers.value || 0;
              fullDatasetAnalytics.customerActivity = aggs.customer_activity.buckets.map(bucket => ({
                customerId: bucket.key,
                callCount: bucket.unique_calls?.value || 0  // Use unique call count, not document count
              }));
              
              logger.info('Customer activity data processed', {
                uniqueCustomers: fullDatasetAnalytics.uniqueCustomers,
                customerActivityCount: fullDatasetAnalytics.customerActivity.length,
                topCustomer: fullDatasetAnalytics.customerActivity[0],
                hasCustomerActivity: !!fullDatasetAnalytics.customerActivity
              });
            } else {
              logger.warn('Customer activity not processed', {
                isAdmin: user.role === 'admin',
                hasCustomerActivity: !!aggs.customer_activity,
                hasUniqueCustomers: !!aggs.unique_customers,
                customerActivityBuckets: aggs.customer_activity?.buckets?.length || 0
              });
            }
            
            logger.info('Full dataset analytics retrieved', { 
              fullDatasetAnalytics,
              sentimentBuckets: sentimentBuckets.map(b => `${b.key}: ${b.unique_calls?.value || 0} calls (${b.doc_count} docs)`),
              analyticsContext,
              message: message.substring(0, 50),
              userRole: user.role,
              isAdminQuery: user.role === 'admin'
            });
          }
        } catch (analyticsError) {
          logger.error('Failed to get full dataset analytics', {
            error: analyticsError.message,
            stack: analyticsError.stack,
            customerContext,
            userRole: user.role
          });
          logger.warn('Falling back to search results');
        }
        
        logger.info('Context preparation', { 
          searchResultsCount: searchResults.length,
          hasFullAnalytics: !!fullDatasetAnalytics
        });

        // Step 4: Build clean context for analysis
        let contextData = '';
        
        // Provide context when there are any search results
        if (searchResults && searchResults.length > 0) {
          // Larger context size for Hebrew conversations - Hebrew text requires more bytes
          const maxContextBytes = 75000;
          
          // Step 0: Deduplicate by callId and select the LONGEST conversation for each call
          const callMap = new Map();
          searchResults.forEach(result => {
            const callId = result.callId;
            const transcriptLength = (result.transcriptionText || '').length;
            
            if (!callMap.has(callId) || callMap.get(callId).transcriptLength < transcriptLength) {
              callMap.set(callId, {
                result,
                transcriptLength
              });
            }
          });
          
          // Use only the longest version of each conversation
          const deduplicatedResults = Array.from(callMap.values()).map(item => item.result);
          
          logger.info('DEDUPLICATION - Selecting longest conversations', {
            originalResults: searchResults.length,
            deduplicatedResults: deduplicatedResults.length,
            longestConversationLength: Math.max(...deduplicatedResults.map(r => (r.transcriptionText || '').length))
          });

          // Step 1: Score results by importance
          const scoredResults = deduplicatedResults.map(result => {
            const sentiment = result.sentiment || 'neutral';
            const callDate = new Date(result.callDate || 0);
            const transcript = result.transcriptionText || '';
            
            // Content importance scoring
            let score = result.score || 0; // Search relevance base score
            
            // Recency bonus (newer = more relevant)
            const daysDiff = (Date.now() - callDate.getTime()) / (1000 * 60 * 60 * 24);
            score += Math.max(0, 10 - daysDiff) * 0.1;
            
            // Sentiment extremes are more valuable than neutral
            if (sentiment === 'positive' || sentiment === 'negative') score += 0.3;
            
            // Content length indicates substance
            if (transcript.length > 50) score += 0.2;
            
            return { ...result, importanceScore: score };
          }).sort((a, b) => b.importanceScore - a.importanceScore);
          
          // Step 2: Adaptive context building with size monitoring - SUMMARY ONLY
          let contextSize = 0;
          const selectedResults = [];
          
          // ENHANCED LOGGING: Track context building process
          logger.info('CONTEXT BUILDING - Starting process', {
            totalScoredResults: scoredResults.length,
            maxContextBytes,
            searchContextCustomerId: searchContext.customerId,
            isCustomerSpecificQuery: !!searchContext.customerId,
            topScores: scoredResults.slice(0, 5).map(r => ({
              callId: r.callId,
              customerId: r.customerId,
              importanceScore: r.importanceScore,
              transcriptionLength: r.transcriptionText?.length
            }))
          });
          
          for (const result of scoredResults) {
            const sentiment = result.sentiment || 'neu';
            const callDate = result.callDate?.split('T')[0] || 'unknown';
            const fullTranscript = result.transcriptionText || result.transcript || result.text || result.content || '';
            
            // ENHANCED LOGGING: Track each result processing
            logger.info(`CONTEXT BUILDING - Processing result #${selectedResults.length + 1}`, {
              callId: result.callId,
              customerId: result.customerId,
              fullTranscriptLength: fullTranscript.length,
              fullTranscriptPreview: fullTranscript.substring(0, 200),
              hasHebrewContent: /[\u0590-\u05FF]/.test(fullTranscript),
              sentiment,
              callDate,
              importanceScore: result.importanceScore,
              // CRITICAL DEBUG: Show what properties we have
              availableProperties: Object.keys(result || {}),
              hasTranscriptionText: !!result.transcriptionText,
              transcriptionTextLength: result.transcriptionText?.length,
              // Show if we're actually getting the full transcript
              shouldShowFullTranscript: !!searchContext.customerId,
              customerIdUsed: searchContext.customerId
            });
            
            // Skip empty entries
            if (!fullTranscript || fullTranscript.length < 10) {
              logger.warn('CONTEXT BUILDING - Skipping empty transcript', {
                callId: result.callId,
                transcriptLength: fullTranscript.length
              });
              continue;
            }
            
            // For customer-specific queries OR when we extracted a customer ID from the query, show full transcript
            const hasSpecificCustomer = searchContext.customerId || 
                                       /לקוח\s*(\d+)|customer\s*(\d+)|\b(\d{7,})\b/i.test(message);
            
            const summary = hasSpecificCustomer ? 
              fullTranscript : // Show full transcript for specific customer queries
              (fullTranscript.length > 100 ? 
                fullTranscript.substring(0, 100) + '...' : 
                fullTranscript);
            
            // CRITICAL DEBUG: Log summary decision
            logger.info(`CONTEXT BUILDING - Summary decision`, {
              callId: result.callId,
              searchContextCustomerId: searchContext.customerId,
              hasSpecificCustomer,
              messageContainsCustomerPattern: /לקוח\s*(\d+)|customer\s*(\d+)|\b(\d{7,})\b/i.test(message),
              willUseFullTranscript: hasSpecificCustomer,
              fullTranscriptLength: fullTranscript.length,
              summaryLength: summary.length,
              summaryEqualsFullTranscript: summary === fullTranscript,
              summaryPreview: summary.substring(0, 300)
            });
            
            const resultText = user.role === 'admin' && result.customerId
              ? `Date: ${callDate}, Customer: ${result.customerId}, Call: ${result.callId}, Sentiment: ${sentiment}, Content: ${summary}\n`
              : `Date: ${callDate}, Call: ${result.callId}, Sentiment: ${sentiment}, Content: ${summary}\n`;
            const resultSize = Buffer.byteLength(resultText, 'utf8');
            
            // ENHANCED LOGGING: Track what gets included in context
            logger.info(`CONTEXT BUILDING - Result text for AI`, {
              callId: result.callId,
              resultTextLength: resultText.length,
              resultText: resultText.substring(0, 500),
              isFullTranscript: summary === fullTranscript,
              summaryLength: summary.length,
              contextSizeSoFar: contextSize,
              willFitInBudget: contextSize + resultSize <= maxContextBytes,
              maxContextBytes
            });
            
            // Check budget and add to context
            if (contextSize + resultSize <= maxContextBytes) {
              selectedResults.push(resultText);
              contextSize += resultSize;
            } else {
              logger.warn('CONTEXT BUILDING - Budget exhausted', {
                contextSize,
                maxContextBytes,
                remainingResults: scoredResults.length - selectedResults.length,
                selectedResultsCount: selectedResults.length
              });
              break; // Context budget exhausted
            }
          }
          
          const compressedResults = selectedResults;
          
          // Log dynamic context management performance
          logger.info('Dynamic context management results:', {
            originalResults: searchResults.length,
            selectedResults: selectedResults.length,
            finalContextSize: contextSize,
            maxContextBytes,
            efficiencyRatio: (selectedResults.length / searchResults.length * 100).toFixed(1) + '%',
            contextUtilization: (contextSize / maxContextBytes * 100).toFixed(1) + '%'
          });
          
          // Use full dataset analytics if available, otherwise search results analytics
          let analyticsToUse;
          if (fullDatasetAnalytics) {
            analyticsToUse = fullDatasetAnalytics;
          } else {
            // Fallback to search results analytics
            analyticsToUse = {
              total: searchResults.length,
              sentimentBreakdown: { positive: 0, negative: 0, neutral: 0 }
            };
            
            searchResults.forEach(result => {
              const sentiment = result.properties.sentiment || 'neutral';
              if (sentiment in analyticsToUse.sentimentBreakdown) {
                analyticsToUse.sentimentBreakdown[sentiment]++;
              }
            });
          }
          
          // Compressed analytics summary with dataset context for analytics clarity
          const total = analyticsToUse.total;
          const searchCount = searchResults.length;
          
          // Use sentiment call total for accurate percentage calculation
          const sentimentTotal = analyticsToUse.totalSentimentCalls || 
            (analyticsToUse.sentimentBreakdown.positive + analyticsToUse.sentimentBreakdown.negative + analyticsToUse.sentimentBreakdown.neutral) ||
            total || 1;
            
          const posPercent = Math.round((analyticsToUse.sentimentBreakdown.positive / sentimentTotal) * 100);
          const negPercent = Math.round((analyticsToUse.sentimentBreakdown.negative / sentimentTotal) * 100);
          const neuPercent = Math.round((analyticsToUse.sentimentBreakdown.neutral / sentimentTotal) * 100);
          
          // Provide clean analytics data without formatting constraints
          const analytics = {
            positive: analyticsToUse.sentimentBreakdown.positive,
            negative: analyticsToUse.sentimentBreakdown.negative,
            neutral: analyticsToUse.sentimentBreakdown.neutral
          };
          
          // Adaptive context based on query type - avoid rigid formatting
          const scopeInfo = user.role === 'admin' ? '[כל הלקוחות]' : `[לקוח ${customerContext.customerId || user.userId}]`;
          
          // Give LLM the data it has available
          contextData = '';
          
          if (fullDatasetAnalytics) {
            contextData += `Analytics: ${JSON.stringify(fullDatasetAnalytics)}\n`;
          }
          
          if (compressedResults.length > 0) {
            contextData += `Search Results: ${compressedResults.join('\n')}\n`;
          }
          
          if (!contextData) {
            contextData = 'Available data: basic system information';
          }
          
          // ENHANCED LOGGING: Show final context data being sent to AI
          logger.info('CONTEXT DATA - Final data for AI', {
            contextDataLength: contextData.length,
            hasAnalytics: !!fullDatasetAnalytics,
            hasSearchResults: compressedResults.length > 0,
            searchResultsCount: compressedResults.length,
            contextPreview: contextData.substring(0, 1000),
            analyticsData: fullDatasetAnalytics ? JSON.stringify(fullDatasetAnalytics) : null,
            firstSearchResult: compressedResults.length > 0 ? compressedResults[0].substring(0, 300) : null,
            hasHebrewInContext: /[\u0590-\u05FF]/.test(contextData),
            searchResultsWithHebrew: compressedResults.filter(r => /[\u0590-\u05FF]/.test(r)).length
          });
        } else {
          // No search results - provide available data and let LLM decide
          contextData = '';
          
          if (fullDatasetAnalytics) {
            // Add customer data for admin users
            if (user.role === 'admin' && fullDatasetAnalytics.customerActivity) {
              contextData += `Total customers: ${fullDatasetAnalytics.uniqueCustomers}\n\n`;
              
              const topCustomers = fullDatasetAnalytics.customerActivity.slice(0, 10);
              contextData += 'Customer Activity:\n';
              topCustomers.forEach((customer, index) => {
                contextData += `${index + 1}. ${customer.customerId}: ${customer.callCount} calls\n`;
              });
            }
            
            // Add sentiment data if available
            if (fullDatasetAnalytics.sentimentBreakdown) {
              contextData += `\nSentiment: positive=${fullDatasetAnalytics.sentimentBreakdown.positive} negative=${fullDatasetAnalytics.sentimentBreakdown.negative} neutral=${fullDatasetAnalytics.sentimentBreakdown.neutral}\n`;
            }
          }
          
          if (!contextData) {
            contextData = 'No data available';
          }
        }

        // Step 5: Create optimized prompt for fast processing
        let enhancedPrompt = contextData + "\n\nשאלת המשתמש: " + message;
        
        logger.debug('Context data debug:', {
          contextDataLength: contextData.length,
          contextDataPreview: contextData.substring(0, 200),
          hasSearchResults: searchResults && searchResults.length > 0,
          hasFullDatasetAnalytics: !!fullDatasetAnalytics,
          isAdmin: user.role === 'admin'
        });
        
        // Enhanced system prompts in English for better LLM understanding
        let systemPrompt = '';
        
        // Enterprise-grade telecom analytics system prompt with customer context awareness
        const dataScope = customerContext.customerId ? `CUSTOMER ${customerContext.customerId}` : 
          (user.role === 'admin' ? 'ALL CUSTOMERS' : `CUSTOMER ${user.userId}`);
        const scopeInstruction = customerContext.customerId ? 
          `You are analyzing data for ${customerContext.customerId} ONLY. Focus on their call content, topics, and transcriptions.` :
          (user.role === 'admin' ? 
            'You are analyzing data across ALL customers in the system.' :
            `You are analyzing data for CUSTOMER ${user.userId} ONLY. Do not make system-wide generalizations.`);
        
        systemPrompt = `אתה עוזר AI דובר עברית המתמחה בניתוח נתוני שיחות. עליך להשיב תמיד ורק בעברית - אף פעם לא באנגלית! תן תשובות ישירות ועובדתיות בלבד. חשוב מאוד: כשאתה מנתח שיחות, קרא ונתח את כל תוכן השיחה מההתחלה ועד הסוף. כלול את כל השירותים שהוזכרו, את כל הנושאים שנדונו.

תחום הנתונים: ${dataScope}
${scopeInstruction}

פורמט תשובה:
- ענה על השאלה הספציפית שנשאלת
- השתמש רק בנתונים שסופקו
- ללא ביטויי פתיחה, סיכום או שפה שיחית
- הצג עובדות ומספרים ישירות
- ללא "בהחלט", "כמובן", או מילוי שיחתי
- התחל ישירות עם התשובה או הנתונים
- כשנשאל על לקוח ספציפי: ספק ניתוח שיחה מלא ומפורט הכולל: כל השירותים שהוזכרו, כל בעיה שנדונה, כל הפתרונות שניתנו, זרימת השיחה המלאה מהתחלה לסוף, תוצאת שביעות רצון הלקוח, וציטוטים ספציפיים מהשיחה
- ${user.role === 'admin' ? 'כלול פירוט לפי לקוחות כאשר רלוונטי' : 'התמקד רק בנתוני הלקוח הזה'}

Available Data:
${user.role === 'admin' ? 'Customer Activity: Customer call counts and activity\nTotal Customers: System-wide customer metrics' : ''}
Analytics: Sentiment analysis results
Call Records: Individual call transcriptions and metadata`;

        logger.info('Enhanced prompt being sent to LLM:', {
          message: message.substring(0, 100),
          contextDataLength: contextData.length,
          searchResultsCount: searchResults.length,
          systemPromptLength: systemPrompt.length
        });

        // Create LLM request for MCP processing
        const llmRequest = {
          prompt: enhancedPrompt,
          systemPrompt,
          temperature: 0.7, // Higher for more creative and complete analysis
          maxTokens: 8000 // Much larger for COMPLETE Hebrew conversation analysis - Hebrew requires more tokens
        };

        logger.info('Processing AI request through MCP Client with RAG context', {
          userId: user.userId,
          message: message.substring(0, 100),
          contextItems: searchResults.length,
          conversationId,
          contextDataLength: contextData.length,
          promptLength: enhancedPrompt.length,
          contextDataPreview: contextData.substring(0, 500) + (contextData.length > 500 ? '...' : ''),
          // CRITICAL DEBUG: Show EXACT content going to AI
          FULL_PROMPT_FOR_DEBUG: enhancedPrompt,
          SYSTEM_PROMPT_FOR_DEBUG: systemPrompt.substring(0, 1000),
          hasHebrewInPrompt: /[\u0590-\u05FF]/.test(enhancedPrompt),
          promptContainsCustomer3867088: enhancedPrompt.includes('3867088'),
          promptContainsESim: /eSIM|E סים/i.test(enhancedPrompt)
        });

        // Process request with retry logic
        let mcpResponse;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            logger.info(`Processing attempt ${attempt}/3`, {
              contextSize: Buffer.byteLength(llmRequest.prompt, 'utf8')
            });
            
            const mcpPromise = mcpClientService.processLLMRequest(llmRequest, customerContext, conversationId);
            mcpResponse = await Promise.race([
              mcpPromise,
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('MCP processing timeout')), 50000)
              )
            ]);
            
            break; // Success!
            
          } catch (error) {
            const isTimeout = error.message.includes('timeout');
            
            if (isTimeout && attempt < 3) {
              logger.warn(`Timeout on attempt ${attempt}, retrying`);
              continue; // Retry
            }
            
            throw error; // Not timeout or final attempt
          }
        }

        if (mcpResponse.success) {
          // Clean LLM response to remove model-specific tokens
          let cleanResponse = mcpResponse.response || 'I processed your request successfully.';
          
          // Remove common LLM instruction tokens
          cleanResponse = cleanResponse.replace(/\[\/INST\]/g, '');
          cleanResponse = cleanResponse.replace(/\[INST\]/g, '');
          cleanResponse = cleanResponse.replace(/<<SYS>>/g, '');
          cleanResponse = cleanResponse.replace(/<<\/SYS>>/g, '');
          
          // Hebrew-specific conversational filter for direct business responses
          const originalLength = cleanResponse.length;
          cleanResponse = filterHebrewConversationalResponse(cleanResponse);
          logger.info('Hebrew response filtering applied', {
            originalLength,
            filteredLength: cleanResponse.length,
            filtered: originalLength !== cleanResponse.length
          });
          
          // Clean up any double newlines or spaces created by token removal
          cleanResponse = cleanResponse.replace(/\n\s*\n/g, '\n');
          cleanResponse = cleanResponse.trim();
          
          aiResponse = cleanResponse;
        } else {
          aiResponse = mcpResponse.error || 'I apologize, but I encountered an error processing your request. Please try again.';
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : '';
        logger.error('Error in AI chat processing:', {
          message: errorMessage,
          stack: errorStack,
          type: error?.constructor?.name
        });
        aiResponse = `I'm experiencing technical difficulties. Error: ${errorMessage}. Please try again or contact support if the issue persists.`;
      }

      // Removed unnecessary delay

      const totalTime = Date.now() - startTime;
      
      // Generate conversation ID if not provided, ensuring it's user-specific for better context management
      const finalConversationId = conversationId || `${user.userId}-chat-${Date.now()}`;
      
      res.json({
        success: true,
        response: aiResponse,
        conversationId: finalConversationId,
        timestamp: new Date().toISOString(),
        metadata: {
          processingTime: `${totalTime}ms`,
          confidence: 0.95,
          suggestedActions: [
            'View Recent Calls',
            'Search Conversations', 
            'Generate Report'
          ]
        }
      });

    } catch (error) {
      logger.error('AI Chat error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to process chat message',
        response: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment."
      });
    }
  }

  static async getConversationHistory(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const user = (req as any).user;

      // In a real implementation, fetch from database
      // For now, return mock conversation history
      res.json({
        success: true,
        conversationId,
        messages: [
          {
            id: 1,
            text: "Hello! How can I help you with call analytics today?",
            isUser: false,
            timestamp: new Date(Date.now() - 5 * 60 * 1000)
          }
        ]
      });

    } catch (error) {
      logger.error('Get conversation history error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to fetch conversation history' 
      });
    }
  }

}

/**
 * Filters Hebrew conversational elements to provide direct, business-focused responses
 */
function filterHebrewConversationalResponse(response: string): string {
    let filtered = response;

    // Remove conversational prefixes
    const conversationalPrefixes = [
      /^בהחלט\.\s*/,
      /^כמובן\.\s*/,
      /^בוודאי\.\s*/,
      /^על פי הנתונים שסופקו,?\s*/,
      /^על פי הנתונים שניתנו,?\s*/,
      /^הנתונים מראים ש/,
      /^לפי הנתונים שסופקו,?\s*/,
      /^לפי הנתונים שניתנו,?\s*/,
      /^ניתוח נתוני השיחות של כל הלקוחות במערכת,?\s*/,
      /^מתוך הנתונים שניתנו,?\s*/
    ];

    for (const prefix of conversationalPrefixes) {
      filtered = filtered.replace(prefix, '');
    }

    // Remove verbose introductory phrases
    const verbosePhrases = [
      /ישנם \d+ קריאות אנליטיות בסך הכל עם \d+ שיחות בעלות סנטימנט חיובי, שלילי או ניטרלי\.\s*/g,
      /מתוך כלל הלקוחות במערכת,?\s*/g,
      /הנה הפירוט של קריאות האנליטיות לפי לקוח:\s*/g,
      /הנה פירוט של מספר שיחות לכל לקוח:\s*/g
    ];

    for (const phrase of verbosePhrases) {
      filtered = filtered.replace(phrase, '');
    }

    // Clean up sentence starters that become awkward after prefix removal
    filtered = filtered.replace(/^מראה ש/, '');
    filtered = filtered.replace(/^ש/, '');
    
    // Capitalize first letter after cleaning
    if (filtered.length > 0) {
      filtered = filtered.charAt(0).toUpperCase() + filtered.slice(1);
    }

    // Ensure it's not empty
    if (!filtered.trim()) {
      filtered = response; // Fallback to original if we cleaned too much
    }

    return filtered.trim();
}