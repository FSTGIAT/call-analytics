const oracledb = require('oracledb');
require('dotenv').config({ path: '../config/.env.oracle' });

async function testOracleConnection() {
  let connection;
  
  try {
    console.log('Testing Oracle Database connection...\n');
    
    // Configuration
    const config = {
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE_NAME}`
    };
    
    console.log('Connection string:', config.connectString);
    console.log('User:', config.user);
    console.log('---\n');
    
    // Initialize Oracle client if needed
    if (process.env.ORACLE_CLIENT_DIR) {
      oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_DIR });
      console.log('Oracle client initialized with:', process.env.ORACLE_CLIENT_DIR);
    }
    
    // Create connection
    console.log('Attempting to connect...');
    connection = await oracledb.getConnection(config);
    console.log('✓ Successfully connected to Oracle Database\n');
    
    // Test query
    console.log('Running test query...');
    const result = await connection.execute('SELECT 1 as TEST_VALUE FROM DUAL');
    console.log('✓ Test query successful:', result.rows[0]);
    console.log('---\n');
    
    // Check if tables exist
    console.log('Checking for required tables...');
    const tableCheck = await connection.execute(`
      SELECT table_name 
      FROM user_tables 
      WHERE table_name IN ('CALL_TRANSCRIPTIONS', 'CALL_SUMMARIES', 'CALL_METADATA')
    `);
    
    if (tableCheck.rows.length > 0) {
      console.log('✓ Found tables:');
      tableCheck.rows.forEach(row => console.log('  -', row.TABLE_NAME));
    } else {
      console.log('⚠ No tables found. You may need to create them.');
      console.log('\nSample DDL for creating tables:\n');
      
      console.log(`-- Call Transcriptions Table
CREATE TABLE CALL_TRANSCRIPTIONS (
  CALL_ID VARCHAR2(50) PRIMARY KEY,
  CUSTOMER_ID VARCHAR2(50) NOT NULL,
  SUBSCRIBER_ID VARCHAR2(50) NOT NULL,
  CALL_DATE TIMESTAMP NOT NULL,
  DURATION_SECONDS NUMBER NOT NULL,
  TRANSCRIPTION_TEXT CLOB,
  LANGUAGE VARCHAR2(10) DEFAULT 'he',
  AGENT_ID VARCHAR2(50),
  CALL_TYPE VARCHAR2(50),
  CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP,
  INDEX idx_customer_id (CUSTOMER_ID),
  INDEX idx_subscriber_id (SUBSCRIBER_ID),
  INDEX idx_call_date (CALL_DATE)
);

-- Call Summaries Table
CREATE TABLE CALL_SUMMARIES (
  SUMMARY_ID VARCHAR2(50) PRIMARY KEY,
  CALL_ID VARCHAR2(50) NOT NULL,
  CUSTOMER_ID VARCHAR2(50) NOT NULL,
  SUMMARY_TEXT CLOB,
  KEY_POINTS CLOB,
  SENTIMENT VARCHAR2(20),
  PRODUCTS_MENTIONED CLOB,
  ACTION_ITEMS CLOB,
  CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP,
  FOREIGN KEY (CALL_ID) REFERENCES CALL_TRANSCRIPTIONS(CALL_ID),
  INDEX idx_call_id (CALL_ID)
);`);
    }
    
    console.log('\n✓ Oracle connection test completed successfully!');
    
  } catch (error) {
    console.error('✗ Oracle connection test failed:', error.message);
    console.error('\nTroubleshooting tips:');
    console.error('1. Check your Oracle credentials in config/.env.oracle');
    console.error('2. Ensure Oracle database is accessible from your network');
    console.error('3. Verify Oracle Instant Client is installed if required');
    console.error('4. Check firewall rules for Oracle port (usually 1521)');
  } finally {
    if (connection) {
      try {
        await connection.close();
        console.log('\n✓ Connection closed');
      } catch (err) {
        console.error('Error closing connection:', err);
      }
    }
  }
}

// Run the test
testOracleConnection().catch(console.error);