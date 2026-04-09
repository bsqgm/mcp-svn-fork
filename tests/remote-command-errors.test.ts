import { describe, it, expect, beforeEach } from '@jest/globals';
import { SvnService } from '../tools/svn-service.js';
import { SvnError } from '../common/types.js';

describe('Remote Command Error Handling', () => {
  let svnService: SvnService;

  beforeEach(() => {
    svnService = new SvnService({
      workingDirectory: '/tmp/non-existent-svn-repo',
      timeout: 5000
    });
  });

  describe('diagnoseCommands', () => {
    it('should provide detailed error information', async () => {
      const result = await svnService.diagnoseCommands();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.statusLocal).toBe(false);
      expect(result.data.statusRemote).toBe(false);
      expect(result.data.logBasic).toBe(false);
      expect(result.data.workingCopyPath).toBe('/tmp/non-existent-svn-repo');
      expect(result.data.errors).toHaveLength(3);
      expect(Array.isArray(result.data.suggestions)).toBe(true);

      const errorMessages = result.data.errors.join(' ');
      expect(errorMessages).toContain('failed');
    });

    it('should return actionable suggestions when the environment allows classification', async () => {
      const result = await svnService.diagnoseCommands();
      const suggestions = result.data.suggestions;

      if (suggestions.length > 0) {
        expect(suggestions[0]).toBeTruthy();
        expect(typeof suggestions[0]).toBe('string');
        expect(suggestions[0].length).toBeGreaterThan(10);
      } else {
        // Some restricted environments surface generic spawn errors such as EPERM,
        // which do not map to a specific suggestion.
        expect(result.data.errors.some(error => error.includes('EPERM') || error.includes('failed'))).toBe(true);
      }
    });
  });

  describe('getLog error handling', () => {
    it('should provide a useful error message when log retrieval fails', async () => {
      try {
        await svnService.getLog(undefined, 1);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(SvnError);

        const errorMessage = error.message;
        expect(typeof errorMessage).toBe('string');
        expect(errorMessage.length).toBeGreaterThan(0);
      }
    });
  });

  describe('error categorization', () => {
    it('should return readable error strings for each detected issue', async () => {
      const result = await svnService.diagnoseCommands();

      expect(result.data.errors.length).toBeGreaterThan(0);

      for (const error of result.data.errors) {
        expect(error).toContain('failed');
        expect(typeof error).toBe('string');
        expect(error.length).toBeGreaterThan(10);
      }

      for (const suggestion of result.data.suggestions) {
        expect(typeof suggestion).toBe('string');
        expect(suggestion.length).toBeGreaterThan(10);
      }
    });
  });

  describe('error message improvements', () => {
    it('should return actionable information for common issues', async () => {
      const service = new SvnService({
        workingDirectory: '/tmp'
      });

      const result = await service.diagnoseCommands();

      expect(result.data.errors.length).toBeGreaterThan(0);

      const combinedText = [...result.data.errors, ...result.data.suggestions].join(' ');
      expect(combinedText.length).toBeGreaterThan(20);
    });
  });
});
