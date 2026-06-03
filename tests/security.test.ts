import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { RateLimiter, authRateLimiter } from '@/lib/rate-limiter';
import { hasXssPattern } from '@/lib/sanitize';
import { validateRequest } from '@/lib/validate-request';
import { proxy } from '@/proxy';
import { z } from 'zod';

describe('Security Layer - Unit & Integration Tests', () => {
  beforeEach(() => {
    authRateLimiter.clear();
  });

  describe('1. RateLimiter', () => {
    it('debe bloquear hits por IP después de 5 intentos', () => {
      const limiter = new RateLimiter(5, 60000, 10, 3600000);
      const ip = '192.168.1.1';
      const email = 'test@example.com';

      // Primeros 5 intentos deben ser exitosos
      for (let i = 0; i < 5; i++) {
        expect(limiter.check(ip, email).success).toBe(true);
        limiter.increment(ip, email);
      }

      // El 6º intento debe ser bloqueado por IP
      const result = limiter.check(ip, email);
      expect(result.success).toBe(false);
      expect(result.limitType).toBe('ip');
    });

    it('debe bloquear hits por Email después de 10 intentos incluso si las IPs varían', () => {
      const limiter = new RateLimiter(5, 60000, 10, 3600000);
      const email = 'target@example.com';

      // 10 intentos desde 10 IPs distintas
      for (let i = 0; i < 10; i++) {
        const ip = `192.168.1.${i}`;
        expect(limiter.check(ip, email).success).toBe(true);
        limiter.increment(ip, email);
      }

      // El 11º intento debe ser bloqueado por Email
      const result = limiter.check('192.168.1.99', email);
      expect(result.success).toBe(false);
      expect(result.limitType).toBe('email');
    });

    it('debe permitir intentos si el límite se limpia', () => {
      const limiter = new RateLimiter(5, 60000, 10, 3600000);
      const ip = '10.0.0.1';
      const email = 'reset@example.com';

      for (let i = 0; i < 5; i++) {
        limiter.increment(ip, email);
      }
      expect(limiter.check(ip, email).success).toBe(false);

      limiter.reset(ip, email);
      expect(limiter.check(ip, email).success).toBe(true);
    });
  });

  describe('2. XSS Detection & Sanitization', () => {
    it('debe detectar scripts maliciosos de XSS', () => {
      expect(hasXssPattern('<script>alert(1)</script>')).toBe(true);
      expect(hasXssPattern('javascript:void(0)')).toBe(true);
      expect(hasXssPattern('<img src=x onerror=alert(1)>')).toBe(true);
      expect(hasXssPattern('<iframe src="malicious"></iframe>')).toBe(true);
    });

    it('debe permitir texto y caracteres financieros de Bank of America legítimos', () => {
      expect(hasXssPattern('Zelle payment from RODRIGO OCHOA for "MANUEL FABRO RENTA MARZO"')).toBe(false);
      expect(hasXssPattern('SETOYOTA FIN/EZP DES:AUTO FINAN')).toBe(false);
      expect(hasXssPattern("O'Brien Consulting")).toBe(false);
      expect(hasXssPattern('Conf# 12345')).toBe(false);
    });

    it('debe fallar la validación en validateRequest si hay patrón XSS', async () => {
      const schema = z.object({ description: z.string() });
      const req = new NextRequest('http://localhost:3000/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: '<script>alert("xss")</script>' }),
      });

      await expect(validateRequest(req, schema)).rejects.toThrow('Potential XSS attack detected');
    });

    it('debe pasar la validación en validateRequest si los strings son legítimos', async () => {
      const schema = z.object({ description: z.string() });
      const req = new NextRequest('http://localhost:3000/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Pago de Renta "Marzo 2026" - O\'Brien' }),
      });

      const data = (await validateRequest(req, schema)) as { description: string };
      expect(data.description).toBe('Pago de Renta "Marzo 2026" - O\'Brien');
    });
  });

  describe('3. Proxy (Security Headers, CSRF & Rate Limit Integration)', () => {
    it('debe agregar headers de seguridad a las respuestas', async () => {
      const req = new NextRequest('http://localhost:3000/');
      const res = await proxy(req);

      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('debe rechazar mutaciones API cruzadas (CSRF) cuando falta Origin/Referer', async () => {
      const req = new NextRequest('http://localhost:3000/api/companies', {
        method: 'POST',
      });
      const res = await proxy(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('CSRF');
    });

    it('debe rechazar mutaciones API con Origin externo (CSRF)', async () => {
      const req = new NextRequest('http://localhost:3000/api/companies', {
        method: 'POST',
        headers: {
          'Origin': 'http://hacker.com',
          'Host': 'localhost:3000',
        },
      });
      const res = await proxy(req);
      expect(res.status).toBe(403);
    });

    it('debe aceptar mutaciones API con Origin local válido', async () => {
      const req = new NextRequest('http://localhost:3000/api/companies', {
        method: 'POST',
        headers: {
          'Origin': 'http://localhost:3000',
          'Host': 'localhost:3000',
        },
      });
      const res = await proxy(req);
      // NextResponse.next() no tiene el status bloqueado (es decir, pasa al siguiente handler)
      expect(res.status).toBe(200); // 200 indica Next
    });

    it('debe bloquear peticiones repetidas en endpoints de auth (Rate Limit)', async () => {
      // 5 peticiones válidas
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          headers: {
            'Origin': 'http://localhost:3000',
            'Host': 'localhost:3000',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: 'user@example.com', password: 'password' }),
        });
        const res = await proxy(req);
        expect(res.status).toBe(200); // NextResponse.next()
      }

      // La 6ª petición debe bloquearse con 429
      const reqBlocked = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: {
          'Origin': 'http://localhost:3000',
          'Host': 'localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'user@example.com', password: 'password' }),
      });
      const resBlocked = await proxy(reqBlocked);
      expect(resBlocked.status).toBe(429);
      const json = await resBlocked.json();
      expect(json.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});
