/**
 * Hebrew text utilities for the API layer
 * Ensures proper Hebrew/UTF-8 handling in Node.js
 */

export class HebrewUtils {
  /**
   * Ensure text is properly encoded as UTF-8
   */
  static ensureUTF8(text: string): string {
    // Node.js strings are already UTF-16, ensure proper encoding
    return Buffer.from(text, 'utf8').toString('utf8');
  }
  
  /**
   * Validate Israeli phone number
   */
  static isValidIsraeliPhone(phone: string): boolean {
    // Remove non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Israeli mobile: 05X-XXXXXXX
    if (/^05\d{8}$/.test(digits)) return true;
    
    // Israeli landline: 0X-XXXXXXX (where X is 2-9)
    if (/^0[2-9]\d{7}$/.test(digits)) return true;
    
    // Toll-free: 1800XXXXXX
    if (/^1800\d{6}$/.test(digits)) return true;
    
    return false;
  }
  
  /**
   * Format Israeli phone number
   */
  static formatIsraeliPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    
    if (digits.startsWith('05')) {
      // Mobile: 05X-XXX-XXXX
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else if (digits.startsWith('0')) {
      // Landline: 0X-XXX-XXXX
      return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    } else if (digits.startsWith('1800')) {
      // Toll-free: 1-800-XXX-XXX
      return `1-800-${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    
    return phone;
  }
  
}

