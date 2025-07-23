import { Request, Response } from 'express';
import { realtimeCDCService } from '../services/realtime-cdc.service';
import { logger } from '../utils/logger';
import oracledb from 'oracledb';

export class RealtimeCDCController {
  
  /**
   * Start real-time CDC processing
   */
  static async startCDCProcessing(req: Request, res: Response): Promise<void> {
    try {
      await realtimeCDCService.start();
      
      res.json({
        success: true,
        message: 'Real-time CDC processing started',
        status: realtimeCDCService.getStatus(),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error starting CDC processing:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start CDC processing',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Stop real-time CDC processing
   */
  static async stopCDCProcessing(req: Request, res: Response): Promise<void> {
    try {
      await realtimeCDCService.stop();
      
      res.json({
        success: true,
        message: 'Real-time CDC processing stopped',
        status: realtimeCDCService.getStatus(),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error stopping CDC processing:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to stop CDC processing',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get CDC processing status
   */
  static async getCDCStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = realtimeCDCService.getStatus();
      const statistics = await realtimeCDCService.getStatistics();
      
      res.json({
        success: true,
        status,
        statistics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error getting CDC status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get CDC status',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get CDC processing statistics
   */
  static async getCDCStatistics(req: Request, res: Response): Promise<void> {
    try {
      const statistics = await realtimeCDCService.getStatistics();
      
      res.json({
        success: true,
        statistics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error getting CDC statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get CDC statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Test CDC by inserting sample data
   */
  static async testCDC(req: Request, res: Response): Promise<void> {
    try {
      const { customerId } = req.body;
      const testCallId = Date.now().toString();
      const testBan = `TEST_${Math.random().toString(36).substr(2, 9)}`;
      
      // Insert test data to trigger CDC
      const { oracleService } = require('../services/oracle.service');
      const connection = await oracleService.getConnection();
      
      try {
        await connection.execute(
          `INSERT INTO VERINT_TEXT_ANALYSIS (
            CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT
          ) VALUES (
            :callId, :ban, :subscriberNo, SYSDATE, SYSDATE, :owner, :text
          )`,
          {
            callId: testCallId,
            ban: testBan,
            subscriberNo: `SUB_${testBan}`,
            owner: 'C',
            text: 'שלום, אני מתקשר בבקשה לבדוק את החשבון שלי. יש לי בעיה עם החיוב החודשי.'
          }
        );

        await connection.commit();
        
        res.json({
          success: true,
          message: 'Test CDC record inserted',
          testData: {
            callId: testCallId,
            ban: testBan,
            customerId: customerId || `CUST_${testBan}`
          },
          timestamp: new Date().toISOString()
        });

      } finally {
        await connection.close();
      }

    } catch (error) {
      logger.error('Error testing CDC:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to test CDC',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Reset CDC timestamp to reprocess all data (for backfilling vector stores)
   */
  static async resetForBackfill(req: Request, res: Response): Promise<void> {
    try {
      const { oracleService } = require('../services/oracle.service');
      const connection = await oracleService.getConnection();
      
      try {
        // Reset timestamp to process all existing data
        const resetDate = new Date('2025-01-01'); // Earlier than any data
        
        await connection.execute(`
          UPDATE CDC_PROCESSING_STATUS 
          SET 
            LAST_PROCESSED_TIMESTAMP = :resetDate,
            LAST_CHANGE_ID = 0,
            LAST_UPDATED = CURRENT_TIMESTAMP
          WHERE TABLE_NAME = 'CDC_NORMAL_MODE'
        `, { resetDate });

        await connection.commit();
        
        res.json({
          success: true,
          message: 'CDC timestamp reset for backfill processing',
          resetTimestamp: resetDate.toISOString(),
          note: 'Existing data will be processed in next CDC cycle',
          timestamp: new Date().toISOString()
        });

      } finally {
        await connection.close();
      }

    } catch (error) {
      logger.error('Error resetting CDC for backfill:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reset CDC for backfill',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get recent CDC changes
   */
  static async getRecentChanges(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const { oracleService } = require('../services/oracle.service');
      const connection = await oracleService.getConnection();
      
      try {
        const result = await connection.execute(
          `SELECT 
            CHANGE_ID,
            CALL_ID,
            CUSTOMER_ID,
            CHANGE_TYPE,
            CHANGE_TIMESTAMP,
            PROCESSED,
            PROCESSING_TIMESTAMP,
            ERROR_MESSAGE,
            EXTRACT(DAY FROM (SYSTIMESTAMP - CHANGE_TIMESTAMP)) * 24 * 60 + 
            EXTRACT(HOUR FROM (SYSTIMESTAMP - CHANGE_TIMESTAMP)) * 60 + 
            EXTRACT(MINUTE FROM (SYSTIMESTAMP - CHANGE_TIMESTAMP)) AS MINUTES_AGE
          FROM VERINT_CHANGE_LOG
          ORDER BY CHANGE_TIMESTAMP DESC
          FETCH FIRST :limit ROWS ONLY`,
          { limit }
        );

        const changes = result.rows!.map((row: any) => ({
          changeId: row[0],
          callId: row[1],
          customerId: row[2],
          changeType: row[3],
          changeTimestamp: row[4],
          processed: row[5] === 1,
          processingTimestamp: row[6],
          errorMessage: row[7],
          minutesAge: row[8]
        }));

        res.json({
          success: true,
          changes,
          total: changes.length,
          timestamp: new Date().toISOString()
        });

      } finally {
        await connection.close();
      }

    } catch (error) {
      logger.error('Error getting recent changes:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recent changes',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Enable historical CDC mode to reprocess old data
   */
  static async enableHistoricalMode(req: Request, res: Response): Promise<void> {
    try {
      const { fromDate, reason } = req.body;
      
      if (!fromDate) {
        res.status(400).json({
          success: false,
          error: 'fromDate parameter is required (format: YYYY-MM-DD)',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const { oracleService } = require('../services/oracle.service');
      const connection = await oracleService.getConnection();
      
      try {
        // Enable historical mode from specified date
        await connection.execute(`
          UPDATE CDC_PROCESSING_STATUS 
          SET 
            LAST_PROCESSED_TIMESTAMP = TO_DATE(:fromDate, 'YYYY-MM-DD'),
            TOTAL_PROCESSED = 1,
            LAST_UPDATED = CURRENT_TIMESTAMP
          WHERE TABLE_NAME = 'CDC_HISTORICAL_MODE'
        `, { fromDate });

        await connection.commit();
        
        res.json({
          success: true,
          message: 'Historical CDC mode enabled',
          fromDate: fromDate,
          reason: reason || 'Manual activation',
          note: 'System will now process both new data and historical data from specified date',
          timestamp: new Date().toISOString()
        });

      } finally {
        await connection.close();
      }

    } catch (error) {
      logger.error('Error enabling historical CDC mode:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to enable historical CDC mode',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Disable historical CDC mode
   */
  static async disableHistoricalMode(req: Request, res: Response): Promise<void> {
    try {
      const { oracleService } = require('../services/oracle.service');
      const connection = await oracleService.getConnection();
      
      try {
        // Disable historical mode
        await connection.execute(`
          UPDATE CDC_PROCESSING_STATUS 
          SET 
            TOTAL_PROCESSED = 0,
            LAST_UPDATED = CURRENT_TIMESTAMP
          WHERE TABLE_NAME = 'CDC_HISTORICAL_MODE'
        `);

        await connection.commit();
        
        res.json({
          success: true,
          message: 'Historical CDC mode disabled',
          note: 'System now processes only new data (normal CDC mode)',
          timestamp: new Date().toISOString()
        });

      } finally {
        await connection.close();
      }

    } catch (error) {
      logger.error('Error disabling historical CDC mode:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to disable historical CDC mode',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get historical CDC mode status
   */
  static async getHistoricalModeStatus(req: Request, res: Response): Promise<void> {
    try {
      const { oracleService } = require('../services/oracle.service');
      const connection = await oracleService.getConnection();
      
      try {
        // Get both CDC mode statuses
        const result = await connection.execute(`
          SELECT 
            TABLE_NAME as CDC_MODE,
            LAST_PROCESSED_TIMESTAMP,
            TOTAL_PROCESSED as IS_ENABLED,
            LAST_UPDATED
          FROM CDC_PROCESSING_STATUS 
          WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')
          ORDER BY TABLE_NAME
        `, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const modes: any = {};
        if (result.rows) {
          for (const row of result.rows as any[]) {
            const modeName = row.CDC_MODE === 'CDC_NORMAL_MODE' ? 'normal' : 'historical';
            modes[modeName] = {
              enabled: row.IS_ENABLED === 1,
              lastProcessedTimestamp: row.LAST_PROCESSED_TIMESTAMP,
              lastUpdated: row.LAST_UPDATED
            };
          }
        }
        
        res.json({
          success: true,
          modes,
          summary: {
            normalModeActive: modes.normal?.enabled || false,
            historicalModeActive: modes.historical?.enabled || false,
            dualMode: (modes.normal?.enabled || false) && (modes.historical?.enabled || false)
          },
          timestamp: new Date().toISOString()
        });

      } finally {
        await connection.close();
      }

    } catch (error) {
      logger.error('Error getting historical CDC status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get historical CDC status',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}