// --------------- VAIBHAV TYAGI WORK ----------------
import { Request, Response, NextFunction } from 'express';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  // In a real app, verify JWT here. 
  // For M1, we simulate an authenticated user via a header for testing if needed,
  // or default to a static user for simplicity since auth isn't fully implemented.
  
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Fake token decoding
    const token = authHeader.split(' ')[1];
    if (token === 'student-token') {
      req.user = { id: 'student-123', role: 'student' };
      return next();
    }
    if (token === 'officer-token') {
      req.user = { id: 'officer-456', role: 'officer' };
      return next();
    }
  }

  // In production this must decode and verify a real JWT
  return res.status(401).json({ error: 'Authentication required' });
};
