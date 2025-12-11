const oracledb = require('oracledb');
const fs = require('fs');

async function initializeSchema() {
    let connection;
    
    try {
        // Connection configuration
        const config = {
            user: 'system',
            password: '2288',
            connectString: 'oraclev2.callanalytics.local:1521/XE'
        };
        
        console.log('🔗 Connecting to Oracle database...');
        connection = await oracledb.getConnection(config);
        console.log('✅ Connected to Oracle database successfully');
        
        // Read the schema initialization script
        const sqlScript = fs.readFileSync('/app/01-init-schema.sql', 'utf8');
        
        // Split script into individual statements
        const statements = sqlScript.split(';').filter(stmt => stmt.trim().length > 0);
        
        console.log(`📝 Found ${statements.length} SQL statements to execute`);
        
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i].trim();
            if (statement.length === 0 || statement.startsWith('--')) continue;
            
            try {
                console.log(`🔄 Executing statement ${i + 1}/${statements.length}...`);
                await connection.execute(statement);
                console.log(`✅ Statement ${i + 1} executed successfully`);
            } catch (err) {
                // Ignore "table already exists" errors
                if (err.message.includes('ORA-00955')) {
                    console.log(`⚠️  Statement ${i + 1} - table already exists, skipping`);
                } else {
                    console.error(`❌ Error in statement ${i + 1}:`, err.message);
                    console.error('Statement:', statement.substring(0, 100) + '...');
                }
            }
        }
        
        await connection.commit();
        console.log('🎉 Schema initialization completed successfully!');
        
        // Verify CDC tables exist
        const result = await connection.execute(`
            SELECT table_name 
            FROM user_tables 
            WHERE table_name IN ('CDC_PROCESSING_STATUS', 'CDC_PROCESSING_LOG', 'VERINT_TEXT_ANALYSIS')
            ORDER BY table_name
        `);
        
        console.log('📋 CDC Tables found:');
        result.rows.forEach(row => console.log(`  ✅ ${row[0]}`));
        
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    } finally {
        if (connection) {
            try {
                await connection.close();
                console.log('🔐 Database connection closed');
            } catch (err) {
                console.error('Error closing connection:', err);
            }
        }
    }
}

initializeSchema();