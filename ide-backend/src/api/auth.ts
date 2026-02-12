import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../config.js';
import { createUser, findUserByEmail } from '../db.js';
import { signSessionToken } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { requireAuth } from '../auth/middleware.js';

const loginLimiter = rateLimit({
  windowMs: config.loginRateLimitWindowMs,
  max: config.loginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    return;
  }

  const existing = findUserByEmail(parsed.data.email.toLowerCase());
  if (existing) {
    res.status(409).json({ error: 'Email already exists' });
    return;
  }

  const now = new Date().toISOString();
  const user = {
    id: uuidv4(),
    email: parsed.data.email.toLowerCase(),
    passwordHash: await hashPassword(parsed.data.password),
    createdAt: now,
  };

  createUser(user);

  const token = signSessionToken({ sub: user.id, email: user.email });
  res.status(201).json({ token, user: { id: user.id, email: user.email } });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    return;
  }

  const user = findUserByEmail(parsed.data.email.toLowerCase());
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signSessionToken({ sub: user.id, email: user.email });
  res.json({ token, user: { id: user.id, email: user.email } });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.auth?.userId, email: req.auth?.email } });
});
