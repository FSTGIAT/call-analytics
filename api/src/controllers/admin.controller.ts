import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { getConversationAssemblyConsumer } from '../services/consumers/conversation-assembly-consumer.service';

/**
 * Admin controller for managing call classifications
 */
export class AdminController {
  
  /**
   * Get all call classifications
   */
  static async getClassifications(req: Request, res: Response): Promise<void> {
    try {
      const classificationsPath = path.join(process.cwd(), 'config', 'call-classifications.json');
      const data = await fs.readFile(classificationsPath, 'utf8');
      const config = JSON.parse(data);
      
      res.json({
        success: true,
        data: {
          version: config.version,
          lastUpdated: config.lastUpdated,
          count: config.classifications.length,
          classifications: config.classifications
        }
      });
      
    } catch (error) {
      logger.error('Error getting classifications:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load classifications'
      });
    }
  }

  /**
   * Add new classification
   */
  static async addClassification(req: Request, res: Response): Promise<void> {
    try {
      const { classification } = req.body;
      
      if (!classification || typeof classification !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Classification is required and must be a string'
        });
        return;
      }

      const classificationsPath = path.join(process.cwd(), 'config', 'call-classifications.json');
      const data = await fs.readFile(classificationsPath, 'utf8');
      const config = JSON.parse(data);
      
      // Check if classification already exists
      if (config.classifications.includes(classification)) {
        res.status(400).json({
          success: false,
          error: 'Classification already exists'
        });
        return;
      }
      
      // Add new classification
      config.classifications.push(classification);
      config.lastUpdated = new Date().toISOString();
      
      // Save updated config
      await fs.writeFile(classificationsPath, JSON.stringify(config, null, 2), 'utf8');
      
      // Trigger ML service reload
      try {
        const axios = (await import('axios')).default;
        const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://ml-service:5000';
        await axios.post(`${mlServiceUrl}/admin/reload-classifications`);
        logger.info('ML service classifications reloaded');
      } catch (reloadError) {
        logger.warn('Failed to reload ML service classifications:', reloadError.message);
      }
      
      res.json({
        success: true,
        message: 'Classification added successfully',
        count: config.classifications.length
      });
      
    } catch (error) {
      logger.error('Error adding classification:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add classification'
      });
    }
  }

  /**
   * Remove classification
   */
  static async removeClassification(req: Request, res: Response): Promise<void> {
    try {
      const { classification } = req.body;
      
      if (!classification || typeof classification !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Classification is required and must be a string'
        });
        return;
      }

      const classificationsPath = path.join(process.cwd(), 'config', 'call-classifications.json');
      const data = await fs.readFile(classificationsPath, 'utf8');
      const config = JSON.parse(data);
      
      // Check if classification exists
      const index = config.classifications.indexOf(classification);
      if (index === -1) {
        res.status(404).json({
          success: false,
          error: 'Classification not found'
        });
        return;
      }
      
      // Remove classification
      config.classifications.splice(index, 1);
      config.lastUpdated = new Date().toISOString();
      
      // Save updated config
      await fs.writeFile(classificationsPath, JSON.stringify(config, null, 2), 'utf8');
      
      // Trigger ML service reload
      try {
        const axios = (await import('axios')).default;
        const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://ml-service:5000';
        await axios.post(`${mlServiceUrl}/admin/reload-classifications`);
        logger.info('ML service classifications reloaded');
      } catch (reloadError) {
        logger.warn('Failed to reload ML service classifications:', reloadError.message);
      }
      
      res.json({
        success: true,
        message: 'Classification removed successfully',
        count: config.classifications.length
      });
      
    } catch (error) {
      logger.error('Error removing classification:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove classification'
      });
    }
  }

  /**
   * Update entire classifications list
   */
  static async updateClassifications(req: Request, res: Response): Promise<void> {
    try {
      const { classifications } = req.body;
      
      if (!Array.isArray(classifications)) {
        res.status(400).json({
          success: false,
          error: 'Classifications must be an array'
        });
        return;
      }

      // Validate all classifications are strings
      if (!classifications.every(c => typeof c === 'string')) {
        res.status(400).json({
          success: false,
          error: 'All classifications must be strings'
        });
        return;
      }

      const classificationsPath = path.join(process.cwd(), 'config', 'call-classifications.json');
      const data = await fs.readFile(classificationsPath, 'utf8');
      const config = JSON.parse(data);
      
      // Update classifications
      config.classifications = classifications;
      config.lastUpdated = new Date().toISOString();
      
      // Save updated config
      await fs.writeFile(classificationsPath, JSON.stringify(config, null, 2), 'utf8');
      
      // Trigger ML service reload
      try {
        const axios = (await import('axios')).default;
        const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://ml-service:5000';
        await axios.post(`${mlServiceUrl}/admin/reload-classifications`);
        logger.info('ML service classifications reloaded');
      } catch (reloadError) {
        logger.warn('Failed to reload ML service classifications:', reloadError.message);
      }
      
      res.json({
        success: true,
        message: 'Classifications updated successfully',
        count: config.classifications.length
      });
      
    } catch (error) {
      logger.error('Error updating classifications:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update classifications'
      });
    }
  }

  /**
   * Trigger ML service to reload classifications
   */
  static async reloadMLClassifications(req: Request, res: Response): Promise<void> {
    try {
      const axios = (await import('axios')).default;
      const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://ml-service:5000';
      
      const response = await axios.post(`${mlServiceUrl}/admin/reload-classifications`);
      
      res.json({
        success: true,
        message: 'ML service classifications reloaded',
        mlResponse: response.data
      });
      
    } catch (error) {
      logger.error('Error reloading ML service classifications:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reload ML service classifications'
      });
    }
  }

  /**
   * Reset conversation assembly circuit breaker
   */
  static async resetCircuitBreaker(req: Request, res: Response): Promise<void> {
    try {
      const conversationAssemblyConsumer = getConversationAssemblyConsumer();
      conversationAssemblyConsumer.resetCircuitBreaker();
      
      logger.info('Circuit breaker reset by admin request');
      
      res.json({
        success: true,
        message: 'Circuit breaker reset successfully'
      });
      
    } catch (error) {
      logger.error('Error resetting circuit breaker:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reset circuit breaker'
      });
    }
  }
}