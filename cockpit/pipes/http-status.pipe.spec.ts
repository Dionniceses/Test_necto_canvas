import { HttpStatusPipe } from './http-status.pipe';

describe('HttpStatusPipe', () => {
  let pipe: HttpStatusPipe;

  beforeEach(() => {
    pipe = new HttpStatusPipe();
  });

  it('should create an instance', () => {
    expect(pipe).toBeTruthy();
  });

  describe('success status', () => {
    it('should return true for 2xx status codes', () => {
      expect(pipe.transform(200, 'success')).toBe(true);
      expect(pipe.transform(201, 'success')).toBe(true);
      expect(pipe.transform(204, 'success')).toBe(true);
      expect(pipe.transform(299, 'success')).toBe(true);
    });

    it('should return false for non-2xx status codes', () => {
      expect(pipe.transform(100, 'success')).toBe(false);
      expect(pipe.transform(199, 'success')).toBe(false);
      expect(pipe.transform(300, 'success')).toBe(false);
      expect(pipe.transform(400, 'success')).toBe(false);
      expect(pipe.transform(500, 'success')).toBe(false);
    });

    it('should return false for null response code', () => {
      expect(pipe.transform(null, 'success')).toBe(false);
    });
  });

  describe('error status', () => {
    it('should return true for 4xx and 5xx status codes', () => {
      expect(pipe.transform(400, 'error')).toBe(true);
      expect(pipe.transform(404, 'error')).toBe(true);
      expect(pipe.transform(500, 'error')).toBe(true);
      expect(pipe.transform(503, 'error')).toBe(true);
    });

    it('should return false for status codes below 400', () => {
      expect(pipe.transform(100, 'error')).toBe(false);
      expect(pipe.transform(200, 'error')).toBe(false);
      expect(pipe.transform(300, 'error')).toBe(false);
      expect(pipe.transform(399, 'error')).toBe(false);
    });

    it('should return false for null response code', () => {
      expect(pipe.transform(null, 'error')).toBe(false);
    });
  });

  describe('amber status', () => {
    it('should return true for 3xx status codes', () => {
      expect(pipe.transform(300, 'amber')).toBe(true);
      expect(pipe.transform(301, 'amber')).toBe(true);
      expect(pipe.transform(304, 'amber')).toBe(true);
      expect(pipe.transform(399, 'amber')).toBe(true);
    });

    it('should return false for non-3xx status codes', () => {
      expect(pipe.transform(200, 'amber')).toBe(false);
      expect(pipe.transform(299, 'amber')).toBe(false);
      expect(pipe.transform(400, 'amber')).toBe(false);
      expect(pipe.transform(500, 'amber')).toBe(false);
    });

    it('should return false for null response code', () => {
      expect(pipe.transform(null, 'amber')).toBe(false);
    });
  });

  describe('invalid status type', () => {
    it('should return false for unknown status type', () => {
      expect(pipe.transform(200, 'unknown' as any)).toBe(false);
      expect(pipe.transform(404, 'unknown' as any)).toBe(false);
    });
  });
});
