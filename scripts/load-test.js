import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 5 },  // Ramp up a 5 usuarios
    { duration: '30s', target: 5 },  // Mantener carga
    { duration: '15s', target: 0 },  // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% de peticiones bajo 500ms
    http_req_failed: ['rate<0.05'],   // Menos del 5% de fallos
  },
};

// Se ejecuta una sola vez al inicio del test para evitar el rate limiter de login de 5 intentos/15 min
export function setup() {
  const host = 'http://localhost:3000';
  const loginPayload = JSON.stringify({
    email: 'admin@accountexpress.com',
    password: 'Admin123!',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  let loginRes = http.post(`${host}/api/auth/login`, loginPayload, params);
  
  let sessionCookie = '';
  let companyId = '';
  
  if (loginRes.status === 200) {
    const resBody = loginRes.json();
    if (resBody.companies && resBody.companies.length > 0) {
      companyId = resBody.companies[0].id;
    }
    
    // Extraer la cookie de sesión del header Set-Cookie
    const setCookieHeader = loginRes.headers['Set-Cookie'] || loginRes.headers['set-cookie'];
    if (setCookieHeader) {
      const match = setCookieHeader.match(/session=([^;]+)/);
      if (match) {
        sessionCookie = match[1];
      }
    }
  }

  return { sessionCookie, companyId };
}

export default function (data) {
  const host = 'http://localhost:3000';
  
  // 1. Health Check (GET /api/health) - Público
  let healthRes = http.get(`${host}/api/health`);
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
    'health check is healthy': (r) => r.json().status === 'healthy',
  });

  // 2. Trial Balance (GET /api/reports/trial-balance) - Autenticado
  if (data.sessionCookie && data.companyId) {
    // Crear el cookie jar y establecer la cookie para este VU
    const jar = http.cookieJar();
    jar.set(host, 'session', data.sessionCookie);

    let reportRes = http.get(`${host}/api/reports/trial-balance?companyId=${data.companyId}`);
    check(reportRes, {
      'trial balance loaded successfully': (r) => r.status === 200,
      'trial balance net diff is 0': (r) => {
        const body = r.json();
        return Math.abs(body.totalDebits - body.totalCredits) < 0.05;
      },
    });
  }

  sleep(1);
}
