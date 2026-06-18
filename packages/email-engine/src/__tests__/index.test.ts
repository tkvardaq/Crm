import { describe, it, expect } from 'vitest';
import { parseSpintax, generateSpintaxVariant, toSafeHtml, toPlainText, getWeightedRandomIndex } from '../index';

describe('Email Engine', () => {
  describe('parseSpintax', () => {
    it('resolves simple spintax', () => {
      const result = parseSpintax('Hello {world|there}');
      expect(['Hello world', 'Hello there']).toContain(result);
    });

    it('resolves nested spintax', () => {
      const result = parseSpintax('{Hi|Hey} {world|there}');
      expect(['Hi world', 'Hi there', 'Hey world', 'Hey there']).toContain(result);
    });

    it('handles multiple spintax in one string', () => {
      const result = parseSpintax('{A|B} {C|D} {E|F}');
      const options = ['A C E', 'A C F', 'A D E', 'A D F', 'B C E', 'B C F', 'B D E', 'B D F'];
      expect(options).toContain(result);
    });

    it('returns original string if no spintax', () => {
      const result = parseSpintax('No spintax here');
      expect(result).toBe('No spintax here');
    });

    it('handles empty choices', () => {
      const result = parseSpintax('Test {|option}');
      expect(['Test ', 'Test option']).toContain(result);
    });

    it('limits recursion depth', () => {
      const deepSpintax = '{'.repeat(15) + 'a|b' + '}'.repeat(15);
      const result = parseSpintax(deepSpintax);
      expect(['a', 'b']).toContain(result);
    });
  });

  describe('generateSpintaxVariant', () => {
    it('resolves spintax and replaces variables', () => {
      const template = 'Hello {{firstName}}, welcome to {{company}}!';
      const variables = { firstName: 'John', company: 'Acme Inc' };
      const result = generateSpintaxVariant(template, variables);
      expect(result).toBe('Hello John, welcome to Acme Inc!');
    });

    it('resolves spintax before variable replacement', () => {
      const template = '{Hi|Hey} {{firstName}}';
      const variables = { firstName: 'John' };
      const result = generateSpintaxVariant(template, variables);
      expect(['Hi John', 'Hey John']).toContain(result);
    });

    it('handles missing variables gracefully', () => {
      const template = 'Hello {{firstName}}, company: {{company}}';
      const variables = { firstName: 'John' };
      const result = generateSpintaxVariant(template, variables);
      expect(result).toBe('Hello John, company: {{company}}');
    });

    it('escapes special regex characters in variable names', () => {
      const template = 'Hello {{first.name}}';
      const variables = { 'first.name': 'John' };
      const result = generateSpintaxVariant(template, variables);
      expect(result).toBe('Hello John');
    });

    it('handles empty variables object', () => {
      const template = 'Hello {{firstName}}';
      const result = generateSpintaxVariant(template, {});
      expect(result).toBe('Hello {{firstName}}');
    });
  });

  describe('toSafeHtml', () => {
    it('converts newlines to br tags', () => {
      const result = toSafeHtml('Line 1\nLine 2');
      expect(result).toBe('Line 1<br>Line 2');
    });

    it('allows safe tags', () => {
      const result = toSafeHtml('<b>Bold</b> <i>Italic</i>');
      expect(result).toContain('<b>Bold</b>');
      expect(result).toContain('<i>Italic</i>');
    });

    it('strips script tags', () => {
      const result = toSafeHtml('<script>alert(1)</script>Safe');
      expect(result).not.toContain('<script>');
      expect(result).toContain('Safe');
    });

    it('strips event handlers', () => {
      const result = toSafeHtml('<p onclick="alert(1)">Click</p>');
      expect(result).not.toContain('onclick');
    });

    it('allows safe links', () => {
      const result = toSafeHtml('<a href="https://example.com">Link</a>');
      expect(result).toContain('href="https://example.com"');
    });

    it('strips javascript: links', () => {
      const result = toSafeHtml('<a href="javascript:alert(1)">Bad</a>');
      expect(result).not.toContain('javascript:');
    });

    it('allows mailto links', () => {
      const result = toSafeHtml('<a href="mailto:test@example.com">Email</a>');
      expect(result).toContain('href="mailto:test@example.com"');
    });
  });

  describe('toPlainText', () => {
    it('strips all tags', () => {
      const result = toPlainText('<b>Bold</b> and <i>italic</i>');
      expect(result).toBe('Bold and italic');
    });

    it('preserves text content', () => {
      const result = toPlainText('<p>Paragraph</p><div>Div</div>');
      expect(result).toBe('ParagraphDiv');
    });
  });

  describe('getWeightedRandomIndex', () => {
    it('returns index based on weights', () => {
      const weights = [10, 1, 1];
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        results.push(getWeightedRandomIndex(weights));
      }
      const index0Count = results.filter(r => r === 0).length;
      expect(index0Count).toBeGreaterThan(800);
    });

    it('handles equal weights', () => {
      const weights = [1, 1, 1];
      const results: number[] = [];
      for (let i = 0; i < 3000; i++) {
        results.push(getWeightedRandomIndex(weights));
      }
      const counts = [0, 1, 2].map(i => results.filter(r => r === i).length);
      counts.forEach(count => {
        expect(count).toBeGreaterThan(800);
        expect(count).toBeLessThan(1200);
      });
    });

    it('handles single weight', () => {
      const result = getWeightedRandomIndex([5]);
      expect(result).toBe(0);
    });

    it('handles zero weights', () => {
      const result = getWeightedRandomIndex([0, 1, 0]);
      expect(result).toBe(1);
    });
  });
});