import { Request, Response, NextFunction } from 'express';

function getExpectedToken(): string | null {
  if (process.env.NEZ_ADMIN_TOKEN) return process.env.NEZ_ADMIN_TOKEN;

  // Mode test/CI : token toujours présent
  if (process.env.VITEST_WORKER_ID || process.env.QFLUSH_SAFE_CI === '1') {
    return 'test-token';
  }

  return null;
}

export function requireQflushToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = getExpectedToken();
  const given = req.headers['x-qflush-token'] || req.query['token'] || req.body?.token;

  // Mauvaise config (prod) → 401
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'NEZ_ADMIN_TOKEN not configured on server',
    });
  }

  // Token incorrect → 401
  if (given !== token) {
    return res.status(401).json({
      success: false,
      error: 'invalid token',
    });
  }

  return next();
}
// ROME-TAG: 0x92EED4

