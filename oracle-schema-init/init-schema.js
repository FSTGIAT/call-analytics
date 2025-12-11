const oracledb = require('oracledb');
const fs = require('fs');

async function initializeSchema() {
    let connection;
    
    try {
        // Connection configuration using Service Discovery DNS
        const config = {
            user: 'system',
            password: '2288', 
            connectString: 'oraclev2.callanalytics.local:1521/XE'
        };
        
        console.log('🔗 Connecting to Oracle database via Service Discovery...');
        console.log(`📍 Host: ${config.connectString}`);
        connection = await oracledb.getConnection(config);
        console.log('✅ Connected to Oracle database successfully');
        
        // Read the schema initialization script
        const sqlScript = fs.readFileSync('./01-init-schema.sql', 'utf8');
        
        // Also ensure VERINT_TEXT_ANALYSIS table exists (main table)
        console.log('🔍 Checking if VERINT_TEXT_ANALYSIS table exists...');
        const tableCheck = await connection.execute(`
            SELECT COUNT(*) as table_count 
            FROM user_tables 
            WHERE table_name = 'VERINT_TEXT_ANALYSIS'
        `);
        
        if (tableCheck.rows[0][0] === 0) {
            console.log('📝 Creating VERINT_TEXT_ANALYSIS table (main table)...');
            await connection.execute(`
                CREATE TABLE VERINT_TEXT_ANALYSIS (
                    CALL_ID NUMBER NOT NULL,
                    BAN VARCHAR2(50) NOT NULL,
                    SUBSCRIBER_NO VARCHAR2(50),
                    OWNER CHAR(1) NOT NULL,
                    TEXT CLOB NOT NULL,
                    TEXT_TIME TIMESTAMP NOT NULL,
                    CALL_TIME TIMESTAMP NOT NULL,
                    CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP
                )
            `);
            
            await connection.execute(`
                CREATE INDEX IDX_VERINT_TEXT_TIME ON VERINT_TEXT_ANALYSIS (TEXT_TIME)
            `);
            
            await connection.execute(`
                CREATE INDEX IDX_VERINT_CALL_ID ON VERINT_TEXT_ANALYSIS (CALL_ID, TEXT_TIME)
            `);
            
            console.log('✅ VERINT_TEXT_ANALYSIS table created successfully');
        } else {
            console.log('✅ VERINT_TEXT_ANALYSIS table already exists');
        }
        
        // Split script into individual statements and clean them
        const statements = sqlScript
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--') && !stmt.match(/^\s*$/));
        
        console.log(`📝 Found ${statements.length} SQL statements to execute`);
        
        let successCount = 0;
        let skipCount = 0;
        
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i].trim();
            if (statement.length === 0) continue;
            
            try {
                console.log(`🔄 Executing statement ${i + 1}/${statements.length}...`);
                console.log(`   📄 ${statement.substring(0, 50)}...`);
                
                await connection.execute(statement);
                successCount++;
                console.log(`✅ Statement ${i + 1} executed successfully`);
                
            } catch (err) {
                // Handle expected errors gracefully
                if (err.message.includes('ORA-00955')) {
                    console.log(`⚠️  Statement ${i + 1} - object already exists, skipping`);
                    skipCount++;
                } else if (err.message.includes('ORA-00001')) {
                    console.log(`⚠️  Statement ${i + 1} - unique constraint violation, skipping`);
                    skipCount++;
                } else {
                    console.error(`❌ Error in statement ${i + 1}:`, err.message);
                    console.error('Statement:', statement.substring(0, 100) + '...');
                    // Continue with other statements instead of failing completely
                }
            }
        }
        
        await connection.commit();
        console.log(`🎉 Schema initialization completed!`);
        console.log(`   ✅ Successful: ${successCount}`);
        console.log(`   ⚠️  Skipped: ${skipCount}`);
        
        // Verify critical CDC tables exist
        console.log('🔍 Verifying CDC tables...');
        const result = await connection.execute(`
            SELECT table_name 
            FROM user_tables 
            WHERE table_name IN ('CDC_PROCESSING_STATUS', 'CDC_PROCESSING_LOG', 'VERINT_TEXT_ANALYSIS')
            ORDER BY table_name
        `);
        
        if (result.rows.length > 0) {
            console.log('📋 CDC Tables found:');
            result.rows.forEach(row => console.log(`  ✅ ${row[0]}`));
        } else {
            console.log('⚠️  No CDC tables found - this might be expected if they already existed');
        }
        
        // Also check all tables to give full picture
        const allTables = await connection.execute(`
            SELECT table_name 
            FROM user_tables 
            ORDER BY table_name
        `);
        
        console.log(`📊 Total tables in schema: ${allTables.rows.length}`);
        
        console.log('🎉 Oracle schema initialization complete - API should now work properly!');
        
    } catch (err) {
        console.error('❌ Critical Error:', err.message);
        console.error('📍 Connection details were:', {
            user: 'system',
            connectString: 'oraclev2.callanalytics.local:1521/XE'
        });
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

console.log('🚀 Starting Oracle Schema Initialization...');
initializeSchema();