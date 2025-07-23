// Debug script for Hebrew positive calls search issue
const { Client } = require('@opensearch-project/opensearch');

async function testHebrewSearch() {
  const client = new Client({
    node: 'http://localhost:9200',
    ssl: {
      rejectUnauthorized: false
    }
  });

  console.log('Testing Hebrew search for positive calls...\n');

  // Test queries
  const testQueries = [
    {
      name: 'Hebrew positive sentiment filter',
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: 'הצג לי את השיחות החיוביות',
                fields: ['transcriptionText^2', 'processedText^1.5', 'keyPoints'],
                fuzziness: 'AUTO',
                operator: 'or'
              }
            }
          ],
          filter: [
            { term: { sentiment: 'חיובי' } }
          ]
        }
      }
    },
    {
      name: 'English positive sentiment filter',
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: 'הצג לי את השיחות החיוביות',
                fields: ['transcriptionText^2', 'processedText^1.5', 'keyPoints'],
                fuzziness: 'AUTO',
                operator: 'or'
              }
            }
          ],
          filter: [
            { term: { sentiment: 'positive' } }
          ]
        }
      }
    },
    {
      name: 'Both sentiment values (should)',
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: 'הצג לי את השיחות החיוביות',
                fields: ['transcriptionText^2', 'processedText^1.5', 'keyPoints'],
                fuzziness: 'AUTO',
                operator: 'or'
              }
            }
          ],
          filter: [
            {
              bool: {
                should: [
                  { term: { sentiment: 'positive' } },
                  { term: { sentiment: 'חיובי' } }
                ]
              }
            }
          ]
        }
      }
    },
    {
      name: 'Just Hebrew keyword search (no sentiment filter)',
      query: {
        multi_match: {
          query: 'הצג לי את השיחות החיוביות',
          fields: ['transcriptionText^2', 'processedText^1.5', 'keyPoints'],
          fuzziness: 'AUTO',
          operator: 'or'
        }
      }
    },
    {
      name: 'Just positive sentiment aggregation',
      query: {
        match_all: {}
      },
      aggs: {
        sentiment_values: {
          terms: {
            field: 'sentiment',
            size: 10
          }
        }
      }
    }
  ];

  // Test each query
  for (const test of testQueries) {
    console.log(`\n=== Testing: ${test.name} ===`);
    
    try {
      const searchParams = {
        index: 'call-analytics-*-transcriptions',
        body: {
          query: test.query,
          size: 5,
          _source: ['callId', 'sentiment', 'transcriptionText', 'callDate']
        }
      };

      if (test.aggs) {
        searchParams.body.aggs = test.aggs;
        searchParams.body.size = 0; // Don't return documents for aggregation query
      }

      const response = await client.search(searchParams);
      
      console.log(`Total hits: ${response.body.hits.total.value || response.body.hits.total}`);
      
      if (test.aggs && response.body.aggregations) {
        console.log('Sentiment values found:');
        const buckets = response.body.aggregations.sentiment_values.buckets;
        buckets.forEach(bucket => {
          console.log(`  - ${bucket.key}: ${bucket.doc_count} documents`);
        });
      } else {
        console.log('Sample results:');
        response.body.hits.hits.forEach((hit, i) => {
          console.log(`  ${i + 1}. CallID: ${hit._source.callId}, Sentiment: ${hit._source.sentiment}`);
          if (hit._source.transcriptionText) {
            console.log(`     Text: ${hit._source.transcriptionText.substring(0, 100)}...`);
          }
        });
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }

  // Test what happens in the actual search flow
  console.log('\n\n=== Testing actual search flow (as in ai.controller.ts) ===');
  
  const actualQuery = {
    query: 'הצג לי את השיחות החיוביות',
    size: 15,
    fields: ['transcriptionText', 'summary', 'sentiment', 'agentId', 'customerId'],
    include_score: true,
    minimum_should_match: '60%'
  };

  const actualSearchQuery = {
    bool: {
      must: [
        {
          multi_match: {
            query: actualQuery.query,
            fields: [
              'transcriptionText^2',
              'transcriptionText.multilingual',
              'processedText^1.5',
              'keyPoints',
              'summary.main_points'
            ],
            fuzziness: 'AUTO',
            operator: 'or'
          }
        }
      ],
      filter: []
    }
  };

  try {
    const response = await client.search({
      index: 'call-analytics-*-transcriptions',
      body: {
        query: actualSearchQuery,
        size: actualQuery.size,
        sort: [{ callDate: { order: 'desc' } }],
        highlight: {
          fields: {
            transcriptionText: {
              pre_tags: ['<mark>'],
              post_tags: ['</mark>'],
              fragment_size: 150,
              number_of_fragments: 3
            }
          }
        }
      }
    });

    console.log(`\nActual search results: ${response.body.hits.total.value || response.body.hits.total} hits`);
    console.log('\nFirst 3 results:');
    response.body.hits.hits.slice(0, 3).forEach((hit, i) => {
      console.log(`\n${i + 1}. Score: ${hit._score}, CallID: ${hit._source.callId}`);
      console.log(`   Sentiment: ${hit._source.sentiment}`);
      console.log(`   Date: ${hit._source.callDate}`);
      if (hit.highlight && hit.highlight.transcriptionText) {
        console.log(`   Highlighted: ${hit.highlight.transcriptionText[0]}`);
      }
    });
  } catch (error) {
    console.error(`Error in actual search: ${error.message}`);
  }

  console.log('\n\nConclusions:');
  console.log('1. Check if sentiment field contains Hebrew values (חיובי) or English (positive)');
  console.log('2. The current code does NOT filter by sentiment - it only does keyword search');
  console.log('3. The Hebrew word "חיוביות" might not match documents well');
  console.log('4. Consider if LLM should detect sentiment queries and add filters');
}

testHebrewSearch().catch(console.error);